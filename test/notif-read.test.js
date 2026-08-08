/**
 * #151（v0.25.59）：通知单条已读（取代「进入通知页批量全读」）
 *
 * 覆盖：归属硬约束——本人标记才翻转；跨用户调用幂等 ok 但 0 行翻转（不泄密不误读）；
 * 非法 id（非纯数字/0）→ 400；未认证 → 401。
 *
 * D1 形状同 signing-hardening.test.js：db.prepare.bind/all/first/run + db.batch（事务 shim）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../server/db.js';
import { handleMarkNotificationRead } from '../server/notify.js';
import { tokenDigest } from '../server/crypto.js';

const ENV = { ADMIN_USERNAMES: ['admin_sufe'], ADMIN_DEFAULT_PASSWORD: 'test-pw-123' };

function d1Shim(raw) {
  return {
    prepare(sql) {
      const st = {
        _sql: sql, _params: [],
        bind(...p) { st._params = p; return st; },
        all(...p) { return { results: raw.prepare(st._sql).all(...(p.length ? p : st._params)) }; },
        first(...p) { return raw.prepare(st._sql).get(...(p.length ? p : st._params)) ?? undefined; },
        run(...p) {
          const info = raw.prepare(st._sql).run(...(p.length ? p : st._params));
          return { meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
        },
      };
      return st;
    },
    async batch(stmts) {
      raw.exec('BEGIN');
      try {
        const out = [];
        for (const s of stmts) {
          if (/^\s*(SELECT|PRAGMA|WITH|EXPLAIN)/i.test(s._sql)) out.push({ results: raw.prepare(s._sql).all(...s._params) });
          else { const info = raw.prepare(s._sql).run(...s._params); out.push({ meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } }); }
        }
        raw.exec('COMMIT');
        return out;
      } catch (e) { try { raw.exec('ROLLBACK'); } catch { /* ignore */ } throw e; }
    },
  };
}
const rawOf = () => { const r = new DatabaseSync(':memory:'); r.exec('PRAGMA foreign_keys = ON'); return r; };
const reqOf = token => ({ headers: new Headers({ 'X-Auth-Token': token }) });

/** 播种：a 学生 + b 教师，各一条通知；返回双令牌 */
async function seed(db, raw) {
  await initDb(db, ENV);
  raw.exec(`INSERT INTO users (username,password_hash,salt,role) VALUES
    ('a','h','s','student'),('b','h','s','teacher')`);
  const idOf = name => raw.prepare('SELECT id FROM users WHERE username=?').get(name).id;
  const a = idOf('a'), b = idOf('b');
  raw.prepare('INSERT INTO notifications (user_id, text) VALUES (?,?),(?,?)').run(a, 'A1', b, 'B1');
  const mkToken = async name => {
    const token = `${name}-token`;
    raw.prepare('INSERT INTO auth_sessions (token_hash,user_id,label,expires_at) VALUES (?,?,?,?)')
      .run(await tokenDigest(token), idOf(name), 'x', '2099-01-01 00:00:00');
    return token;
  };
  return { a, b, aToken: await mkToken('a'), bToken: await mkToken('b') };
}

test('本人标记自己的通知已读 → ok + is_read=1，其余通知不受影响', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { a, aToken } = await seed(db, raw);
  const nA = raw.prepare('SELECT id FROM notifications WHERE user_id=? ORDER BY id LIMIT 1').get(a).id;
  const r = await handleMarkNotificationRead(db, nA, reqOf(aToken));
  assert.equal(r.status, 200);
  assert.equal(raw.prepare('SELECT is_read FROM notifications WHERE id=?').get(nA).is_read, 1, '本人通知翻为已读');
  const nB = raw.prepare('SELECT id,is_read FROM notifications WHERE user_id<>?').get(a);
  assert.equal(nB.is_read, 0, '他人的通知不受影响');
});

test('跨用户标记他人通知 → 幂等 ok 但 0 行翻转（不泄密不误读）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { a, bToken } = await seed(db, raw);
  const nA = raw.prepare('SELECT id FROM notifications WHERE user_id=?').get(a).id;
  const r = await handleMarkNotificationRead(db, nA, reqOf(bToken));
  assert.equal(r.status, 200, '幂等 ok');
  assert.equal(raw.prepare('SELECT is_read FROM notifications WHERE id=?').get(nA).is_read, 0, '他人不可翻转我的已读');
});

test('非法 id（非纯数字/0/负数/小数/空）→ 400', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { aToken } = await seed(db, raw);
  for (const bad of ['abc', 0, -3, 1.5, '', null]) {
    const r = await handleMarkNotificationRead(db, bad, reqOf(aToken));
    assert.equal(r.status, 400, `id=${JSON.stringify(bad)} 应 400`);
  }
});

test('未认证 → 401', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  await seed(db, raw);
  const r = await handleMarkNotificationRead(db, 1, reqOf('no-token'));
  assert.equal(r.status, 401);
});

// 2026-08-09 收尾审计回归：idMatch 下标残留曾致单条已读路由恒 400（notifRead[1] 对数字取下标=undefined），
// 单测直接调 handler 传合法 id 所以全绿。此处穿透 routeApi 全路径接线，堵死同类回归。
test('routeApi 全路径：POST /api/notifications/:id/read → 200 且翻转本人已读', async () => {
  const { routeApi } = await import('../_worker.js');
  const raw = rawOf(); const db = d1Shim(raw);
  const { a, aToken } = await seed(db, raw);
  const nA = raw.prepare('SELECT id FROM notifications WHERE user_id=? ORDER BY id LIMIT 1').get(a).id;
  const url = new URL(`http://x/api/notifications/${nA}/read`);
  const r = await routeApi(db, `/api/notifications/${nA}/read`, 'POST', {}, url, reqOf(aToken), {});
  assert.equal(r.status, 200, '路由接线正常（曾恒 400）');
  assert.equal(raw.prepare('SELECT is_read FROM notifications WHERE id=?').get(nA).is_read, 1, '已读翻转');
  const r2 = await routeApi(db, '/api/notifications/999999/read', 'POST', {}, url, reqOf(aToken), {});
  assert.equal(r2.status, 200, '不存在的 id 幂等 ok');
});

test('routeApi 全路径：未认证 POST 单条已读 → 401', async () => {
  const { routeApi } = await import('../_worker.js');
  const raw = rawOf(); const db = d1Shim(raw);
  await seed(db, raw);
  const url = new URL('http://x/api/notifications/1/read');
  const r = await routeApi(db, '/api/notifications/1/read', 'POST', {}, url, reqOf('bad'), {});
  assert.equal(r.status, 401, '未认证被拒');
});
