/**
 * S2-T8: temp conversation API layer (I-23/I-24/I-16/I-17/I-18/I-15) — handler-level tests.
 *
 * Covers the temp state machine driven through the chat api handlers:
 *   1. I-23 create: student→teacher with firstMessage → init→sent in the same batch, message lands, quota 0.
 *   2. I-23 reuse: second call for the same tuple returns the same conversationId (no duplicate row).
 *   3. I-23 formal reuse: a pre-existing formal (active) conversation is returned as-is (tempStatus null).
 *   4. I-23 reopen: a pre-existing formal CLOSED conversation is reopened to active and reused.
 *   5. I-24 init→sent: create init (no firstMessage), initiator sends → tempStatus 'sent', tempQuota 0.
 *   6. I-24 over-quota: initiator sends again on a 'sent' temp → 409 TEMP_QUOTA_EXCEEDED.
 *   7. I-24 receiver formalizes: receiver replies on a 'sent' temp → temp_status NULL, convStatus 'active'.
 *   8. I-18 init gate: non-initiator GET messages on an 'init' conv → 404; on a 'sent' conv → 200.
 *   9. I-17 list visibility: initiator sees the init conv in the list, non-initiator does NOT;
 *      once sent, both participants see it.
 *  10. I-16 temp close: capToken required, deletes the row + messages (FK cascade), zero notification.
 *  11. I-15 my-relations: tempStatus / tempInitiatorId are exposed on the relation object.
 *
 * Mutation guards (G2 — reverting the corresponding source line turns the matching test red):
 *   - Removing the init-404 gate in loadConversationFor → test 8 (non-initiator on init) fails.
 *   - Removing tempStatus/tempInitiatorId from the list mapping → test 9 asserts red.
 *   - Removing the TEMP_QUOTA_EXCEEDED 409 in handleSendBatch → test 6 asserts red.
 *   - Removing the temp-close branch in handleCloseConversation → test 10 asserts red.
 */
import { test } from 'node:test';
import { TEST_SECRETS } from './_test-secrets.js';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import {
  handleCreateTempConversation, handleSendMessage, handleGetMessages,
  handleGetConversations, handleGetMyRelations, handleCloseConversation,
} from '../src/server/domains/chat/api.js';
import { logRequest } from '../src/server/core/log.js';
import { tokenDigest } from '../src/server/core/crypto.js';

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
      if (!stmts.length) throw new Error('D1 batch requires at least one statement');
      raw.exec('BEGIN');
      try {
        const out = [];
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
const msgUrl = convId => new URL(`http://localhost/api/conversations/${convId}/messages`);

// capToken 签发（per-user-per-session）：uid 指定持卡用户（danger_caps 以 user_id+session_id 为主键）
const capOf = async (raw, sessionId, uid, value = 'cap') => {
  raw.prepare('INSERT INTO danger_caps (user_id, session_id, token_hash, expires_at) VALUES (?,?,?,?)')
    .run(uid, sessionId, await tokenDigest(value), '2099-01-01 00:00:00');
  return value;
};

// 基础种子：s1(学生)/t1/t2(教师)。所有 id 取 INSERT 返回值（initDb seedAdmins 占 id=1，禁硬编码）。
async function seed(db, raw) {
  await initDb(db, ENV);
  const ins = sql => Number(raw.prepare(sql).run().lastInsertRowid);
  const s1 = ins("INSERT INTO users (username,password_hash,salt,role) VALUES ('s1','h','s','student')");
  const t1 = ins("INSERT INTO users (username,password_hash,salt,role) VALUES ('t1','h','s','teacher')");
  const t2 = ins("INSERT INTO users (username,password_hash,salt,role) VALUES ('t2','h','s','teacher')");
  const mk = async (name, uid) => {
    const token = `${name}-token`, sessionId = `sess-${name}`;
    raw.prepare('INSERT INTO auth_sessions (token_hash,user_id,label,expires_at,session_id) VALUES (?,?,?,?,?)')
      .run(await tokenDigest(token), uid, 'x', '2099-01-01 00:00:00', sessionId);
    return { token, sessionId, uid };
  };
  return { s1, t1, t2, s1a: await mk('s1', s1), t1a: await mk('t1', t1), t2a: await mk('t2', t2) };
}

test('I-23 create with firstMessage: init→sent atomic, message lands, quota 0, iAmInitiator true', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, t1, s1a } = await seed(db, raw);
  const r = await handleCreateTempConversation(db, { targetUserId: t1, firstMessage: ' 你好老师 ' }, reqOf(s1a.token));
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.status, 'active');
  assert.equal(body.tempStatus, 'sent', 'firstMessage path advances init→sent');
  assert.equal(body.tempInitiatorId, s1, 'initiator = me');
  assert.equal(body.iAmInitiator, true);
  assert.equal(body.quota, 0, 'initiator used quota (message already sent)');
  // tuple is student s1 + teacher t1
  const row = raw.prepare('SELECT temp_status, temp_initiator_user_id FROM conversations WHERE student_user_id=? AND teacher_user_id=?').get(s1, t1);
  assert.equal(row.temp_status, 'sent');
  assert.equal(row.temp_initiator_user_id, s1);
  const msg = raw.prepare("SELECT body FROM messages WHERE conversation_id=? AND sender_user_id=? AND kind='text'").get(body.conversationId, s1);
  assert.equal(msg.body, '你好老师', 'firstMessage trimmed and inserted');
});

