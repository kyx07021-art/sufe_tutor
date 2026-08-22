/**
 * S2-T8: temp conversation quota & input-validation negatives.
 *
 * Covers (interfaces.md §17/§19):
 *   I-19/20/21 send-path: initiator's 2nd message on a sent temp → 409 TEMP_QUOTA_EXCEEDED
 *     (service-side hard gate; the frontend hides the input as the primary defense).
 *   I-18 init gate: non-initiator GET / send on an init temp → 404 (existence-leak prevention).
 *   I-23 target validation: missing target → 400; self / wrong-role / nonexistent target → 404;
 *     unauthenticated → 401.
 *   I-23 firstMessage cap: firstMessage > LIMITS.TEMP_FIRST_MSG_MAX → 400.
 *
 * The positive lifecycle (init → sent → formal) lives in temp-conversation-state-machine.test.js;
 * temp close (I-16) lives in temp-close.test.js.
 */
import { test, describe } from 'node:test';
import { TEST_SECRETS } from './_test-secrets.js';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import {
  handleCreateTempConversation, handleSendMessage, handleGetMessages,
} from '../src/server/domains/chat/api.js';
import { tokenDigest } from '../src/server/core/crypto.js';
import { TEMP_STATUS } from '../src/shared/enums.js';
import { LIMITS } from '../src/shared/config.js';
import { MSG, CODES } from '../src/shared/codes.js';

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

async function seed(db, raw) {
  await initDb(db, ENV);
  const s1Id = Number(raw.prepare("INSERT INTO users (username,password_hash,salt,role) VALUES ('s1','h','s','student')").run().lastInsertRowid);
  const t1Id = Number(raw.prepare("INSERT INTO users (username,password_hash,salt,role) VALUES ('t1','h','s','teacher')").run().lastInsertRowid);
  const s2Id = Number(raw.prepare("INSERT INTO users (username,password_hash,salt,role) VALUES ('s2','h','s','student')").run().lastInsertRowid);
  const mk = async (name, uid) => {
    const token = `${name}-token`, sessionId = `sess-${name}`;
    raw.prepare('INSERT INTO auth_sessions (token_hash,user_id,label,expires_at,session_id) VALUES (?,?,?,?,?)')
      .run(await tokenDigest(token), uid, 'x', '2099-01-01 00:00:00', sessionId);
    return { token, sessionId, uid };
  };
  return { s1: await mk('s1', s1Id), t1: await mk('t1', t1Id), s2: await mk('s2', s2Id), s1Id, t1Id, s2Id };
}

