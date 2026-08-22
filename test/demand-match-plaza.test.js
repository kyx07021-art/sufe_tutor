/**
 * PA-1d-F3 (1101): demand plaza match fields wired to the S4 match module.
 *
 * GET /api/demands (I-34) rows for a logged-in teacher must carry real matchScore/matchCount
 * computed from that teacher's profile — previously a hardcoded null placeholder. sort=match
 * must order by matchScore (nulls last, time order as the stable tiebreak).
 *
 * Wiring reference: teacher/list.js S4-12 — matchDegree/matchCount from teacher/match/ and
 * makeComparator from teacher/list.js are reused verbatim (no implementation copy; match/ is
 * the single source of the score). normalizeTeacher/normalizeDemand defensively consume the
 * mapped profile/demand rows, so no duplication of the scoring algorithm here.
 *
 * Mutation guards (G2):
 *  - removing the `d.matchScore/matchCount` assignment in demand/api.js handleGetDemands
 *    turns "teacher sees real match" red (matchScore would be null);
 *  - removing the in-handler `items.sort(makeComparator(...))` for sort=match turns the
 *    sort-order assertion red (SQL time order would put the low-match row first).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { TEST_SECRETS } from './_test-secrets.js';
import { initDb } from '../src/server/core/db.js';
import { tokenDigest } from '../src/server/core/crypto.js';
import { handleCreateDemand, handleGetDemands } from '../src/server/domains/demand/api.js';

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

async function seedUser(db, raw, { username, role }) {
  raw.prepare("INSERT INTO users (username,password_hash,salt,role) VALUES (?,?,'s',?)").run(username, 'h', role);
  const id = raw.prepare('SELECT id FROM users WHERE username=?').get(username).id;
  const token = username + '-token';
  raw.prepare('INSERT INTO auth_sessions (token_hash,user_id,label,expires_at) VALUES (?,?,?,?)')
    .run(await tokenDigest(token), id, 'x', '2099-01-01 00:00:00');
  return { id, token };
}
const reqOf = token => ({ headers: new Headers({ 'X-Auth-Token': token }) });

// Matchable teacher profile: math/physics, shanghai 杨浦区·四平路街道, offline, [150,180],
// personality [patience,humorous], male. With baseDemand below this is the FULL-hit fixture
// shape from match-degree-server.test.js (score 98, matchCount 4).
async function seedTeacherProfile(raw, userId) {
  raw.prepare(`INSERT INTO teacher_profiles (user_id, province, grade, gender, subjects, gaokao_scores,
      price_min, price_max, teaching_method, personality_tags, address)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(userId, 'shanghai', 'senior1', 'male', JSON.stringify(['math', 'physics']), '[]',
      150, 180, 'offline', JSON.stringify(['patience', 'humorous']), '杨浦区·四平路街道');
}

// Demand A (high match): math, offline, [100,200] overlaps [150,180], personality/gender hit.
// Demand B (low match): english (teacher misses subject) + [1,50] (price miss).
const baseDemand = { province: 'shanghai', grade: 'senior1', subject: 'math',
  teachingMethod: 'offline', addressArea: '杨浦区·四平路街道', budgetMin: 100, budgetMax: 200,
  preferredTags: ['patience', 'strict'], preferredGender: 'male', additionalInfo: '' };
const lowDemand = { ...baseDemand, subject: 'english', budgetMin: 1, budgetMax: 50 };

test('teacher with a profile sees real matchScore/matchCount on plaza rows (I-34)', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  await initDb(db, ENV);
  const stu = await seedUser(db, raw, { username: 'stu1', role: 'student' });
  assert.equal((await handleCreateDemand(db, baseDemand, reqOf(stu.token))).status, 200);
  assert.equal((await handleCreateDemand(db, lowDemand, reqOf(stu.token))).status, 200);

  const tea = await seedUser(db, raw, { username: 'tea1', role: 'teacher' });
  await seedTeacherProfile(raw, tea.id);

  const r = await handleGetDemands(db, new URL('http://x/api/demands'), reqOf(tea.token));
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.items.length, 2, 'both open demands listed');
  const bySubject = Object.fromEntries(body.items.map(x => [x.subject, x]));
  // Every row carries a real (non-null) match field — the PA-1d-F3 core assertion.
  for (const x of body.items) {
    assert.ok(Number.isInteger(x.matchScore) && x.matchScore >= 0 && x.matchScore <= 100,
      `matchScore is a real 0-100 int, got ${x.matchScore}`);
    assert.ok(Number.isInteger(x.matchCount) && x.matchCount >= 0,
      `matchCount is a real non-negative int, got ${x.matchCount}`);
  }
  // Exact pinned values (match-degree-server.test.js fixture shape): math full-hit -> 98/4,
  // english price-miss -> 43/2. A mutation in the scoring or in this wiring turns these red.
  assert.equal(bySubject.math.matchScore, 98, 'math demand full-hit score');
  assert.equal(bySubject.math.matchCount, 4, 'math demand screening hits');
  assert.equal(bySubject.english.matchScore, 43, 'english demand price-miss score');
  assert.equal(bySubject.english.matchCount, 2, 'english demand screening hits (gender+personality)');
});

test('sort=match orders by matchScore desc, time order as the stable tiebreak', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  await initDb(db, ENV);
  const stu = await seedUser(db, raw, { username: 'stu1', role: 'student' });
  // Create the HIGH-match demand first, then the LOW-match one. SQL time order (created_at
  // DESC, id DESC) puts the low-match row first; match sort must promote the high-match row.
  assert.equal((await handleCreateDemand(db, baseDemand, reqOf(stu.token))).status, 200);
  assert.equal((await handleCreateDemand(db, lowDemand, reqOf(stu.token))).status, 200);

  const tea = await seedUser(db, raw, { username: 'tea1', role: 'teacher' });
  await seedTeacherProfile(raw, tea.id);

  const r = await handleGetDemands(db, new URL('http://x/api/demands?sort=match&order=desc'), reqOf(tea.token));
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.items.length, 2);
  // Mutation guard: removing the in-handler match sort leaves SQL time order -> english (low
  // match, created later / higher id) first -> this assertion goes red.
  assert.equal(body.items[0].subject, 'math', 'high-match row sorts first under sort=match');
  assert.equal(body.items[1].subject, 'english', 'low-match row sorts last');
  assert.ok(body.items[0].matchScore > body.items[1].matchScore, 'matchScore strictly desc');
});

test('teacher without a profile -> all match fields null, time order preserved (fallback)', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  await initDb(db, ENV);
  const stu = await seedUser(db, raw, { username: 'stu1', role: 'student' });
  assert.equal((await handleCreateDemand(db, baseDemand, reqOf(stu.token))).status, 200);
  assert.equal((await handleCreateDemand(db, lowDemand, reqOf(stu.token))).status, 200);

  const tea = await seedUser(db, raw, { username: 'tea1', role: 'teacher' }); // no teacher_profiles row

  const r = await handleGetDemands(db, new URL('http://x/api/demands?sort=match&order=desc'), reqOf(tea.token));
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.items.length, 2);
  assert.ok(body.items.every(x => x.matchScore === null && x.matchCount === null),
    'no profile -> both match fields null (frontend falls back to hidden)');
  // All-null sort is stable -> the SQL time order (created_at DESC, id DESC) is preserved:
  // the low-match demand created second has the higher id and stays first.
  assert.equal(body.items[0].subject, 'english', 'time-order fallback preserved under sort=match');
});

test('student viewer -> all match fields null (unchanged placeholder semantics)', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  await initDb(db, ENV);
  const stu = await seedUser(db, raw, { username: 'stu1', role: 'student' });
  assert.equal((await handleCreateDemand(db, baseDemand, reqOf(stu.token))).status, 200);

  const r = await handleGetDemands(db, new URL('http://x/api/demands?sort=match'), reqOf(stu.token));
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(body.items.every(x => x.matchScore === null && x.matchCount === null),
    'non-teacher viewer gets null match fields (I-34 is teacher-context match)');
});