test('I-23 reuse: second call same tuple → same conversationId, no duplicate row', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, t1, s1a } = await seed(db, raw);
  const r1 = await handleCreateTempConversation(db, { targetUserId: t1, firstMessage: 'hi' }, reqOf(s1a.token));
  const c1 = (await r1.json()).conversationId;
  const r2 = await handleCreateTempConversation(db, { targetUserId: t1 }, reqOf(s1a.token));
  assert.equal(r2.status, 200);
  const body = await r2.json();
  assert.equal(body.conversationId, c1, 'reuse returns the existing temp conversation');
  assert.equal(body.tempStatus, 'sent', 'state preserved on reuse');
  assert.equal(body.iAmInitiator, true);
  const count = raw.prepare('SELECT COUNT(*) AS c FROM conversations WHERE student_user_id=? AND teacher_user_id=?').get(s1, t1).c;
  assert.equal(count, 1, 'no duplicate conversation row');
});

test('I-23 formal reuse: pre-existing active formal conversation returned as-is (tempStatus null)', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, t1, s1a } = await seed(db, raw);
  const formalId = Number(raw.prepare('INSERT INTO conversations (student_user_id, teacher_user_id) VALUES (?,?)')
    .run(s1, t1).lastInsertRowid);
  const r = await handleCreateTempConversation(db, { targetUserId: t1, firstMessage: 'hi' }, reqOf(s1a.token));
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.conversationId, formalId, 'reuses the formal conversation');
  assert.equal(body.status, 'active');
  assert.equal(body.tempStatus, null);
  assert.equal(body.tempInitiatorId, null);
  assert.equal(body.iAmInitiator, false);
  assert.equal(body.quota, null);
  // no temp columns set on the formal row
  const row = raw.prepare('SELECT temp_status, temp_initiator_user_id FROM conversations WHERE id=?').get(formalId);
  assert.equal(row.temp_status, null);
  assert.equal(row.temp_initiator_user_id, null);
});

test('I-23 reopen: pre-existing formal CLOSED conversation reopened to active and reused', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, t1, s1a } = await seed(db, raw);
  const closedId = Number(raw.prepare("INSERT INTO conversations (student_user_id, teacher_user_id, status) VALUES (?,?,'closed')")
    .run(s1, t1).lastInsertRowid);
  const r = await handleCreateTempConversation(db, { targetUserId: t1 }, reqOf(s1a.token));
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.conversationId, closedId, 'reuses the closed formal conversation');
  assert.equal(body.status, 'active', 'reopened to active');
  assert.equal(body.tempStatus, null, 'still formal (not a temp row)');
  assert.equal(body.iAmInitiator, false);
  const row = raw.prepare('SELECT status, temp_status FROM conversations WHERE id=?').get(closedId);
  assert.equal(row.status, 'active', 'row reopened');
  assert.equal(row.temp_status, null);
});

