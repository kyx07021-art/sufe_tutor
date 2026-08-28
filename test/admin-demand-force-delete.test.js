/**
 * 管理员可移除全部需求（S3 单科目新模型：无「已签约禁删」门禁）。
 *
 * S5 合同独立化：contracts 表无 demand_id（standalone 证据记录，不绑定需求）→ 删除需求不触碰合同；
 * conversations.demand_id 经 FK ON DELETE SET NULL 自动置空（旧 F-03b 手动清引用逻辑随合同独立删除）。
 * 学生删除路径保留归属门禁（非本人 → 403 NO_PERMISSION）。
 *
 * 本测试覆盖：
 *   - 管理员删除需求 → 200；需求行删除；合同独立保留；会话 demand_id 经 FK SET NULL；
 *   - 学生删除本人需求 → 200；非本人 → 403（归属门禁）；
 *   - 管理员删除不存在需求 → 404。
 */
import { test } from 'node:test';
import { TEST_SECRETS } from './_test-secrets.js';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import { handleAdminDeleteDemand } from '../src/server/domains/admin/api.js';
import { handleDeleteDemand } from '../src/server/domains/demand/api.js';
import { tokenDigest } from '../src/server/core/crypto.js';

const ENV = { ...TEST_SECRETS, ADMIN_USERNAMES: ['admin_sufe'], ADMIN_DEFAULT_PASSWORD: 'test-pw-123' };

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

// 管理员删除需求 = 危险操作 capToken：直接落 danger_caps 行（真实 confirmDangerOtp SQL 全链路，
// 会话绑定 + 命中即删）。expires_at 取 2099 规避时区比较伪象（同 content-admin 口径）。
// DELETE-then-INSERT 幂等：同 (user_id, session_id) 旧 cap 残留即撞主键，先清旧行再插新行。
async function capOf(raw, token) {
  const sess = raw.prepare('SELECT user_id, session_id FROM auth_sessions WHERE token_hash=?').get(await tokenDigest(token));
  const cap = `cap-${Math.random().toString(36).slice(2)}`;
  raw.prepare('DELETE FROM danger_caps WHERE user_id=? AND session_id=?').run(sess.user_id, sess.session_id);
  raw.prepare('INSERT INTO danger_caps (user_id, session_id, token_hash, expires_at) VALUES (?,?,?,?)')
    .run(sess.user_id, sess.session_id, await tokenDigest(cap), '2099-01-01 00:00:00');
  return cap;
}

/** 播种：admin + s1/s2 学生 + t1 教师；d1 = s1 的 open 需求；C1=s1-t1；一条 S5 standalone 合同引用 C1 */
async function seed(db, raw) {
  await initDb(db, ENV);
  // admin_sufe 由 initDb 按 ENV.ADMIN_USERNAMES 种子创建（upsert），此处只插业务用户
  raw.exec(`INSERT INTO users (username,password_hash,salt,role) VALUES
    ('s1','h','s','student'),('s2','h','s','student'),('t1','h','s','teacher')`);
  const idOf = name => raw.prepare('SELECT id FROM users WHERE username=?').get(name).id;
  const s1 = idOf('s1'), s2 = idOf('s2'), t1 = idOf('t1');
  raw.prepare(`INSERT INTO student_demands (user_id, subject, grade, province, teaching_method, status)
    VALUES (?,?,?,?,?,?)`).run(s1, 'math', 'senior1', 'shanghai', 'online', 'open');
  const d1 = raw.prepare('SELECT id FROM student_demands ORDER BY id DESC LIMIT 1').get().id;
  raw.prepare('INSERT INTO conversations (student_user_id, teacher_user_id, demand_id) VALUES (?,?,?)').run(s1, t1, d1);
  const conv = raw.prepare('SELECT id FROM conversations ORDER BY id DESC LIMIT 1').get().id;
  // S5 standalone contract（无 demand_id 列）：独立证据记录，删除需求不应触碰
  raw.prepare(`INSERT INTO contracts (conversation_id, student_user_id, teacher_user_id, drafter_user_id, contract_status)
    VALUES (?,?,?,?,'signed')`).run(conv, s1, t1, t1);
  const mkToken = async (name) => {
    const token = `${name}-token`;
    // session_id 必须非空：capToken 会话绑定（confirmDangerOtp DELETE WHERE session_id=?），
    // NULL session_id 在 SQL 中永不相等 → cap 恒不命中。
    const sessionId = `sess-${Math.random().toString(36).slice(2)}`;
    raw.prepare('INSERT INTO auth_sessions (session_id, token_hash, user_id, label, expires_at) VALUES (?,?,?,?,?)')
      .run(sessionId, await tokenDigest(token), idOf(name), 'x', '2099-01-01 00:00:00');
    return token;
  };
  return { s1, s2, t1, d1, conv, adminToken: await mkToken('admin_sufe'), s1Token: await mkToken('s1'), s2Token: await mkToken('s2') };
}

test('管理员删除需求 → 200；需求行删除；合同独立保留；会话 demand_id 经 FK SET NULL', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { d1, conv, adminToken } = await seed(db, raw);
  const r = await handleAdminDeleteDemand(db, d1, { capToken: await capOf(raw, adminToken) }, reqOf(adminToken));
  assert.equal(r.status, 200, '管理员可删任何需求（无签约禁删门禁）');
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM student_demands WHERE id=?').get(d1).c, 0, '需求行已删');
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM contracts WHERE conversation_id=?').get(conv).c, 1, '合同独立保留（不随需求删除）');
  assert.equal(raw.prepare('SELECT demand_id FROM conversations WHERE id=?').get(conv).demand_id, null, '会话 demand_id 经 FK ON DELETE SET NULL 置空');
});

// 管理员删除需求是危险操作（），无 capToken 必须 403（变异实证：删
// handleAdminDeleteDemand 的 confirmDangerOtp → 本测试红）。404 先于 capToken 不消费。
test('PA-1f-F1：admin delete demand 无 capToken → 403 且需求保留', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { d1, adminToken } = await seed(db, raw);
  const r = await handleAdminDeleteDemand(db, d1, {}, reqOf(adminToken));
  assert.equal(r.status, 403, '无 capToken 删除被拒');
  assert.equal((await r.json()).code, 'AUTH_REAUTH_FAILED', '403 稳定错误码 AUTH_REAUTH_FAILED');
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM student_demands WHERE id=?').get(d1).c, 1, '需求保留');
});

test('学生删除：本人需求 → 200；非本人 → 403（归属门禁）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { d1, s1Token, s2Token } = await seed(db, raw);
  // 非本人删除 → 403，需求保留
  const r2 = await handleDeleteDemand(db, d1, {}, reqOf(s2Token));
  assert.equal(r2.status, 403, '非本人删除被拒');
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM student_demands WHERE id=?').get(d1).c, 1, '需求未删');
  // 本人删除 → 200
  const r1 = await handleDeleteDemand(db, d1, {}, reqOf(s1Token));
  assert.equal(r1.status, 200, '本人删除成功');
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM student_demands WHERE id=?').get(d1).c, 0, '需求已删');
});

test('管理员删除不存在需求 → 404', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { adminToken } = await seed(db, raw);
  const r = await handleAdminDeleteDemand(db, 99999, {}, reqOf(adminToken));
  assert.equal(r.status, 404, '不存在需求 404');
});
