/**
 * Review eligibility gate tests (S6-R3: new trust model).
 *
 * dbCanReview(db, studentUserId, teacherUserId) requires all three conditions:
 *   1. a conversation exists for the (student, teacher) pair (any status — active or closed);
 *   2. bidirectional messages: student >=1 AND teacher >=1 user-generated messages
 *      (kind IN text/image/file; system bubbles contract/signing_* do not count);
 *   3. teacher verification approved (teacher_verifications.status='approved').
 *
 * Self-review is rejected first. Malformed ids are rejected as NO_CONVERSATION.
 *
 * Fixture shape matches the production tables exactly (conversations UNIQUE(student,teacher),
 * messages.kind CHECK incl. system kinds, teacher_verifications.status CHECK) so the assertions
 * lock the real gate semantics. Each condition is separately mutated below (removing a check
 * turns its dedicated test red) to prove the guard is load-bearing (G2 variation).
 */
import { TEST_SECRETS } from './_test-secrets.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import { dbCanReview } from '../src/server/domains/reviews/eligibility.js';

const ENV = { ...TEST_SECRETS, ADMIN_USERNAMES: ['admin_sufe'], ADMIN_DEFAULT_PASSWORD: 'test-pw-123' };

// D1 binding shim (identical to complaint.test.js): node:sqlite DatabaseSync behind the
// prepare/bind/all/first/run/batch surface the app code expects.
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

async function seed(db, raw) {
  await initDb(db, ENV);
  raw.exec(`INSERT INTO users (username,password_hash,salt,role) VALUES ('stu','h','s','student'),('tea','h','s','teacher'),('tea2','h','s','teacher')`);
  const idOf = name => raw.prepare("SELECT id FROM users WHERE username=?").get(name).id;
  return { stu: idOf('stu'), tea: idOf('tea'), tea2: idOf('tea2') };
}

function addConversation(raw, stu, tea, status = 'active') {
  return raw.prepare('INSERT INTO conversations (student_user_id, teacher_user_id, status) VALUES (?,?,?)')
    .run(stu, tea, status).lastInsertRowid;
}
function addMessage(raw, convId, senderId, kind = 'text', body = 'hi') {
  raw.prepare('INSERT INTO messages (conversation_id, sender_user_id, kind, body) VALUES (?,?,?,?)')
    .run(convId, senderId, kind, body);
}
function setVerification(raw, userId, status) {
  raw.prepare('INSERT INTO teacher_verifications (user_id, verify_code, status) VALUES (?,?,?)')
    .run(userId, 'code', status);
}

test('SELF_REVIEW: student reviewing themselves is rejected before any query', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { stu } = await seed(db, raw);
  const r = await dbCanReview(db, stu, stu);
  assert.deepEqual(r, { ok: false, reason: 'SELF_REVIEW' });
});

test('malformed ids never satisfy any condition (NO_CONVERSATION)', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { stu, tea } = await seed(db, raw);
  assert.equal((await dbCanReview(db, 0, tea)).reason, 'NO_CONVERSATION');
  assert.equal((await dbCanReview(db, stu, -1)).reason, 'NO_CONVERSATION');
  assert.equal((await dbCanReview(db, NaN, tea)).reason, 'NO_CONVERSATION');
  assert.equal((await dbCanReview(db, '5', tea)).reason, 'NO_CONVERSATION'); // string id rejected (C5)
});

test('NO_CONVERSATION: no conversation row for the pair', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { stu, tea } = await seed(db, raw);
  const r = await dbCanReview(db, stu, tea);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'NO_CONVERSATION');
});

test('NO_BIDIRECTIONAL_MESSAGES: conversation exists but zero messages', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { stu, tea } = await seed(db, raw);
  addConversation(raw, stu, tea);
  const r = await dbCanReview(db, stu, tea);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'NO_BIDIRECTIONAL_MESSAGES');
});

