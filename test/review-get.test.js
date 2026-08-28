/**
 * guard tests: reviews GET endpoints C5 strict query parsing.
 *
 * GET /api/reviews?teacherUserId= and GET /api/admin/reviews?teacherUserId= accept only
 * /^\d+$/ ids. Dirty input ('5abc', empty string) -> 400 INVALID_PARAMS instead of parseInt
 * prefix-truncation ('5abc' -> 5) silently hitting the primary key (parseIdParam precedent,
 * util.js). Absent param is preserved as a no-filter path (public list -> empty 200,
 * admin list -> no teacher filter) so the route-smoke test keeps passing.
 *
 * Mutation guard: restoring `parseInt(url.searchParams.get('teacherUserId'))` makes the
 * dirty-param assertions below turn red (5abc -> 5 -> 200, not 400).
 */
import { test } from 'node:test';
import { TEST_SECRETS } from './_test-secrets.js';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import { handleGetReviews, handleAdminReviews, handleReviewAction } from '../src/server/domains/reviews/api.js';
import { handleLogin } from '../src/server/domains/auth/api.js';
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
      if (!stmts.length) throw new Error('D1 batch requires at least one statement');
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

async function seed(db, raw) {
  await initDb(db, ENV);
  raw.exec(`INSERT INTO users (username,password_hash,salt,role) VALUES ('stu','h','s','student'),('tea','h','s','teacher')`);
  const teaId = raw.prepare("SELECT id FROM users WHERE username='tea'").get().id;
  const stuId = raw.prepare("SELECT id FROM users WHERE username='stu'").get().id;
  // Teacher profile row (rating recompute target) + pending review.
  raw.prepare('INSERT INTO teacher_profiles (user_id) VALUES (?)').run(teaId);
  const r = raw.prepare("INSERT INTO reviews (teacher_user_id, reviewer_user_id, rating, comment, status) VALUES (?,?,?,?,'pending')")
    .run(teaId, stuId, 5, '教学清晰');
  return { teaId, stuId, reviewId: Number(r.lastInsertRowid) };
}

async function adminToken(db, raw) {
  const res = await handleLogin(db, { identifier: 'admin_sufe', password: 'test-pw-123' }, { headers: new Headers() });
  const data = await res.json();
  return data.authToken;
}

const req = token => ({ headers: new Headers(token ? { 'X-Auth-Token': token } : {}) });
const dbOf = () => { const raw = new DatabaseSync(':memory:'); raw.exec('PRAGMA foreign_keys = ON'); return { raw, db: d1Shim(raw) }; };

// Review moderation is a dangerous op () and needs a capToken. Directly seed a danger_caps
// row so the full confirmDangerOtp SQL path runs (session-bound, consume-on-use).
async function capOf(raw, token) {
  const sess = raw.prepare('SELECT user_id, session_id FROM auth_sessions WHERE token_hash=?').get(await tokenDigest(token));
  const cap = `cap-${Math.random().toString(36).slice(2)}`;
  raw.prepare('INSERT INTO danger_caps (user_id, session_id, token_hash, expires_at) VALUES (?,?,?,?)')
    .run(sess.user_id, sess.session_id, await tokenDigest(cap), '2099-01-01 00:00:00');
  return cap;
}

test('PA-1f-F3: GET /api/reviews?teacherUserId=5abc -> 400 (no parseInt prefix-truncation)', async () => {
  const { raw, db } = dbOf();
  await seed(db, raw);
  const res = await handleGetReviews(db, new URL('http://x/api/reviews?teacherUserId=5abc'), req({}));
  assert.equal(res.status, 400, 'dirty id rejected, not parsed as teacher 5');
  const data = await res.json();
  assert.equal(data.code, 'COMMON_INVALID_PARAMS', 'stable INVALID_PARAMS code');
});

test('PA-1f-F3: GET /api/reviews?teacherUserId= (empty present) -> 400', async () => {
  const { raw, db } = dbOf();
  await seed(db, raw);
  const res = await handleGetReviews(db, new URL('http://x/api/reviews?teacherUserId='), req({}));
  assert.equal(res.status, 400, 'empty present value is invalid');
});

test('PA-1f-F3: GET /api/reviews?teacherUserId=<valid> -> 200 approved list', async () => {
  const { raw, db } = dbOf();
  const { teaId, reviewId } = await seed(db, raw);
  const token = await adminToken(db, raw);
  await handleReviewAction(db, reviewId, 'approve', { capToken: await capOf(raw, token) }, req(token));

  const res = await handleGetReviews(db, new URL(`http://x/api/reviews?teacherUserId=${teaId}`), req({}));
  assert.equal(res.status, 200, 'valid teacher id returns the approved list');
  const data = await res.json();
  assert.equal(data.reviews.length, 1, '1 approved review');
  assert.equal(data.reviews[0].teacher_user_id, teaId, 'scoped to the requested teacher');
});

test('PA-1f-F3: GET /api/reviews?teacherUserId=5abc (guest, no token) still -> 400 before auth', async () => {
  const { raw, db } = dbOf();
  await seed(db, raw);
  const res = await handleGetReviews(db, new URL('http://x/api/reviews?teacherUserId=5abc'), { headers: new Headers() });
  assert.equal(res.status, 400, 'dirty param rejected regardless of auth state');
});

test('PA-1f-F3: GET /api/admin/reviews?teacherUserId=5abc -> 400 (admin filter strict)', async () => {
  const { raw, db } = dbOf();
  await seed(db, raw);
  const token = await adminToken(db, raw);
  const res = await handleAdminReviews(db, new URL('http://x/api/admin/reviews?teacherUserId=5abc'), req(token));
  assert.equal(res.status, 400, 'admin teacher filter rejects dirty id');
});
