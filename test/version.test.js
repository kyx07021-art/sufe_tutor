/**
 * 数据版本戳模块（v0.23.0 静默数据层；v0.23.1 审计修正）回归
 *
 * 覆盖：
 *   - versionDomainOf 域映射表：纯认证/个人游标路径不 bump、聊天高频写隔离、
 *     合同系三域（contracts+demands+chat）、意向/推送接受连带 chat、
 *     管理员跨域连带（评价→teachers / 删需求→demands / 删消息→chat）、
 *     附件暂存不 bump、注销清内容多域
 *   - initDb 经 initVersionTable 建表；bumpVersions 逐域自增 + 单域失败不 abort 其余；
 *     getVersions 恒返全部 7 域（未 bump 补 0——首次 0→1 才能触发客户端重拉）
 *   - 域隔离铁律：聊天写只 bump chat，绝不连带 demands（防高频写放大效应）
 *   - notifyUser 咽喉 bump notifications（对端红点 8s 内静默刷新）
 *   - handleGetDataVersion 响应形状
 *
 * D1 形状：db.prepare(sql).bind(...).all()/.first()/.run() + db.batch([...])（与 initdb-migration.test.js 同款 shim）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../server/db.js';
import { initVersionTable, bumpVersions, getVersions, handleGetDataVersion, versionDomainOf } from '../server/version.js';
import { initNotifyTable, notifyUser } from '../server/notify.js';

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

test('versionDomainOf：纯认证/个人游标/待审核评价/邀请码不 bump', () => {
  for (const p of ['/api/auth/login', '/api/auth/register', '/api/auth/logout', '/api/auth/re-auth',
    '/api/auth/sessions/revoke', '/api/notifications/5/read', '/api/conversations/5/read',
    '/api/reviews', '/api/reviews/5', '/api/admin/invite']) {
    assert.deepEqual(versionDomainOf(p), [], `${p} 不应 bump`);
  }
});

test('versionDomainOf：附件暂存不 bump（私有不入会话，发消息才 bump chat）', () => {
  assert.deepEqual(versionDomainOf('/api/uploads'), []);
  assert.deepEqual(versionDomainOf('/api/uploads/3'), []);
});

test('versionDomainOf：聊天系只落 chat 域（高频写隔离）', () => {
  assert.deepEqual(versionDomainOf('/api/conversations/5/messages'), ['chat']);
});

test('versionDomainOf：需求系 → demands；意向/推送处理连带 chat（accept 建会话）', () => {
  for (const p of ['/api/student/demands', '/api/student/demands/5', '/api/student/demands/5/reopen',
    '/api/demands/5/intents', '/api/demand-pushes']) {
    assert.deepEqual(versionDomainOf(p), ['demands'], p);
  }
  assert.deepEqual(versionDomainOf('/api/intents/5/resolve'), ['demands', 'chat']);
  assert.deepEqual(versionDomainOf('/api/demand-pushes/5/resolve'), ['demands', 'chat']);
});

test('versionDomainOf：合同系三域（contracts + demands + chat 气泡）；管理删合同连带 admin', () => {
  for (const p of ['/api/contracts', '/api/contracts/5', '/api/contracts/5/sign', '/api/contracts/5/revoke']) {
    assert.deepEqual(versionDomainOf(p), ['contracts', 'demands', 'chat'], p);
  }
  assert.deepEqual(versionDomainOf('/api/admin/contracts/5'), ['contracts', 'demands', 'admin']);
});

test('versionDomainOf：发起签约（创建/回应）归 contracts+chat+demands（v0.24.0）', () => {
  assert.deepEqual(versionDomainOf('/api/conversations/5/signing'), ['contracts', 'chat', 'demands']);
  assert.deepEqual(versionDomainOf('/api/signing-requests/7/respond'), ['contracts', 'chat', 'demands']);
});

test('versionDomainOf：教师/封禁/核验连带 admin；帖子/通知/反馈归属', () => {
  assert.deepEqual(versionDomainOf('/api/teacher/profile'), ['teachers']);
  assert.deepEqual(versionDomainOf('/api/admin/teachers/5/verify'), ['teachers', 'admin']);
  assert.deepEqual(versionDomainOf('/api/admin/users/5/ban'), ['teachers', 'admin']);
  assert.deepEqual(versionDomainOf('/api/posts'), ['posts']);
  assert.deepEqual(versionDomainOf('/api/posts/5'), ['posts']);
  assert.deepEqual(versionDomainOf('/api/posts/5/like'), ['posts']);
  assert.deepEqual(versionDomainOf('/api/notifications/broadcast'), ['notifications']);
  assert.deepEqual(versionDomainOf('/api/admin/notifications/5'), ['notifications']);
  assert.deepEqual(versionDomainOf('/api/feedbacks'), ['admin']);
  assert.deepEqual(versionDomainOf('/api/feedbacks/5/resolve'), ['admin']);
});

test('versionDomainOf：管理员跨域连带（评价→teachers / 删需求→demands / 删消息→chat）', () => {
  assert.deepEqual(versionDomainOf('/api/admin/reviews/5/approve'), ['admin', 'teachers']);
  assert.deepEqual(versionDomainOf('/api/admin/reviews/5/reject'), ['admin', 'teachers']);
  assert.deepEqual(versionDomainOf('/api/admin/reviews/5'), ['admin', 'teachers']);
  assert.deepEqual(versionDomainOf('/api/admin/demands/5'), ['admin', 'demands']);
  assert.deepEqual(versionDomainOf('/api/admin/messages/5'), ['admin', 'chat']);
  assert.deepEqual(versionDomainOf('/api/admin/stats'), ['admin']);
});

test('versionDomainOf：注销清内容多域；头像进教师卡片；未知路径兜底', () => {
  assert.deepEqual(versionDomainOf('/api/user/deactivate'), ['teachers', 'demands', 'posts']);
  assert.deepEqual(versionDomainOf('/api/user/avatar'), ['teachers']);
  assert.deepEqual(versionDomainOf('/api/unknown'), []);
});

test('initDb 建表 + bumpVersions 逐域自增；getVersions 恒返 7 域（未 bump 补 0）', async () => {
  const db = d1Shim(rawOf());
  await initDb(db, ENV); // initDb 内 initVersionTable 建表（回归：不建表则 INSERT 报 no such table）
  const zero = await getVersions(db);
  assert.deepEqual(Object.keys(zero).sort(), ['admin', 'chat', 'contracts', 'demands', 'notifications', 'posts', 'teachers']);
  assert.ok(Object.values(zero).every(v => v === 0), '初始全域为 0（客户端基线即有键，首次 0→1 能触发重拉）');
  await bumpVersions(db, ['demands']);
  await bumpVersions(db, ['demands']);
  await bumpVersions(db, ['teachers']);
  const v = await getVersions(db);
  assert.equal(v.demands, 2, '同域重复写应自增');
  assert.equal(v.teachers, 1);
  assert.equal(v.posts, 0, '未 bump 的域补 0');
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

test('notifyUser 咽喉 bump notifications 域（对端红点 8s 内静默刷新）', async () => {
  const raw = rawOf();
  raw.exec('CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL)');
  raw.exec('INSERT INTO users (username) VALUES (\'t\')');
  const db = d1Shim(raw);
  await initVersionTable(db);
  await initNotifyTable(db); // notifyUser 落 notifications 表（FK 引用 users）
  await notifyUser(db, 1, '测试通知');
  const v = await getVersions(db);
  assert.equal(v.notifications, 1, 'notifyUser 后 notifications 计数应 +1');
});

test('initVersionTable 幂等：重复建表不炸', async () => {
  const raw = rawOf();
  const db = d1Shim(raw);
  await initVersionTable(db);
  await initVersionTable(db); // 第二次应静默成功（CREATE IF NOT EXISTS）
  await bumpVersions(db, ['posts']);
  assert.equal((await getVersions(db)).posts, 1);
});

test('handleGetDataVersion 响应形状（全域补零）', async () => {
  const db = d1Shim(rawOf());
  await initDb(db, ENV);
  await bumpVersions(db, ['posts']);
  const res = await handleGetDataVersion(db);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.versions.posts, 1);
  assert.equal(body.versions.demands, 0);
});
