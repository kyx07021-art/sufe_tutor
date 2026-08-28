/**
 * S6-C4 feedbacks anonymous identity model (server side).
 *
 * New-site interface contract (docs/interfaces.md , feedback float window):
 * POST /api/feedbacks - anonymous submit: body { kind: bug|suggestion|report, title,
 * content, contact?, attrs{} }; clientToken identifies the
 * anonymous author (X-Client-Token header or body.clientToken).
 * GET /api/feedbacks/mine - anonymous tickets: clientToken via header or query.
 * Logged-in users use the same endpoints; user id takes priority over clientToken.
 *
 * Behaviors locked here (revert any of these and the corresponding test turns red):
 * anonymous rows store client_token with NULL user_id (revert = drop client_token from INSERT).
 * anonymous submit without clientToken -> 400 (revert = drop the clientToken check).
 * kind whitelist bug|suggestion|report; report accepted verbatim (revert = whitelist complaint).
 * subject is stored only for report (revert = subject condition uses kind==='complaint').
 * admin list keeps anonymous rows (revert = INNER JOIN drops them).
 * report resolution uses FEEDBACK_COMPLAINT_RESOLVED receipt (revert = kind==='complaint').
 * anonymous my-feedbacks requires clientToken (revert = drop the requirement -> empty/200).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import { TEST_SECRETS } from './_test-secrets.js';
import { tokenDigest } from '../src/server/core/crypto.js';
import {
  handleCreateFeedback, handleMyFeedbacks, handleAdminFeedbacks, handleResolveFeedback,
} from '../src/server/domains/complaints/api.js';
import { migrate as migrateComplaints } from '../src/server/domains/complaints/schema.js';

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

const headers = h => new Headers(h || {});
const reqOf = token => ({ headers: headers({ 'X-Auth-Token': token }) });
const reqAnon = clientToken => ({ headers: headers({ 'X-Client-Token': clientToken }) });
const urlOf = () => new URL('http://x/api/feedbacks/mine');

async function seed(db, raw) {
  await initDb(db, ENV); // creates feedbacks table + seeds admin_sufe
  raw.exec(`INSERT INTO users (username,password_hash,salt,role) VALUES ('stu','h','s','student'),('tea','h','s','teacher')`);
  const idOf = name => raw.prepare('SELECT id FROM users WHERE username=?').get(name).id;
  const mkToken = async name => {
    const token = `${name}-token`;
    raw.prepare('INSERT INTO auth_sessions (token_hash,user_id,label,expires_at) VALUES (?,?,?,?)')
      .run(await tokenDigest(token), idOf(name), 'x', '2099-01-01 00:00:00');
    return token;
  };
  return { stu: idOf('stu'), tea: idOf('tea'), stuToken: await mkToken('stu'), teaToken: await mkToken('tea'),
    adminToken: await mkToken('admin_sufe') };
}

test('M1 anonymous submit: NULL user_id + client_token stored; contact/attrs persisted', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  await initDb(db, ENV);
  const c = await handleCreateFeedback(db,
    { kind: 'bug', title: 'Crash', content: 'App crashes on login', contact: 'a@b.com', attrs: { page: 'login', os: 'win' } },
    reqAnon('anon-uuid-1'));
  assert.equal(c.status, 201);
  const row = raw.prepare('SELECT * FROM feedbacks ORDER BY id DESC LIMIT 1').get();
  assert.equal(row.user_id, null, 'anonymous rows carry NULL user_id');
  assert.equal(row.client_token, 'anon-uuid-1', 'anonymous identity stored in client_token');
  assert.equal(row.kind, 'bug');
  assert.equal(row.contact, 'a@b.com', 'anonymous contact persisted');
  assert.deepEqual(JSON.parse(row.attrs), { page: 'login', os: 'win' }, 'attrs JSON persisted');
});

test('logged-in submit: user id takes priority, clientToken ignored', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { stu, stuToken } = await seed(db, raw);
  const c = await handleCreateFeedback(db,
    { kind: 'suggestion', title: 'Nice work', content: 'Keep it up', clientToken: 'anon-uuid-9' },
    reqOf(stuToken));
  assert.equal(c.status, 201);
  const row = raw.prepare('SELECT * FROM feedbacks ORDER BY id DESC LIMIT 1').get();
  assert.equal(row.user_id, stu, 'logged-in author stored by user id');
  assert.equal(row.client_token, '', 'clientToken ignored for logged-in author');
  assert.equal(row.kind, 'suggestion');
});

test('M3 kind whitelist bug|suggestion|report; report accepted; unknown falls back to suggestion', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  await initDb(db, ENV);
  await handleCreateFeedback(db, { kind: 'report', title: 'X', content: 'Report content' }, reqAnon('t-a'));
  let r = raw.prepare('SELECT * FROM feedbacks ORDER BY id DESC LIMIT 1').get();
  assert.equal(r.kind, 'report', 'report kind stored verbatim');
  await handleCreateFeedback(db, { kind: 'spam', title: 'X', content: 'body' }, reqAnon('t-b'));
  r = raw.prepare('SELECT * FROM feedbacks ORDER BY id DESC LIMIT 1').get();
  assert.equal(r.kind, 'suggestion', 'unknown kind falls back to suggestion');
});

test('M4 subject stored only for report; bug/illegal subject cleared', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  await initDb(db, ENV);
  // report with a whitelisted target -> subject persisted
  await handleCreateFeedback(db, { kind: 'report', subject: 'teacher', title: 'X', content: 'Report a teacher' }, reqAnon('t-a'));
  let r = raw.prepare('SELECT * FROM feedbacks ORDER BY id DESC LIMIT 1').get();
  assert.equal(r.kind, 'report'); assert.equal(r.subject, 'teacher', 'report subject stored');
  // report with illegal target -> cleared (server does not trust client)
  await handleCreateFeedback(db, { kind: 'report', subject: 'hacker', title: 'X', content: 'Bad target' }, reqAnon('t-b'));
  r = raw.prepare('SELECT * FROM feedbacks ORDER BY id DESC LIMIT 1').get();
  assert.equal(r.subject, '', 'illegal report subject cleared');
  // bug with a subject -> cleared (subject is report-only)
  await handleCreateFeedback(db, { kind: 'bug', subject: 'teacher', title: 'X', content: 'Bug body' }, reqAnon('t-c'));
  r = raw.prepare('SELECT * FROM feedbacks ORDER BY id DESC LIMIT 1').get();
  assert.equal(r.kind, 'bug'); assert.equal(r.subject, '', 'bug subject always empty');
});

test('M2 anonymous submit without clientToken -> 400; empty content -> 400', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  await initDb(db, ENV);
  const noToken = await handleCreateFeedback(db, { kind: 'bug', title: 'X', content: 'body' }, { headers: headers() });
  assert.equal(noToken.status, 400, 'anonymous submit requires clientToken');
  const empty = await handleCreateFeedback(db, { kind: 'bug', title: 'X', content: '   ' }, reqAnon('t-a'));
  assert.equal(empty.status, 400, 'empty content rejected');
  const noHeader = await handleCreateFeedback(db, { kind: 'bug', title: 'X', content: 'body', clientToken: 'from-body' }, { headers: headers() });
  assert.equal(noHeader.status, 201, 'clientToken accepted from body');
});

test('my feedbacks: logged-in queries by user id, keeps user isolation', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { stu, tea, stuToken, teaToken } = await seed(db, raw);
  const { dbCreateFeedback } = await import('../src/server/domains/complaints/repo.js');
  await dbCreateFeedback(db, { userId: stu, kind: 'bug', title: 'A', content: 'a' });
  await dbCreateFeedback(db, { userId: tea, kind: 'suggestion', title: 'B', content: 'b' });
  const mine = await handleMyFeedbacks(db, urlOf(), reqOf(stuToken));
  const list = (await mine.json()).feedbacks;
  assert.equal(list.length, 1, 'only own rows returned');
  assert.equal(list[0].title, 'A');
  const t = await handleMyFeedbacks(db, urlOf(), reqOf(teaToken));
  assert.equal((await t.json()).feedbacks[0].title, 'B');
  const attrs = await handleMyFeedbacks(db, urlOf(), reqOf(stuToken));
  assert.deepEqual((await attrs.json()).feedbacks[0].attrs, {}, 'attrs deserialized via mapper');
});

test('M7 my feedbacks anonymous: clientToken via header or query; per-token isolation', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  await initDb(db, ENV);
  await handleCreateFeedback(db, { kind: 'bug', title: 'Token1', content: 'one' }, reqAnon('tok-1'));
  await handleCreateFeedback(db, { kind: 'report', subject: 'post', title: 'Token2', content: 'two' }, reqAnon('tok-2'));
  const byHeader = await handleMyFeedbacks(db, urlOf(), reqAnon('tok-1'));
  const h = (await byHeader.json()).feedbacks;
  assert.equal(h.length, 1, 'header clientToken returns only its own anonymous rows');
  assert.equal(h[0].title, 'Token1');
  assert.equal(h[0].user_id, null, 'anonymous rows expose NULL user_id');
  const byQuery = await handleMyFeedbacks(db, new URL('http://x/api/feedbacks/mine?clientToken=tok-2'), { headers: headers() });
  const q = (await byQuery.json()).feedbacks;
  assert.equal(q.length, 1, 'query clientToken works');
  assert.equal(q[0].title, 'Token2');
  // no identity at all -> 401
  const none = await handleMyFeedbacks(db, urlOf(), { headers: headers() });
  assert.equal(none.status, 401, 'my-feedbacks without user nor clientToken rejected');
});

test('M5 admin list keeps anonymous rows (LEFT JOIN); logged-in rows carry username', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { stuToken } = await seed(db, raw);
  // seed created admin_sufe; mint an admin session before the admin call
  const adminId = raw.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").get().id;
  raw.prepare('INSERT INTO auth_sessions (token_hash,user_id,label,expires_at) VALUES (?,?,?,?)')
    .run(await tokenDigest('admin-token'), adminId, 'x', '2099-01-01 00:00:00');
  await handleCreateFeedback(db, { kind: 'bug', title: 'Anon', content: 'a' }, reqAnon('tok-1'));
  await handleCreateFeedback(db, { kind: 'suggestion', title: 'LoggedIn', content: 'b' }, reqOf(stuToken));
  const adm = await handleAdminFeedbacks(db, new URL('http://x/api/feedbacks'), reqOf('admin-token'));
  const list = (await adm.json()).feedbacks;
  assert.equal(list.length, 2, 'both anonymous and logged-in rows listed');
  const anon = list.find(f => f.title === 'Anon');
  const li = list.find(f => f.title === 'LoggedIn');
  assert.ok(anon && anon.username === null, 'anonymous row has NULL username (LEFT JOIN)');
  assert.ok(li && li.username === 'stu', 'logged-in row carries username');
});

test('M6 resolve receipt: report -> FEEDBACK_COMPLAINT_RESOLVED; bug/suggestion -> FEEDBACK_RESOLVED; idempotent', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { stu, adminToken } = await seed(db, raw);
  const { dbCreateFeedback } = await import('../src/server/domains/complaints/repo.js');
  await dbCreateFeedback(db, { userId: stu, kind: 'report', subject: 'platform', title: 'R', content: 'r' });
  await dbCreateFeedback(db, { userId: stu, kind: 'bug', title: 'B', content: 'b' });
  await handleResolveFeedback(db, 1, {}, reqOf(adminToken));
  let n = raw.prepare('SELECT type FROM notifications ORDER BY id DESC LIMIT 1').get();
  assert.equal(n.type, 'FEEDBACK_COMPLAINT_RESOLVED', 'report uses the complaint-resolution receipt');
  await handleResolveFeedback(db, 2, {}, reqOf(adminToken));
  n = raw.prepare('SELECT type FROM notifications ORDER BY id DESC LIMIT 1').get();
  assert.equal(n.type, 'FEEDBACK_RESOLVED', 'bug uses the generic receipt');
  const before = raw.prepare('SELECT COUNT(*) c FROM notifications').get().c;
  await handleResolveFeedback(db, 1, {}, reqOf(adminToken)); // already resolved
  assert.equal(raw.prepare('SELECT COUNT(*) c FROM notifications').get().c, before, 'idempotent: no duplicate notification');
});

test('schema migrate: v2 table (complaint CHECK, NOT NULL user_id) rebuilt to report model, complaint rows mapped', async () => {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  raw.exec('CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, password_hash TEXT, salt TEXT, role TEXT)'); // FK parent for feedbacks
  raw.exec(`INSERT INTO users (id, username, password_hash, salt, role) VALUES (1,'u1','h','s','student'),(2,'u2','h','s','student'),(3,'u3','h','s','student')`);
  // Simulate the v2 production feedbacks shape: kind CHECK without report, user_id NOT NULL, no new columns.
  raw.exec(`CREATE TABLE feedbacks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    kind TEXT NOT NULL DEFAULT 'suggestion' CHECK(kind IN ('bug','suggestion','complaint')),
    subject TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
    created_at DATETIME DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`);
  raw.exec(`INSERT INTO feedbacks (user_id, kind, subject, title, content, status) VALUES
    (1, 'complaint', 'teacher', 'C1', 'comp body', 'open'),
    (2, 'bug', '', 'B1', 'bug body', 'resolved'),
    (3, 'suggestion', '', 'S1', 'sug body', 'open')`);
  const db = d1Shim(raw);
  await migrateComplaints(db, { phase: 'postCreate' });
  const ddl = raw.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='feedbacks'`).get().sql;
  assert.ok(ddl.includes("'report'"), 'rebuilt CHECK includes report');
  assert.ok(ddl.includes('client_token'), 'rebuilt table has client_token column');
  assert.ok(ddl.includes('contact') && ddl.includes('attrs'), 'rebuilt table has contact/attrs columns');
  const rows = raw.prepare('SELECT id, user_id, kind, subject, client_token, status FROM feedbacks ORDER BY id').all();
  assert.equal(rows[0].kind, 'report', 'legacy complaint row mapped to report');
  assert.equal(rows[0].subject, 'teacher', 'report subject preserved');
  assert.equal(rows[0].client_token, '', 'legacy rows default empty client_token');
  assert.equal(rows[1].kind, 'bug', 'bug row untouched');
  assert.equal(rows[2].kind, 'suggestion', 'suggestion row untouched');
  assert.equal(rows.length, 3, 'all rows preserved');
  raw.close();
});

test('anonymous resolve: marks resolved, no notification (no user channel), no crash', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { adminToken } = await seed(db, raw);
  await handleCreateFeedback(db, { kind: 'suggestion', title: 'AnonResolve', content: 'x' }, reqAnon('tok-1'));
  const id = raw.prepare('SELECT id FROM feedbacks ORDER BY id DESC LIMIT 1').get().id;
  const r = await handleResolveFeedback(db, id, {}, reqOf(adminToken));
  assert.equal(r.status, 200);
  assert.equal(raw.prepare("SELECT status FROM feedbacks WHERE id=?").get(id).status, 'resolved', 'anonymous ticket resolved');
  assert.equal(raw.prepare('SELECT COUNT(*) c FROM notifications').get().c, 0, 'no notification for anonymous author');
});
