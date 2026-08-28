/**
 * conversation-list response shape contract (type-3 cross-module shape).
 *
 * Locks the GET /api/conversations row shape to interfaces.md (conversationId /
 * otherName / avatar / lastMessage / lastAt / status / unread / tempStatus / tempInitiatorId /
 * quota / quotaRemaining) and the peer-name/avatar resolution by the two-party tuple. The old
 * raw snake_case columns (id / last_body / unread_count / student_name / teacher_name / ...) are
 * intentionally absent — the API surface is the contract (, no legacy spread).
 *
 * Mutation guards (— the corresponding assertion goes red when the source is reverted):
 * - Reverting handleGetConversations to the old `{ ...c, ... }` shape → every `conversationId` /
 * `otherName` / `lastMessage` / `unread` / `quotaRemaining` assertion here is undefined → red.
 * - Removing the teacher display-name JOIN (repo COALESCE(NULLIF(tp.teacher_name,''),ut.username))
 * → the `otherName === '王老师'` assertion falls back to the username → red.
 */
import { test } from 'node:test';
import { TEST_SECRETS } from './_test-secrets.js';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import { handleGetConversations } from '../src/server/domains/chat/api.js';
import { LIMITS } from '../src/shared/config.js';
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
const listUrl = () => new URL('http://localhost/api/conversations');

async function seed(db, raw) {
  await initDb(db, ENV);
  const ins = sql => Number(raw.prepare(sql).run().lastInsertRowid);
  const s1 = ins("INSERT INTO users (username,password_hash,salt,role,avatar) VALUES ('s1','h','s','student','s-avatar')");
  const t1 = ins("INSERT INTO users (username,password_hash,salt,role,avatar) VALUES ('t1','h','s','teacher','t-avatar')");
  // otherName prefers the teacher display name (teacher_name) over the username.
  raw.prepare('INSERT INTO teacher_profiles (user_id, teacher_name) VALUES (?,?)').run(t1, '王老师');
  const mk = async (name, uid) => {
    const token = `${name}-token`, sessionId = `sess-${name}`;
    raw.prepare('INSERT INTO auth_sessions (token_hash,user_id,label,expires_at,session_id) VALUES (?,?,?,?,?)')
      .run(await import('../src/server/core/crypto.js').then(m => m.tokenDigest(token)), uid, 'x', '2099-01-01 00:00:00', sessionId);
    return { token, sessionId, uid };
  };
  return { s1, t1, s1a: await mk('s1', s1), t1a: await mk('t1', t1) };
}

test('I-17 list: formal conversation row is camelCase contract shape with peer otherName/avatar and unread', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, t1, s1a, t1a } = await seed(db, raw);
  const cid = Number(raw.prepare('INSERT INTO conversations (student_user_id, teacher_user_id) VALUES (?,?)').run(s1, t1).lastInsertRowid);
  // teacher sends two text messages; student read cursor 0 → student unread 2.
  raw.prepare('INSERT INTO messages (conversation_id, sender_user_id, kind, body) VALUES (?,?,?,?)').run(cid, t1, 'text', '第一条');
  const secondAt = '2026-08-23 10:00:00';
  raw.prepare('INSERT INTO messages (conversation_id, sender_user_id, kind, body, created_at) VALUES (?,?,?,?,?)').run(cid, t1, 'text', '第二条', secondAt);

  // student's list: peer = teacher
  const sList = (await (await handleGetConversations(db, listUrl(), reqOf(s1a.token))).json()).conversations;
  assert.equal(sList.length, 1, 'one formal conversation');
  const row = sList[0];
  assert.equal(row.conversationId, cid);
  assert.equal(row.status, 'active');
  assert.equal(row.otherName, '王老师', 'peer otherName = teacher display name (teacher_name preferred)');
  assert.equal(row.avatar, 't-avatar', 'peer avatar = teacher avatar');
  assert.equal(row.lastMessage, '第二条', 'lastMessage = latest text message body');
  assert.equal(row.lastMessageKind, 'text');
  assert.equal(row.lastAt, secondAt);
  assert.equal(row.unread, 2, 'student unread = teacher messages above read cursor');
  assert.equal(row.tempStatus, null);
  assert.equal(row.tempInitiatorId, null);
  assert.equal(row.iAmInitiator, false);
  assert.equal(row.quota, null, 'formal conversation has no temp quota');
  assert.equal(row.quotaRemaining, null, 'formal conversation has no temp quota remaining');
  // contract closure: raw snake_case columns are NOT on the API surface.
  for (const old of ['id', 'last_body', 'last_kind', 'last_sender', 'unread_count', 'student_name', 'teacher_name', 'student_avatar', 'teacher_avatar']) {
    assert.ok(!(old in row), `old raw field ${old} must not leak into the I-17 row`);
  }

  // teacher's list: peer = student (username, no student display-name concept)
  const tList = (await (await handleGetConversations(db, listUrl(), reqOf(t1a.token))).json()).conversations;
  const tRow = tList.find(x => x.conversationId === cid);
  assert.ok(tRow, 'teacher sees the conversation');
  assert.equal(tRow.otherName, 's1', 'peer otherName = student username');
  assert.equal(tRow.avatar, 's-avatar', 'peer avatar = student avatar');
  assert.equal(tRow.unread, 0, 'teacher unread = 0 (no student messages)');
});

test('I-17 list: temp conversation row exposes tempStatus/tempInitiatorId/quota/quotaRemaining per contract', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, t1, s1a, t1a } = await seed(db, raw);
  // temp init (student initiates, no first message) → sent after the initiator sends.
  const cid = Number(raw.prepare('INSERT INTO conversations (student_user_id, teacher_user_id, temp_status, temp_initiator_user_id) VALUES (?,?,?,?)')
    .run(s1, t1, TEMP_STATUS.INIT, s1).lastInsertRowid);
  raw.prepare('INSERT INTO messages (conversation_id, sender_user_id, kind, body) VALUES (?,?,?,?)').run(cid, s1, 'text', 'hi');
  raw.prepare('UPDATE conversations SET temp_status=? WHERE id=?').run(TEMP_STATUS.SENT, cid);

  // initiator (student): sent → iAmInitiator true, quota spent.
  const sRow = (await (await handleGetConversations(db, listUrl(), reqOf(s1a.token))).json()).conversations.find(x => x.conversationId === cid);
  assert.ok(sRow, 'initiator sees the sent temp row');
  assert.equal(sRow.tempStatus, TEMP_STATUS.SENT);
  assert.equal(sRow.tempInitiatorId, s1);
  assert.equal(sRow.iAmInitiator, true);
  assert.equal(sRow.quota, LIMITS.TEMP_SEND_QUOTA, 'quota = original temp allocation');
  assert.equal(sRow.quotaRemaining, 0, 'initiator spent their single message');
  assert.equal(sRow.otherName, '王老师', 'peer otherName still resolved for temp rows');

  // receiver (teacher): iAmInitiator false, still has a reply quota.
  const tRow = (await (await handleGetConversations(db, listUrl(), reqOf(t1a.token))).json()).conversations.find(x => x.conversationId === cid);
  assert.ok(tRow, 'receiver sees the sent temp row');
  assert.equal(tRow.tempStatus, TEMP_STATUS.SENT);
  assert.equal(tRow.iAmInitiator, false);
  assert.equal(tRow.quota, LIMITS.TEMP_SEND_QUOTA, 'quota = original temp allocation');
  assert.equal(tRow.quotaRemaining, 1, 'receiver still has a reply quota remaining');
  assert.equal(tRow.otherName, 's1', 'peer otherName = student username');
});
