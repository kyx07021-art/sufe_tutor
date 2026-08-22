/**
 * S2-T8: temp conversation state machine — full lifecycle + I-23 variants + I-17/I-18/I-15 exposure.
 *
 * Covers (interfaces.md §17/§19, authoritative shapes):
 *   I-23  POST /api/conversations/temp { targetUserId, firstMessage? } →
 *         { conversationId, status, tempStatus, tempInitiatorId, iAmInitiator, quota }
 *   I-24  state machine: init (initiator-only, quota 1) → first message atomically → sent
 *         (receiver sees + red dot + can reply, initiator over-quota) → receiver reply →
 *         formal (temp_status NULL, temp_initiator retained = wasTemp).
 *   I-17  list: init only initiator sees / sent both see; rows carry tempStatus/tempInitiatorId/quota/iAmInitiator.
 *   I-18  detail: init non-initiator → 404; conversation object carries tempStatus/tempInitiatorId.
 *   I-15  my-relations: relations carry tempStatus/tempInitiatorId.
 *
 * The initiator-quota 409, I-23 target-validation 400/404/401 and firstMessage-length negatives live
 * in temp-conversation-quota.test.js; temp close (I-16) lives in temp-close.test.js.
 *
 * Notes:
 *   - initDb's seedAdmins occupies users id=1 — every seeded id is taken from the INSERT
 *     return value (G3: fixtures match production shape), never hardcoded.
 *   - The d1Shim / seed patterns are verbatim from test/conversation-close.test.js and
 *     test/chat-send-batch.test.js (shared infra).
 */
import { test, describe } from 'node:test';
import { TEST_SECRETS } from './_test-secrets.js';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import {
  handleCreateTempConversation, handleSendMessage, handleGetMessages,
  handleGetConversations, handleGetMyRelations,
} from '../src/server/domains/chat/api.js';
import { tokenDigest } from '../src/server/core/crypto.js';
import { TEMP_STATUS } from '../src/shared/enums.js';

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
const msgUrl = convId => new URL(`http://localhost/api/conversations/${convId}/messages`);
const listUrl = () => new URL('http://localhost/api/conversations');

// Seed s1 (student), t1/t2 (teachers), s2 (student) + auth sessions. Ids from INSERT return values.
async function seed(db, raw) {
  await initDb(db, ENV);
  const s1Id = Number(raw.prepare("INSERT INTO users (username,password_hash,salt,role) VALUES ('s1','h','s','student')").run().lastInsertRowid);
  const t1Id = Number(raw.prepare("INSERT INTO users (username,password_hash,salt,role) VALUES ('t1','h','s','teacher')").run().lastInsertRowid);
  const t2Id = Number(raw.prepare("INSERT INTO users (username,password_hash,salt,role) VALUES ('t2','h','s','teacher')").run().lastInsertRowid);
  const s2Id = Number(raw.prepare("INSERT INTO users (username,password_hash,salt,role) VALUES ('s2','h','s','student')").run().lastInsertRowid);
  const mk = async (name, uid) => {
    const token = `${name}-token`, sessionId = `sess-${name}`;
    raw.prepare('INSERT INTO auth_sessions (token_hash,user_id,label,expires_at,session_id) VALUES (?,?,?,?,?)')
      .run(await tokenDigest(token), uid, 'x', '2099-01-01 00:00:00', sessionId);
    return { token, sessionId, uid };
  };
  return {
    s1: await mk('s1', s1Id), t1: await mk('t1', t1Id), t2: await mk('t2', t2Id), s2: await mk('s2', s2Id),
    s1Id, t1Id, t2Id, s2Id,
  };
}

