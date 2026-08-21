/**
 * AI-8：admin 永删关系 DELETE /api/admin/relations——按双方元组删会话（FK 级联 messages/signing_contracts）
 * + 绑定需求 dbReleaseDemandAfterRevoke 释放 + 评价保留不随删 + capToken 二次认证 + logEvent。
 *
 * 变异守护：删 dbDeleteConversation → 会话仍存在（红）→ 还原绿。
 */
import { test } from 'node:test';
import { TEST_SECRETS } from './_test-secrets.js';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import { handleAdminDeleteRelation } from '../src/server/domains/chat/api.js';
import { tokenDigest } from '../src/server/core/crypto.js';
import { issueCapToken } from '../src/server/core/danger-ops.js';
import { logRequest } from '../src/server/core/log.js'; // logEvent 请求级队列，logRequest 收尾统一 flush 落库

const ENV = { ...TEST_SECRETS, ADMIN_USERNAMES: ['admin_sufe'], ADMIN_DEFAULT_PASSWORD: 'test-pw-123' };

function d1Shim(raw) {
  return {
    prepare(sql) {
      const st = { _sql: sql, _params: [], bind(...p) { st._params = p; return st; },
        all(...p) { return { results: raw.prepare(st._sql).all(...(p.length ? p : st._params)) }; },
        first(...p) { return raw.prepare(st._sql).get(...(p.length ? p : st._params)) ?? undefined; },
        run(...p) { const info = raw.prepare(st._sql).run(...(p.length ? p : st._params)); return { meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } }; } };
      return st;
    },
    async batch(stmts) {
      raw.exec('BEGIN');
      try { const out = [];
        for (const s of stmts) {
          if (/^\s*(SELECT|PRAGMA|WITH|EXPLAIN)/i.test(s._sql)) out.push({ results: raw.prepare(s._sql).all(...s._params) });
          else { const info = raw.prepare(s._sql).run(...s._params); out.push({ meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } }); }
        }
        raw.exec('COMMIT'); return out;
      } catch (e) { try { raw.exec('ROLLBACK'); } catch { /* ignore */ } throw e; }
    },
  };
}
const rawOf = () => { const r = new DatabaseSync(':memory:'); r.exec('PRAGMA foreign_keys = ON'); return r; };
const reqOf = token => ({ headers: new Headers({ 'X-Auth-Token': token }) });

// 种子：admin + s1/t1 + 会话 + 消息 + 签约合同行 + contracted 需求 + token（G3：全部 lastInsertRowid）
async function seed(db, raw) {
  await initDb(db, ENV);
  const ins = sql => Number(raw.prepare(sql).run().lastInsertRowid);
  const s1 = ins("INSERT INTO users (username,password_hash,salt,role) VALUES ('s1','h','s','student')");
  const t1 = ins("INSERT INTO users (username,password_hash,salt,role) VALUES ('t1','h','s','teacher')");
  const c1 = ins(`INSERT INTO conversations (student_user_id, teacher_user_id, status) VALUES (${s1},${t1},'active')`);
  raw.prepare("INSERT INTO messages (conversation_id, sender_user_id, kind, body) VALUES (?,?,?,?)").run(c1, t1, 'text', '你好');
  raw.prepare(`INSERT INTO signing_contracts (student_user_id,teacher_user_id,conversation_id,stage,signing_status,contract_status)
    VALUES (?,?,?,'contract','signed','signing')`).run(s1, t1, c1);
  const d1 = ins(`INSERT INTO student_demands (user_id,student_grade,student_gender,target_subjects,current_scores,submitter_type,parent_contact,student_contact,status)
    VALUES (${s1},'senior1','female','["math"]','[]','self','13800000000','13800000000','contracted')`);
  raw.prepare('UPDATE conversations SET demand_id=? WHERE id=?').run(d1, c1);
  const mk = async (name, uid) => {
    const token = `${name}-token`, sessionId = `sess-${name}`;
    raw.prepare('INSERT INTO auth_sessions (token_hash,user_id,label,expires_at,session_id) VALUES (?,?,?,?,?)')
      .run(await tokenDigest(token), uid, 'x', '2099-01-01 00:00:00', sessionId);
    return { token, sessionId, uid };
  };
  const adminId = raw.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").get().id;
  const adm = await mk('admin', adminId);
  const s1a = await mk('s1', s1), t1a = await mk('t1', t1);
  const cap = await issueCapToken(db, reqOf(adm.token));
  return { s1, t1, c1, d1, adm, s1a, t1a, cap };
}