test('I-24 init→sent: initiator sends on init conv → tempStatus sent, tempQuota 0, convStatus temp', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, t1, s1a } = await seed(db, raw);
  const createdRes = await handleCreateTempConversation(db, { targetUserId: t1 }, reqOf(s1a.token));
  const created = await createdRes.json();
  const cid = created.conversationId;
  assert.equal(created.tempStatus, 'init', 'created without firstMessage stays init');
  const sent = await handleSendMessage(db, cid, { batch: [{ kind: 'text', body: 'hello' }] }, reqOf(s1a.token));
  assert.equal(sent.status, 201);
  const body = await sent.json();
  assert.equal(body.tempQuota, 0);
  assert.equal(body.convStatus, 'temp');
  assert.equal(body.messages.length, 1);
  const row = raw.prepare('SELECT temp_status FROM conversations WHERE id=?').get(cid);
  assert.equal(row.temp_status, 'sent', 'first send advances init→sent');
});

test('I-24 over-quota: initiator sends again on a sent temp → 409 TEMP_QUOTA_EXCEEDED', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, t1, s1a } = await seed(db, raw);
  const created = await handleCreateTempConversation(db, { targetUserId: t1 }, reqOf(s1a.token));
  const cid = (await created.json()).conversationId;
  await handleSendMessage(db, cid, { batch: [{ kind: 'text', body: 'first' }] }, reqOf(s1a.token));
  const again = await handleSendMessage(db, cid, { batch: [{ kind: 'text', body: 'second' }] }, reqOf(s1a.token));
  assert.equal(again.status, 409);
  const body = await again.json();
  assert.equal(body.code, 'CHAT_TEMP_QUOTA_EXCEEDED', 'D4 stable code for temp quota');
  // no second message landed
  const cnt = raw.prepare('SELECT COUNT(*) AS c FROM messages WHERE conversation_id=? AND sender_user_id=?').get(cid, s1).c;
  assert.equal(cnt, 1, 'only the first message exists');
});

test('I-24 receiver formalizes: receiver replies on a sent temp → temp_status NULL, convStatus active', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, t1, s1a, t1a } = await seed(db, raw);
  const created = await handleCreateTempConversation(db, { targetUserId: t1 }, reqOf(s1a.token));
  const cid = (await created.json()).conversationId;
  await handleSendMessage(db, cid, { batch: [{ kind: 'text', body: 'first' }] }, reqOf(s1a.token));
  const reply = await handleSendMessage(db, cid, { batch: [{ kind: 'text', body: 'reply' }] }, reqOf(t1a.token));
  assert.equal(reply.status, 201);
  const body = await reply.json();
  assert.equal(body.tempQuota, 0);
  assert.equal(body.convStatus, 'active', 'receiver reply formalizes the conversation');
  const row = raw.prepare('SELECT temp_status, temp_initiator_user_id FROM conversations WHERE id=?').get(cid);
  assert.equal(row.temp_status, null, 'temp_status cleared on formalize');
  assert.equal(row.temp_initiator_user_id, s1, 'temp_initiator retained as wasTemp');
});

test('I-18 init gate: non-initiator GET messages on init conv → 404; on sent conv → 200', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, t1, s1a, t1a } = await seed(db, raw);
  const created = await handleCreateTempConversation(db, { targetUserId: t1 }, reqOf(s1a.token));
  const cid = (await created.json()).conversationId;
  // init conv: non-initiator (t1) → 404
  const g1 = await handleGetMessages(db, cid, msgUrl(cid), reqOf(t1a.token));
  assert.equal(g1.status, 404, 'non-initiator on init conv 404 (no existence leak)');
  // initiator on init conv → 200 (empty messages)
  const g2 = await handleGetMessages(db, cid, msgUrl(cid), reqOf(s1a.token));
  assert.equal(g2.status, 200, 'initiator sees own init conv');
  // advance to sent, then non-initiator → 200
  await handleSendMessage(db, cid, { batch: [{ kind: 'text', body: 'first' }] }, reqOf(s1a.token));
  const g3 = await handleGetMessages(db, cid, msgUrl(cid), reqOf(t1a.token));
  assert.equal(g3.status, 200, 'non-initiator sees sent conv');
});

