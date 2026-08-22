/**
 * PA-1f-F1：管理员删除聊天消息 = 危险操作（P12），须 capToken 二次认证。
 * 此前 handleAdminDeleteMessage（DELETE /api/admin/messages/:id）零测试 + 零 capToken——
 * 管理员令牌复用/泄露时越权删消息一击生效。本测试锁定：
 *   - 无 capToken → 403 AUTH_REAUTH_FAILED，消息保留（变异实证：删 handler 的
 *     confirmDangerOtp → 403 断言红）；
 *   - 有 capToken → 200，消息删除；
 *   - 消息不存在 → 404（404 先于 capToken 返回，capToken 不消费）。
 */
import { test } from 'node:test';
import { TEST_SECRETS } from './_test-secrets.js';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import { tokenDigest } from '../src/server/core/crypto.js';
import { handleAdminDeleteMessage } from '../src/server/domains/admin/api.js';

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

/** 播种：admin + s1 学生 + t1 教师；C1=s1-t1 会话；一条 s1 发的 text 消息 */
async function seed(db, raw) {
  await initDb(db, ENV);
  raw.exec(`INSERT INTO users (username,password_hash,salt,role) VALUES
    ('s1','h','s','student'),('t1','h','s','teacher')`);
  const idOf = name => raw.prepare('SELECT id FROM users WHERE username=?').get(name).id;
  const s1 = idOf('s1'), t1 = idOf('t1');
  raw.prepare('INSERT INTO conversations (student_user_id, teacher_user_id) VALUES (?,?)').run(s1, t1);
  const conv = raw.prepare('SELECT id FROM conversations ORDER BY id DESC LIMIT 1').get().id;
  raw.prepare('INSERT INTO messages (conversation_id, sender_user_id, kind, body) VALUES (?,?,?,?)')
    .run(conv, s1, 'text', '你好，我想了解一下数学辅导');
  const msg = raw.prepare('SELECT id FROM messages ORDER BY id DESC LIMIT 1').get().id;
  const mkToken = async (name) => {
    const token = `${name}-token`;
    // session_id 必须非空：capToken 会话绑定（confirmDangerOtp DELETE WHERE session_id=?），
    // NULL session_id 在 SQL 中永不相等 → cap 恒不命中。
    const sessionId = `sess-${Math.random().toString(36).slice(2)}`;
    raw.prepare('INSERT INTO auth_sessions (session_id, token_hash, user_id, label, expires_at) VALUES (?,?,?,?,?)')
      .run(sessionId, await tokenDigest(token), idOf(name), 'x', '2099-01-01 00:00:00');
    return token;
  };
  return { s1, t1, conv, msg, adminToken: await mkToken('admin_sufe') };
}

// 危险操作 capToken：直接落 danger_caps 行（真实 confirmDangerOtp SQL 全链路，会话绑定 + 命中即删）。
async function capOf(raw, token) {
  const sess = raw.prepare('SELECT user_id, session_id FROM auth_sessions WHERE token_hash=?').get(await tokenDigest(token));
  const cap = `cap-${Math.random().toString(36).slice(2)}`;
  raw.prepare('INSERT INTO danger_caps (user_id, session_id, token_hash, expires_at) VALUES (?,?,?,?)')
    .run(sess.user_id, sess.session_id, await tokenDigest(cap), '2099-01-01 00:00:00');
  return cap;
}

test('PA-1f-F1：admin delete message 无 capToken → 403 且消息保留', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { msg, adminToken } = await seed(db, raw);
  const r = await handleAdminDeleteMessage(db, msg, {}, reqOf(adminToken));
  assert.equal(r.status, 403, '无 capToken 删除被拒');
  assert.equal((await r.json()).code, 'AUTH_REAUTH_FAILED', '403 稳定错误码 AUTH_REAUTH_FAILED');
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM messages WHERE id=?').get(msg).c, 1, '消息保留');
});

test('PA-1f-F1：admin delete message 有 capToken → 200 且消息删除', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { msg, adminToken } = await seed(db, raw);
  const r = await handleAdminDeleteMessage(db, msg, { capToken: await capOf(raw, adminToken) }, reqOf(adminToken));
  assert.equal(r.status, 200, '有 capToken 删除成功');
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM messages WHERE id=?').get(msg).c, 0, '消息已删');
});

test('PA-1f-F1：admin delete message 不存在 → 404（404 先于 capToken，不消费）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { adminToken } = await seed(db, raw);
  const r = await handleAdminDeleteMessage(db, 99999, {}, reqOf(adminToken));
  assert.equal(r.status, 404, '不存在消息 404');
});