describe('S2 temp conversation state machine', () => {
  test('full lifecycle: init (initiator-only) → first msg sent → receiver reply formalizes → both free', async () => {
    const raw = rawOf(); const db = d1Shim(raw);
    const { s1, t1 } = await seed(db, raw);

    // 1) Student creates a temp to the teacher without firstMessage → init row, quota 1.
    const create = await handleCreateTempConversation(db, { targetUserId: t1.uid }, reqOf(s1.token));
    assert.equal(create.status, 200);
    const c = await create.json();
    const convId = c.conversationId;
    assert.equal(c.status, 'active');
    assert.equal(c.tempStatus, TEMP_STATUS.INIT);
    assert.equal(c.tempInitiatorId, s1.uid);
    assert.equal(c.iAmInitiator, true);
    assert.equal(c.quota, 1);
    assert.equal(raw.prepare('SELECT temp_status FROM conversations WHERE id=?').get(convId).temp_status, TEMP_STATUS.INIT);

    // 2) I-18: non-initiator (teacher) reading an init temp → 404 (existence-leak prevention).
    assert.equal((await handleGetMessages(db, convId, msgUrl(convId), reqOf(t1.token))).status, 404);

    // 3) I-17: init visible to the initiator only, with temp fields + quota/quotaRemaining 1.
    const s1List = (await (await handleGetConversations(db, listUrl(), reqOf(s1.token))).json()).conversations;
    const initRow = s1List.find(x => x.conversationId === convId);
    assert.ok(initRow, 'initiator sees the init conversation (0 messages still shown)');
    assert.equal(initRow.tempStatus, TEMP_STATUS.INIT);
    assert.equal(initRow.tempInitiatorId, s1.uid);
    assert.equal(initRow.iAmInitiator, true);
    assert.equal(initRow.quota, 1);
    assert.equal(initRow.quotaRemaining, 1);
    const t1ListInit = (await (await handleGetConversations(db, listUrl(), reqOf(t1.token))).json()).conversations;
    assert.equal(t1ListInit.find(x => x.conversationId === convId), undefined, 'non-initiator does NOT see the init conversation');

    // 4) Initiator's first message advances init→sent atomically (I-24): tempQuota 0, convStatus temp.
    const first = await handleSendMessage(db, convId, { batch: [{ kind: 'text', body: 'hi, I need a tutor' }] }, reqOf(s1.token));
    assert.equal(first.status, 201);
    const f = await first.json();
    assert.equal(f.messages.length, 1);
    assert.equal(f.tempQuota, 0);
    assert.equal(f.convStatus, 'temp');
    assert.equal(raw.prepare('SELECT temp_status FROM conversations WHERE id=?').get(convId).temp_status, TEMP_STATUS.SENT);
    assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM messages WHERE conversation_id=?').get(convId).c, 1, 'first message landed');

    // 5) I-17: sent visible to both; initiator quotaRemaining 0, receiver quotaRemaining 1 + red dot (unread 1).
    const t1List = (await (await handleGetConversations(db, listUrl(), reqOf(t1.token))).json()).conversations;
    const sentRow = t1List.find(x => x.conversationId === convId);
    assert.ok(sentRow, 'receiver sees the sent conversation');
    assert.equal(sentRow.tempStatus, TEMP_STATUS.SENT);
    assert.equal(sentRow.iAmInitiator, false);
    assert.equal(sentRow.quota, 1);
    assert.equal(sentRow.quotaRemaining, 1);
    assert.equal(sentRow.unread, 1, 'receiver gets a red dot for the unread first message');
    const s1ListSent = (await (await handleGetConversations(db, listUrl(), reqOf(s1.token))).json()).conversations;
    assert.equal(s1ListSent.find(x => x.conversationId === convId).quotaRemaining, 0, 'initiator over quota on sent');

    // 6) Receiver replies → formalizes: temp_status NULL, temp_initiator retained (= wasTemp).
    const reply = await handleSendMessage(db, convId, { batch: [{ kind: 'text', body: 'sure, tell me your grade' }] }, reqOf(t1.token));
    assert.equal(reply.status, 201);
    const rp = await reply.json();
    assert.equal(rp.tempQuota, 0);
    assert.equal(rp.convStatus, 'active');
    const row = raw.prepare('SELECT temp_status, temp_initiator_user_id FROM conversations WHERE id=?').get(convId);
    assert.equal(row.temp_status, null, 'temp_status NULL after receiver reply → formal');
    assert.equal(row.temp_initiator_user_id, s1.uid, 'temp_initiator retained as wasTemp');

    // 7) Both send freely after formalization (no quota block).
    assert.equal((await handleSendMessage(db, convId, { batch: [{ kind: 'text', body: 'second from initiator' }] }, reqOf(s1.token))).status, 201);
    assert.equal((await handleSendMessage(db, convId, { batch: [{ kind: 'text', body: 'second from receiver' }] }, reqOf(t1.token))).status, 201);

    // 8) I-18 detail exposes temp fields: formalized → tempStatus null, tempInitiatorId retained; 4 messages total.
    const detail = await (await handleGetMessages(db, convId, msgUrl(convId), reqOf(s1.token))).json();
    assert.equal(detail.conversation.tempStatus, null);
    assert.equal(detail.conversation.tempInitiatorId, s1.uid);
    assert.equal(detail.messages.length, 4);
  });

  test('I-23 variant: reusing an existing temp returns the same conversationId in its current state', async () => {
    const raw = rawOf(); const db = d1Shim(raw);
    const { s1, t1 } = await seed(db, raw);
    const first = await (await handleCreateTempConversation(db, { targetUserId: t1.uid }, reqOf(s1.token))).json();
    const again = await (await handleCreateTempConversation(db, { targetUserId: t1.uid }, reqOf(s1.token))).json();
    assert.equal(again.conversationId, first.conversationId, 'reuses the existing temp row');
    assert.equal(again.status, 'active');
    assert.equal(again.tempStatus, TEMP_STATUS.INIT);
    assert.equal(again.iAmInitiator, true);
    assert.equal(again.quota, 1);
    assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM conversations').get().c, 1, 'no duplicate row created');
  });

  test('I-23 variant: formal active conversation is reused (tempStatus null, iAmInitiator false, quota null)', async () => {
    const raw = rawOf(); const db = d1Shim(raw);
    const { s1, t1 } = await seed(db, raw);
    const cid = Number(raw.prepare('INSERT INTO conversations (student_user_id, teacher_user_id) VALUES (?,?)').run(s1.uid, t1.uid).lastInsertRowid);
    const r = await (await handleCreateTempConversation(db, { targetUserId: t1.uid }, reqOf(s1.token))).json();
    assert.equal(r.conversationId, cid, 'reuses the formal conversation id');
    assert.equal(r.status, 'active');
    assert.equal(r.tempStatus, null);
    assert.equal(r.tempInitiatorId, null);
    assert.equal(r.iAmInitiator, false);
    assert.equal(r.quota, null);
    assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM conversations').get().c, 1, 'no new row');
  });

  test('I-23 variant: closed formal conversation is reopened to active and reused', async () => {
    const raw = rawOf(); const db = d1Shim(raw);
    const { s1, t1 } = await seed(db, raw);
    const cid = Number(raw.prepare("INSERT INTO conversations (student_user_id, teacher_user_id, status) VALUES (?,?,'closed')").run(s1.uid, t1.uid).lastInsertRowid);
    const r = await (await handleCreateTempConversation(db, { targetUserId: t1.uid }, reqOf(s1.token))).json();
    assert.equal(r.conversationId, cid, 'reuses the closed conversation id');
    assert.equal(r.status, 'active', 'reopened to active');
    assert.equal(r.tempStatus, null);
    assert.equal(raw.prepare('SELECT status FROM conversations WHERE id=?').get(cid).status, 'active', 'DB row reopened');
  });

  test('I-23 variant: create with firstMessage sends it immediately (sent, quota 0, one message landed)', async () => {
    const raw = rawOf(); const db = d1Shim(raw);
    const { s1, t1 } = await seed(db, raw);
    const r = await (await handleCreateTempConversation(db, { targetUserId: t1.uid, firstMessage: 'hello teacher' }, reqOf(s1.token))).json();
    assert.equal(r.status, 'active');
    assert.equal(r.tempStatus, TEMP_STATUS.SENT, 'firstMessage sent atomically → sent');
    assert.equal(r.quota, 0);
    assert.equal(r.iAmInitiator, true);
    assert.equal(raw.prepare('SELECT temp_status FROM conversations WHERE id=?').get(r.conversationId).temp_status, TEMP_STATUS.SENT);
    assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM messages WHERE conversation_id=?').get(r.conversationId).c, 1, 'first message landed');
  });

  test('I-17 visibility matrix: init hidden from non-initiator / sent both see / formal both see', async () => {
    const raw = rawOf(); const db = d1Shim(raw);
    const { s1, t1, t2, s2 } = await seed(db, raw);
    // init row (s1→t1, initiator s1, no messages)
    const initConv = Number(raw.prepare('INSERT INTO conversations (student_user_id, teacher_user_id, temp_status, temp_initiator_user_id) VALUES (?,?,?,?)')
      .run(s1.uid, t1.uid, TEMP_STATUS.INIT, s1.uid).lastInsertRowid);
    // sent row (s1→t2, initiator s1, one message)
    const sentConv = Number(raw.prepare('INSERT INTO conversations (student_user_id, teacher_user_id, temp_status, temp_initiator_user_id) VALUES (?,?,?,?)')
      .run(s1.uid, t2.uid, TEMP_STATUS.SENT, s1.uid).lastInsertRowid);
    raw.prepare('INSERT INTO messages (conversation_id, sender_user_id, kind, body) VALUES (?,?,?,?)').run(sentConv, s1.uid, 'text', 'first');
    // formal row (s2→t1, temp_status NULL)
    const formalConv = Number(raw.prepare('INSERT INTO conversations (student_user_id, teacher_user_id) VALUES (?,?)').run(s2.uid, t1.uid).lastInsertRowid);

    const list = async who => (await (await handleGetConversations(db, listUrl(), reqOf(who.token))).json()).conversations;
    // init: s1 (initiator) sees it, t1 (non-initiator) hidden
    assert.ok((await list(s1)).some(x => x.conversationId === initConv && x.tempStatus === TEMP_STATUS.INIT), 'initiator sees init row');
    assert.equal((await list(t1)).some(x => x.conversationId === initConv), false, 'non-initiator init row hidden');
    // sent: both s1 (initiator) and t2 (receiver) see it
    assert.ok((await list(s1)).some(x => x.conversationId === sentConv && x.tempStatus === TEMP_STATUS.SENT), 'initiator sees sent row');
    assert.ok((await list(t2)).some(x => x.conversationId === sentConv && x.tempStatus === TEMP_STATUS.SENT && x.quotaRemaining === 1), 'receiver sees sent row with quotaRemaining 1');
    // formal: both s2 and t1 see it, tempStatus null
    assert.ok((await list(s2)).some(x => x.conversationId === formalConv && x.tempStatus === null), 'student sees formal row');
    assert.ok((await list(t1)).some(x => x.conversationId === formalConv && x.tempStatus === null), 'teacher sees formal row');
  });

  test('I-15 relations expose tempStatus/tempInitiatorId on the relation object', async () => {
    const raw = rawOf(); const db = d1Shim(raw);
    const { s1, t1 } = await seed(db, raw);
    const c = await (await handleCreateTempConversation(db, { targetUserId: t1.uid }, reqOf(s1.token))).json();
    const convId = c.conversationId;
    // sent state
    await handleSendMessage(db, convId, { batch: [{ kind: 'text', body: 'hi' }] }, reqOf(s1.token));
    const sent = (await (await handleGetMyRelations(db, reqOf(s1.token))).json()).relations.find(x => x.conversationId === convId);
    assert.ok(sent, 'relation present for the temp conversation');
    assert.equal(sent.tempStatus, TEMP_STATUS.SENT);
    assert.equal(sent.tempInitiatorId, s1.uid);
    assert.equal(sent.other.id, t1.uid);
    assert.equal(sent.other.role, 'teacher');
    // formalized state: tempStatus null, temp_initiator retained
    await handleSendMessage(db, convId, { batch: [{ kind: 'text', body: 'reply' }] }, reqOf(t1.token));
    const formal = (await (await handleGetMyRelations(db, reqOf(s1.token))).json()).relations.find(x => x.conversationId === convId);
    assert.equal(formal.tempStatus, null);
    assert.equal(formal.tempInitiatorId, s1.uid, 'temp initiator retained after formalization');
  });
});