test('I-17 list visibility: init hidden from non-initiator; sent visible to both', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, t1, s1a, t1a } = await seed(db, raw);
  const created = await handleCreateTempConversation(db, { targetUserId: t1 }, reqOf(s1a.token));
  const cid = (await created.json()).conversationId;

  // init state: initiator sees it, non-initiator does not
  const listIRes = await handleGetConversations(db, new URL('http://localhost/api/conversations'), reqOf(s1a.token));
  const listI = await listIRes.json();
  const idsI = listI.conversations.map(c => c.id);
  assert.ok(idsI.includes(cid), 'initiator sees own init conv');
  const listNRes = await handleGetConversations(db, new URL('http://localhost/api/conversations'), reqOf(t1a.token));
  const listN = await listNRes.json();
  const idsN = listN.conversations.map(c => c.id);
  assert.ok(!idsN.includes(cid), 'non-initiator does NOT see init conv');

  // advance to sent: both see it
  await handleSendMessage(db, cid, { batch: [{ kind: 'text', body: 'first' }] }, reqOf(s1a.token));
  const listISRes = await handleGetConversations(db, new URL('http://localhost/api/conversations'), reqOf(s1a.token));
  const listIS = await listISRes.json();
  const idsIS = listIS.conversations.map(c => c.id);
  assert.ok(idsIS.includes(cid), 'initiator still sees sent conv');
  const listNSRes = await handleGetConversations(db, new URL('http://localhost/api/conversations'), reqOf(t1a.token));
  const listNS = await listNSRes.json();
  const idsNS = listNS.conversations.map(c => c.id);
  assert.ok(idsNS.includes(cid), 'non-initiator now sees sent conv');

  // list mapping exposes temp fields (camelCase) for the sent conv
  const rowIS = listIS.conversations.find(c => c.id === cid);
  assert.equal(rowIS.tempStatus, 'sent');
  assert.equal(rowIS.tempInitiatorId, s1);
  assert.equal(rowIS.iAmInitiator, true);
  assert.equal(rowIS.quota, 0);
  const rowNS = listNS.conversations.find(c => c.id === cid);
  assert.equal(rowNS.tempStatus, 'sent');
  assert.equal(rowNS.tempInitiatorId, s1);
  assert.equal(rowNS.iAmInitiator, false);
  assert.equal(rowNS.quota, 1, 'receiver quota 1 on sent temp');
});

test('I-16 temp close: capToken required, deletes row + messages (FK cascade), zero notification', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, t1, s1a } = await seed(db, raw);
  const createdRes = await handleCreateTempConversation(db, { targetUserId: t1, firstMessage: 'hi' }, reqOf(s1a.token));
  const cid = (await createdRes.json()).conversationId;
  // capToken required
  const noCap = await handleCloseConversation(db, cid, {}, reqOf(s1a.token));
  assert.equal(noCap.status, 403, 'capToken required even for temp close');
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM conversations WHERE id=?').get(cid).c, 1, 'row untouched without capToken');
  // with capToken → deletes row + cascade messages, zero notification
  const req = reqOf(s1a.token); // same req object for handler + log flush (logEvent queues on req)
  const r = await handleCloseConversation(db, cid, { capToken: await capOf(raw, s1a.sessionId, s1a.uid) }, req);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.deepEqual(body, { ok: true, closed: true, temp: true });
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM conversations WHERE id=?').get(cid).c, 0, 'row deleted');
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM messages WHERE conversation_id=?').get(cid).c, 0, 'messages cascade-deleted');
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM notifications').get().c, 0, 'zero notification on temp close');
  // logEvent 留档（flush 请求队列——同 req 对象）
  await logRequest(db, { method: 'POST', path: `/api/conversations/${cid}/close`, body: {}, status: 200, req });
  const actions = raw.prepare('SELECT action FROM activity_log ORDER BY id').all().map(r => r.action);
  assert.ok(actions.includes('conversation.temp_close'), 'conversation.temp_close logged');
});