test('NO_BIDIRECTIONAL_MESSAGES: only the student sent messages', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { stu, tea } = await seed(db, raw);
  const conv = addConversation(raw, stu, tea);
  addMessage(raw, conv, stu);
  const r = await dbCanReview(db, stu, tea);
  assert.equal(r.reason, 'NO_BIDIRECTIONAL_MESSAGES');
});

test('NO_BIDIRECTIONAL_MESSAGES: only the teacher sent messages', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { stu, tea } = await seed(db, raw);
  const conv = addConversation(raw, stu, tea);
  addMessage(raw, conv, tea);
  const r = await dbCanReview(db, stu, tea);
  assert.equal(r.reason, 'NO_BIDIRECTIONAL_MESSAGES');
});

test('NO_BIDIRECTIONAL_MESSAGES: system bubbles (signing_*) do not count as 往来消息', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { stu, tea } = await seed(db, raw);
  const conv = addConversation(raw, stu, tea);
  addMessage(raw, conv, stu, 'signing_request');
  addMessage(raw, conv, tea, 'signing_response');
  const r = await dbCanReview(db, stu, tea);
  assert.equal(r.reason, 'NO_BIDIRECTIONAL_MESSAGES', 'kind filter: signing bubbles excluded');
});

test('NO_BIDIRECTIONAL_MESSAGES: another pair\'s conversation messages do not leak in', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { stu, tea, tea2 } = await seed(db, raw);
  const other = addConversation(raw, stu, tea2);
  addMessage(raw, other, stu);
  addMessage(raw, other, tea2);
  const r = await dbCanReview(db, stu, tea); // no conversation with tea at all
  assert.equal(r.reason, 'NO_CONVERSATION');
  // with a conversation for the pair but messages only in the other pair's conversation
  addConversation(raw, stu, tea);
  const r2 = await dbCanReview(db, stu, tea);
  assert.equal(r2.reason, 'NO_BIDIRECTIONAL_MESSAGES');
});

test('TEACHER_NOT_VERIFIED: conversation + bidirectional messages, teacher has no verification', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { stu, tea } = await seed(db, raw);
  const conv = addConversation(raw, stu, tea);
  addMessage(raw, conv, stu);
  addMessage(raw, conv, tea);
  const r = await dbCanReview(db, stu, tea);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'TEACHER_NOT_VERIFIED');
});

test('TEACHER_NOT_VERIFIED: verification pending or rejected does not qualify', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { stu, tea } = await seed(db, raw);
  const conv = addConversation(raw, stu, tea);
  addMessage(raw, conv, stu);
  addMessage(raw, conv, tea);
  setVerification(raw, tea, 'pending');
  assert.equal((await dbCanReview(db, stu, tea)).reason, 'TEACHER_NOT_VERIFIED');
  const raw2 = rawOf(); const db2 = d1Shim(raw2);
  const { stu: s2, tea: t2 } = await seed(db2, raw2);
  const c2 = addConversation(raw2, s2, t2);
  addMessage(raw2, c2, s2);
  addMessage(raw2, c2, t2);
  setVerification(raw2, t2, 'rejected');
  assert.equal((await dbCanReview(db2, s2, t2)).reason, 'TEACHER_NOT_VERIFIED');
});

test('ok: all three conditions satisfied', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { stu, tea } = await seed(db, raw);
  const conv = addConversation(raw, stu, tea);
  addMessage(raw, conv, stu, 'text', 'hello');
  addMessage(raw, conv, stu, 'image', 'thumb');
  addMessage(raw, conv, tea, 'text', 'hi back');
  setVerification(raw, tea, 'approved');
  const r = await dbCanReview(db, stu, tea);
  assert.deepEqual(r, { ok: true });
});

test('ok: previously-closed conversation (曾活跃会话) still qualifies', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { stu, tea } = await seed(db, raw);
  const conv = addConversation(raw, stu, tea, 'closed');
  addMessage(raw, conv, stu);
  addMessage(raw, conv, tea);
  setVerification(raw, tea, 'approved');
  const r = await dbCanReview(db, stu, tea);
  assert.deepEqual(r, { ok: true });
});
