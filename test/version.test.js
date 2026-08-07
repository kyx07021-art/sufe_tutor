/**
 * 数据版本戳模块（v0.23.0 静默数据层）回归
 *
 * 覆盖：
 *   - versionDomainOf 域映射表：纯认证/个人游标路径不 bump、聊天高频写隔离、
 *     合同系双域（contracts+demands）、各业务系归属、未注册路径兜底 []
 *   - initDb 经 initVersionTable 建表；bumpVersions 原子自增；getVersions 只含已 bump 域
 *   - 域隔离铁律：聊天写只 bump chat，绝不连带 demands（防高频写放大效应）
 *   - handleGetDataVersion 响应形状
 *
 * D1 形状：db.prepare(sql).bind(...).all()/.first()/.run() + db.batch([...])（与 initdb-migration.test.js 同款 shim）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../server/db.js';
import { initVersionTable, bumpVersions, getVersions, handleGetDataVersion, versionDomainOf } from '../server/version.js';

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

const ENV = { ADMIN_USERNAMES: ['admin_sufe'], ADMIN_DEFAULT_PASSWORD: 'test-pw-123' };
const rawOf = () => { const r = new DatabaseSync(':memory:'); r.exec('PRAGMA foreign_keys = ON'); return r; };

test('versionDomainOf：纯认证/个人游标路径不 bump', () => {
  for (const p of ['/api/auth/login', '/api/auth/register', '/api/auth/logout', '/api/auth/re-auth',
    '/api/auth/sessions/revoke', '/api/user/avatar', '/api/user/deactivate',
    '/api/notifications/read', '/api/conversations/5/read', '/api/reviews', '/api/admin/invite']) {
    assert.deepEqual(versionDomainOf(p), [], `${p} 不应 bump`);
  }
});

test('versionDomainOf：聊天系只落 chat 域（高频写隔离）', () => {
  assert.deepEqual(versionDomainOf('/api/conversations/5/messages'), ['chat']);
  assert.deepEqual(versionDomainOf('/api/uploads'), ['chat']);
  assert.deepEqual(versionDomainOf('/api/uploads/3'), ['chat']);
});

test('versionDomainOf：需求系 → demands', () => {
  for (const p of ['/api/student/demands', '/api/student/demands/5', '/api/student/demands/5/reopen',
    '/api/demands/5/intents', '/api/intents/5/resolve', '/api/demand-pushes', '/api/demand-pushes/5/resolve']) {
    assert.deepEqual(versionDomainOf(p), ['demands'], p);
  }
});

test('versionDomainOf：合同系双域（contracts + demands）', () => {
  for (const p of ['/api/contracts', '/api/contracts/5', '/api/contracts/5/sign', '/api/contracts/5/revoke', '/api/admin/contracts/5']) {
    assert.deepEqual(versionDomainOf(p), ['contracts', 'demands'], p);
  }
});

test('versionDomainOf：教师/帖子/通知/管理系归属', () => {
  assert.deepEqual(versionDomainOf('/api/teacher/profile'), ['teachers']);
  assert.deepEqual(versionDomainOf('/api/admin/teachers/5/verify'), ['teachers']);
  assert.deepEqual(versionDomainOf('/api/admin/users/5/ban'), ['teachers']);
  assert.deepEqual(versionDomainOf('/api/posts'), ['posts']);
  assert.deepEqual(versionDomainOf('/api/posts/5'), ['posts']);
  assert.deepEqual(versionDomainOf('/api/posts/5/like'), ['posts']);
  assert.deepEqual(versionDomainOf('/api/notifications/broadcast'), ['notifications']);
  assert.deepEqual(versionDomainOf('/api/admin/notifications/5'), ['notifications']);
  assert.deepEqual(versionDomainOf('/api/feedbacks'), ['admin']);
  assert.deepEqual(versionDomainOf('/api/feedbacks/5/resolve'), ['admin']);
  assert.deepEqual(versionDomainOf('/api/admin/stats'), ['admin']);
  assert.deepEqual(versionDomainOf('/api/admin/reviews/5/approve'), ['admin']);
  assert.deepEqual(versionDomainOf('/api/admin/reviews/5'), ['admin']);
  assert.deepEqual(versionDomainOf('/api/admin/demands/5'), ['admin']);
  assert.deepEqual(versionDomainOf('/api/admin/messages/5'), ['admin']);
  assert.deepEqual(versionDomainOf('/api/unknown'), []);
});

test('initDb 建表 + bumpVersions/getVersions 原子自增', async () => {
  const db = d1Shim(rawOf());
  await initDb(db, ENV); // initDb 内 initVersionTable 建表（回归：不建表则 INSERT 报 no such table）
  assert.deepEqual(await getVersions(db), {}, '初始为空');
  await bumpVersions(db, ['demands']);
  await bumpVersions(db, ['demands']);
  await bumpVersions(db, ['teachers']);
  const v = await getVersions(db);
  assert.equal(v.demands, 2, '同域重复写应自增');
  assert.equal(v.teachers, 1);
  assert.equal(v.chat, undefined, '未 bump 的域不出现在结果');
});

test('域隔离铁律：聊天写绝不连带 demands 计数（防高频写放大效应）', async () => {
  const db = d1Shim(rawOf());
  await initDb(db, ENV);
  await bumpVersions(db, versionDomainOf('/api/conversations/5/messages'));
  await bumpVersions(db, versionDomainOf('/api/student/demands'));
  const v = await getVersions(db);
  assert.equal(v.chat, 1);
  assert.equal(v.demands, 1);
  // 再发一条聊天消息：只 chat 自增，demands 纹丝不动
  await bumpVersions(db, versionDomainOf('/api/conversations/9/messages'));
  const v2 = await getVersions(db);
  assert.equal(v2.chat, 2);
  assert.equal(v2.demands, 1);
});

test('initVersionTable 幂等：重复建表不炸', async () => {
  const raw = rawOf();
  const db = d1Shim(raw);
  await initVersionTable(db);
  await initVersionTable(db); // 第二次应静默成功（CREATE IF NOT EXISTS）
  await bumpVersions(db, ['posts']);
  assert.equal((await getVersions(db)).posts, 1);
});

test('handleGetDataVersion 响应形状', async () => {
  const db = d1Shim(rawOf());
  await initDb(db, ENV);
  await bumpVersions(db, ['posts']);
  const res = await handleGetDataVersion(db);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { versions: { posts: 1 } });
});