test('I-15 my-relations includes tempStatus / tempInitiatorId', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, t1, s1a } = await seed(db, raw);
  // S5 in-flight: the shared chat/repo.js dbGetMyRelations still LEFT JOINs signing_contracts while the
  // contract schema now creates the standalone `contracts` table. Seed the legacy signing_contracts shape
  // (empty, no rows) so the join resolves — this isolates verification of the api.js temp-field mapping
  // (I-15) from the parallel S5 migration of the repo query.
  raw.exec(`CREATE TABLE IF NOT EXISTS signing_contracts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_user_id INTEGER, teacher_user_id INTEGER, conversation_id INTEGER,
    stage TEXT, signing_status TEXT, contract_status TEXT, revoked INTEGER DEFAULT 0)`);
  const createdRes = await handleCreateTempConversation(db, { targetUserId: t1, firstMessage: 'hi' }, reqOf(s1a.token));
  const cid = (await createdRes.json()).conversationId;
  const r = await handleGetMyRelations(db, reqOf(s1a.token));
  assert.equal(r.status, 200);
  const rel = (await r.json()).relations.find(x => x.conversationId === cid);
  assert.equal(rel.tempStatus, 'sent', 'tempStatus exposed on relation');
  assert.equal(rel.tempInitiatorId, s1, 'tempInitiatorId exposed on relation');
});

test('NJ-S1 security: non-initiator POST temp on a peer-init init conv → 404 (I-24 create-path gate)', async () => {
  // Student s1 creates an init temp toward t1 (no firstMessage → stays init). Teacher t1 then
  // POSTs temp for the same tuple — t1 is NOT the initiator of the init row and must get 404
  // (existence leak prevention), NOT the reused record. Tuple is UNIQUE, so no new row is created.
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, t1, s1a, t1a } = await seed(db, raw);
  const created = await handleCreateTempConversation(db, { targetUserId: t1 }, reqOf(s1a.token));
  const cid = (await created.json()).conversationId;
  const r = await handleCreateTempConversation(db, { targetUserId: s1 }, reqOf(t1a.token));
  assert.equal(r.status, 404, 'non-initiator on a peer-init init conv gets 404 (no existence leak)');
  // initiator still sees their own init conv (unchanged, not hijacked)
  const g = await handleGetMessages(db, cid, msgUrl(cid), reqOf(s1a.token));
  assert.equal(g.status, 200, 'initiator still owns the init conv');
});

test('NJ-S2 security: my-relations hides peer-init init temp from non-initiator (I-24 list gate)', async () => {
  // s1 creates an init temp toward t1 (stays init). t1's relation list must NOT include the conv;
  // s1's own list must include it. After s1 advances to sent, both see it (same visibility rule
  // as I-17 list test, asserted here through dbGetMyRelations).
  const raw = rawOf(); const db = d1Shim(raw);
  const { t1, s1, s1a, t1a } = await seed(db, raw);
  const created = await handleCreateTempConversation(db, { targetUserId: t1 }, reqOf(s1a.token));
  const cid = (await created.json()).conversationId;
  // non-initiator (t1): init conv absent
  const r1 = await handleGetMyRelations(db, reqOf(t1a.token));
  assert.equal(r1.status, 200);
  assert.ok(!(await r1.json()).relations.some(x => x.conversationId === cid), 'init conv hidden from non-initiator in relations');
  // initiator (s1): init conv present
  const r2 = await handleGetMyRelations(db, reqOf(s1a.token));
  assert.equal(r2.status, 200);
  assert.ok((await r2.json()).relations.some(x => x.conversationId === cid), 'initiator sees own init conv in relations');
  // advance to sent → visible to both
  await handleSendMessage(db, cid, { batch: [{ kind: 'text', body: 'first' }] }, reqOf(s1a.token));
  const r3 = await handleGetMyRelations(db, reqOf(t1a.token));
  assert.ok((await r3.json()).relations.some(x => x.conversationId === cid), 'sent conv visible to non-initiator in relations');
});

test('auth/validation: unauthenticated → 401; non-opposite role target → 404; missing target → 404', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, t1, s1a, t1a } = await seed(db, raw);
  // unauthenticated
  assert.equal((await handleCreateTempConversation(db, { targetUserId: t1 }, reqOf(''))).status, 401);
  // teacher→teacher (non-opposite) → 404
  const t2 = raw.prepare("SELECT id FROM users WHERE username='t2'").get().id;
  assert.equal((await handleCreateTempConversation(db, { targetUserId: t2 }, reqOf(t1a.token))).status, 404, 'teacher→teacher is not opposite role');
  // self → 404
  assert.equal((await handleCreateTempConversation(db, { targetUserId: s1 }, reqOf(s1a.token))).status, 404, 'self-target 404');
  // missing target → 404
  assert.equal((await handleCreateTempConversation(db, { targetUserId: 99999 }, reqOf(s1a.token))).status, 404, 'missing target 404');
});