test('admin 永删关系：会话+级联消息/签约合同删除 + 需求释放 + logEvent', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { adm, s1, t1, c1, d1, cap } = await seed(db, raw);
  const req = reqOf(adm.token); // 同一对象引用贯穿 handler + logRequest（logEvent 入队 WeakMap 键 req，新对象 flush 不到）
  const r = await handleAdminDeleteRelation(db, { studentUserId: s1, teacherUserId: t1, capToken: cap }, req);
  assert.equal(r.status, 200);
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM conversations').get().c, 0, '会话删除');
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM messages').get().c, 0, '消息 FK 级联删');
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM signing_contracts').get().c, 0, '签约合同 FK 级联删');
  assert.equal(raw.prepare('SELECT status FROM student_demands WHERE id=?').get(d1).status, 'revoked', '绑定需求释放');
  // logEvent 请求级队列：logRequest 收尾统一 flush 落库（req 必须在 meta 内——签名 (db, meta)，第 3 参被忽略）
  await logRequest(db, { method: 'DELETE', path: '/api/admin/relations', body: {}, status: 200, req });
  const lg = raw.prepare("SELECT action FROM activity_log WHERE action='admin.relation.remove'").all();
  assert.equal(lg.length, 1, '留档 admin.relation.remove');
});

test('capToken 门禁：无 capToken → 403 REAUTH_FAILED，行零变化', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { adm, s1, t1, c1 } = await seed(db, raw);
  const r = await handleAdminDeleteRelation(db, { studentUserId: s1, teacherUserId: t1 }, reqOf(adm.token));
  assert.equal(r.status, 403);
  assert.equal((await r.json()).code, 'AUTH_REAUTH_FAILED');
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM conversations').get().c, 1, '会话保留');
});

test('非 admin → 403；元组不存在 → 404', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1a, t1, s1, adm, cap } = await seed(db, raw);
  const r1 = await handleAdminDeleteRelation(db, { studentUserId: s1, teacherUserId: t1 }, reqOf(s1a.token));
  assert.equal(r1.status, 403, '学生不可调 admin 接口');
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM conversations').get().c, 1, '非 admin 请求零删除');
  // 元组不存在 → 404（404 在 confirmDangerOtp 之前返回，capToken 不消费）
  const r2 = await handleAdminDeleteRelation(db, { studentUserId: 999, teacherUserId: 888, capToken: cap }, reqOf(adm.token));
  assert.equal(r2.status, 404, '元组不存在 404');
});

test('无效 token → 401', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  await seed(db, raw);
  const r = await handleAdminDeleteRelation(db, { studentUserId: 1, teacherUserId: 2 }, reqOf('bad-token'));
  assert.equal(r.status, 401);
});

test('body 非法 id → 400 INVALID_PARAMS', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { adm, s1, t1, c1, cap } = await seed(db, raw);
  for (const bad of [{ studentUserId: -1, teacherUserId: t1 }, { studentUserId: s1, teacherUserId: 'abc' },
                     { studentUserId: 1.5, teacherUserId: t1 }, { studentUserId: s1 }]) {
    const r = await handleAdminDeleteRelation(db, { ...bad, capToken: cap }, reqOf(adm.token));
    assert.equal(r.status, 400, `非法 body ${JSON.stringify(bad)} → 400`);
    assert.equal((await r.json()).code, 'COMMON_INVALID_PARAMS');
  }
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM conversations').get().c, 1, '非法请求零删除');
});
