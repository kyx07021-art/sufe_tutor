/**
 * S2-T8: temp conversation close () — temp close deletes the row + FK-cascades messages with
 * ZERO notification, unlike formal close which runs the cascade + CONVERSATION_CLOSED.
 *
 * Covers (interfaces.md /):
 * - capToken required (no/wrong capToken → 403 REAUTH_FAILED, row survives).
 * - Successful temp close → 200 { ok, closed, temp } ; row deleted; messages FK-cascaded;
 * notifications table stays at 0 for both users.
 * - Re-close after delete → 404 CONVERSATION_NOT_FOUND (idempotent no-op, still zero notifications).
 * - Non-participant close → 404 (existence not leaked).
 *
 * The formal close path is covered by test/conversation-close.test.js.
 */
import { test, describe } from 'node:test';
import { TEST_SECRETS } from './_test-secrets.js';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import { handleCloseConversation, handleCreateTempConversation } from '../src/server/domains/chat/api.js';
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

// capToken issue (per-user-per-session): same shape as conversation-close.test.js
// (danger_caps PK is (user_id, session_id); token stored as SHA-256 digest).
const capOf = async (raw, sessionId, uid, value = 'cap') => {
  raw.prepare('INSERT INTO danger_caps (user_id, session_id, token_hash, expires_at) VALUES (?,?,?,?)')
    .run(uid, sessionId, await tokenDigest(value), '2099-01-01 00:00:00');
  return value;
};

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

describe('S2 temp conversation close (I-16)', () => {
  test('temp close requires capToken: no/wrong → 403 REAUTH_FAILED, row survives', async () => {
    const raw = rawOf(); const db = d1Shim(raw);
    const { s1, t1 } = await seed(db, raw);
    const c = await (await handleCreateTempConversation(db, { targetUserId: t1.uid }, reqOf(s1.token))).json();
    const convId = c.conversationId;
    assert.equal((await handleCloseConversation(db, convId, {}, reqOf(s1.token))).status, 403, 'no capToken');
    assert.equal((await handleCloseConversation(db, convId, { capToken: 'wrong' }, reqOf(s1.token))).status, 403, 'wrong capToken');
    assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM conversations WHERE id=?').get(convId).c, 1, 'row survives failed close');
    assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM notifications').get().c, 0, 'zero notifications');
  });

  test('temp close deletes row + messages (FK cascade), zero notifications for both users', async () => {
    const raw = rawOf(); const db = d1Shim(raw);
    const { s1, t1 } = await seed(db, raw);
    // temp with a message (sent state) via the firstMessage path
    const c = await (await handleCreateTempConversation(db, { targetUserId: t1.uid, firstMessage: 'hello' }, reqOf(s1.token))).json();
    const convId = c.conversationId;
    assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM messages WHERE conversation_id=?').get(convId).c, 1, 'one message before close');

    const r = await handleCloseConversation(db, convId, { capToken: await capOf(raw, s1.sessionId, s1.uid) }, reqOf(s1.token));
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, closed: true, temp: true });

    assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM conversations WHERE id=?').get(convId).c, 0, 'conversation row deleted');
    assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM messages WHERE conversation_id=?').get(convId).c, 0, 'messages FK-cascade-deleted');
    assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM notifications').get().c, 0, 'zero notifications (no CONVERSATION_CLOSED for temp close)');
  });

  test('re-close after a temp delete → 404 (idempotent no-op), still zero notifications', async () => {
    const raw = rawOf(); const db = d1Shim(raw);
    const { s1, t1 } = await seed(db, raw);
    const c = await (await handleCreateTempConversation(db, { targetUserId: t1.uid }, reqOf(s1.token))).json();
    const convId = c.conversationId;
    assert.equal((await handleCloseConversation(db, convId, { capToken: await capOf(raw, s1.sessionId, s1.uid) }, reqOf(s1.token))).status, 200);
    const again = await handleCloseConversation(db, convId, { capToken: await capOf(raw, s1.sessionId, s1.uid) }, reqOf(s1.token));
    assert.equal(again.status, 404, 'row already gone → CONVERSATION_NOT_FOUND');
    assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM notifications').get().c, 0, 'zero notifications across both closes');
  });

  test('non-participant temp close → 404 (existence not leaked), row survives', async () => {
    const raw = rawOf(); const db = d1Shim(raw);
    const { s1, t1, s2 } = await seed(db, raw);
    const c = await (await handleCreateTempConversation(db, { targetUserId: t1.uid }, reqOf(s1.token))).json();
    const convId = c.conversationId;
    const r = await handleCloseConversation(db, convId, { capToken: await capOf(raw, s2.sessionId, s2.uid) }, reqOf(s2.token));
    assert.equal(r.status, 404, 'non-participant close rejected');
    assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM conversations WHERE id=?').get(convId).c, 1, 'row survives');
    assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM notifications').get().c, 0, 'zero notifications');
  });
});