describe('S2 temp conversation quota & validation', () => {
  test('initiator 2nd message on a sent temp → 409 TEMP_QUOTA_EXCEEDED, nothing extra lands, state stays sent', async () => {
    const raw = rawOf(); const db = d1Shim(raw);
    const { s1, t1 } = await seed(db, raw);
    const c = await (await handleCreateTempConversation(db, { targetUserId: t1.uid }, reqOf(s1.token))).json();
    const convId = c.conversationId;
    await handleSendMessage(db, convId, { batch: [{ kind: 'text', body: 'first' }] }, reqOf(s1.token));
    assert.equal(raw.prepare('SELECT temp_status FROM conversations WHERE id=?').get(convId).temp_status, TEMP_STATUS.SENT, 'precondition: sent');

    const second = await handleSendMessage(db, convId, { batch: [{ kind: 'text', body: 'second' }] }, reqOf(s1.token));
    assert.equal(second.status, 409, 'initiator over-quota');
    const body = await second.json();
    assert.equal(body.error, MSG.TEMP_QUOTA_EXCEEDED, 'single-source message text');
    assert.equal(body.code, CODES.TEMP_QUOTA_EXCEEDED, 'stable error code for the frontend branch');
    assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM messages WHERE conversation_id=?').get(convId).c, 1, 'no second message landed');
    assert.equal(raw.prepare('SELECT temp_status FROM conversations WHERE id=?').get(convId).temp_status, TEMP_STATUS.SENT, 'state not advanced by the rejected send');
    // Mutation intent (G2): removing the initiator-quota guard in handleSendBatch turns the
    // 409 assertion red. Not runnable here without editing src — verified manually at audit time.
  });

  test('PA-1c-F1: initiator sends a 2+ item batch on an init temp → 400 INVALID_PARAMS (quota is exactly one message)', async () => {
    const raw = rawOf(); const db = d1Shim(raw);
    const { s1, t1 } = await seed(db, raw);
    const c = await (await handleCreateTempConversation(db, { targetUserId: t1.uid }, reqOf(s1.token))).json();
    const convId = c.conversationId;
    assert.equal(c.tempStatus, TEMP_STATUS.INIT, 'precondition: init row, quota 1');

    const multi = await handleSendMessage(db, convId, { batch: [{ kind: 'text', body: 'a' }, { kind: 'text', body: 'b' }] }, reqOf(s1.token));
    assert.equal(multi.status, 400, 'multi-item batch on an init temp is rejected');
    assert.equal((await multi.json()).code, CODES.INVALID_PARAMS, 'stable INVALID_PARAMS code');
    assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM messages WHERE conversation_id=?').get(convId).c, 0, 'nothing landed');
    assert.equal(raw.prepare('SELECT temp_status FROM conversations WHERE id=?').get(convId).temp_status, TEMP_STATUS.INIT, 'state not advanced by the rejected batch');

    const single = await handleSendMessage(db, convId, { batch: [{ kind: 'text', body: 'ok' }] }, reqOf(s1.token));
    assert.equal(single.status, 201, 'a single message on an init temp still lands');
    assert.equal(raw.prepare('SELECT temp_status FROM conversations WHERE id=?').get(convId).temp_status, TEMP_STATUS.SENT, 'first message formalizes');
    // Mutation intent (G2): removing the batch.length === 1 guard in handleSendBatch turns the
    // multi-item 400 assertion red (it would return 201 and land 2 messages). Verified at audit time.
  });

  test('non-initiator GET messages / send on an init temp → 404 (existence not leaked)', async () => {
    const raw = rawOf(); const db = d1Shim(raw);
    const { s1, t1 } = await seed(db, raw);
    const c = await (await handleCreateTempConversation(db, { targetUserId: t1.uid }, reqOf(s1.token))).json();
    const convId = c.conversationId;
    assert.equal((await handleGetMessages(db, convId, msgUrl(convId), reqOf(t1.token))).status, 404, 'non-initiator read blocked');
    assert.equal((await handleSendMessage(db, convId, { batch: [{ kind: 'text', body: 'x' }] }, reqOf(t1.token))).status, 404, 'non-initiator send blocked');
    assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM messages WHERE conversation_id=?').get(convId).c, 0, 'no message from the non-initiator');
  });

  test('I-23 target validation: missing → 400; self / wrong-role / nonexistent → 404; unauthenticated → 401', async () => {
    const raw = rawOf(); const db = d1Shim(raw);
    const { s1, t1, s2 } = await seed(db, raw);
    assert.equal((await handleCreateTempConversation(db, {}, reqOf(s1.token))).status, 400, 'missing targetUserId');
    assert.equal((await handleCreateTempConversation(db, { targetUserId: s1.uid }, reqOf(s1.token))).status, 404, 'self target');
    assert.equal((await handleCreateTempConversation(db, { targetUserId: s2.uid }, reqOf(s1.token))).status, 404, 'student → student wrong role');
    assert.equal((await handleCreateTempConversation(db, { targetUserId: 999999 }, reqOf(s1.token))).status, 404, 'nonexistent target');
    assert.equal((await handleCreateTempConversation(db, { targetUserId: t1.uid }, reqOf(''))).status, 401, 'no auth token');
    assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM conversations').get().c, 0, 'no conversation created by any rejected request');
  });

  test('I-23 firstMessage > TEMP_FIRST_MSG_MAX → 400 (single-source limit)', async () => {
    const raw = rawOf(); const db = d1Shim(raw);
    const { s1, t1 } = await seed(db, raw);
    const tooLong = 'x'.repeat(LIMITS.TEMP_FIRST_MSG_MAX + 1);
    const r = await handleCreateTempConversation(db, { targetUserId: t1.uid, firstMessage: tooLong }, reqOf(s1.token));
    assert.equal(r.status, 400, 'firstMessage exceeds cap');
    // Observation for the module owner: the handler validates the length AFTER creating the
    // init row (dbCreateTempConversation), so a rejected request leaves an orphan init row
    // behind that only the initiator sees. The documented contract only mandates the 400 —
    // whether the orphan row is acceptable (or validation should run pre-create) is a module decision.
  });

  test('I-23 firstMessage at the cap boundary (== TEMP_FIRST_MSG_MAX) is accepted and sent atomically', async () => {
    const raw = rawOf(); const db = d1Shim(raw);
    const { s1, t1 } = await seed(db, raw);
    const atCap = await handleCreateTempConversation(db, { targetUserId: t1.uid, firstMessage: 'x'.repeat(LIMITS.TEMP_FIRST_MSG_MAX) }, reqOf(s1.token));
    assert.equal(atCap.status, 200, 'firstMessage at the cap boundary is accepted');
    const body = await atCap.json();
    assert.equal(body.tempStatus, TEMP_STATUS.SENT, 'boundary message sent atomically');
    assert.equal(body.quota, 0);
  });
});
