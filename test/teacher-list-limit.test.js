/**
 * PA-1d-F6 DoS guard: the public teacher plaza list (I-29 GET /api/teachers) must be
 * capped at LIMITS.PUBLIC_LIST_MAX — the same shared cap the demand square applies
 * (demand/repo.js). Before this fix the public SELECT loaded the whole teacher_profiles
 * table and the handler ran per-row match-degree over all of it, so a growing table
 * meant every request cost unbounded table load + match computation.
 *
 * Mutation guard: drop `LIMIT ${LIMITS.PUBLIC_LIST_MAX}` from dbGetTeachers and the
 * seeded PUBLIC_LIST_MAX+5 rows all come back -> the count assertions go red.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { TEST_SECRETS } from './_test-secrets.js';
import { initDb } from '../src/server/core/db.js';
import { tokenDigest } from '../src/server/core/crypto.js';
import { dbGetTeachers } from '../src/server/domains/teacher/repo.js';
import { handleGetTeachers } from '../src/server/domains/teacher/list.js';
import { LIMITS } from '../src/shared/config.js';

const ENV = { ...TEST_SECRETS, ADMIN_USERNAMES: ['admin_sufe'], ADMIN_DEFAULT_PASSWORD: 'test-pw-123' };

function d1Shim(raw) {
  return {
    prepare(sql) {
      const st = { _sql: sql, _params: [] };
      st.bind = (...p) => { st._params = p; return st; };
      st.all = (...p) => ({ results: raw.prepare(st._sql).all(...(p.length ? p : st._params)) });
      st.first = (...p) => raw.prepare(st._sql).get(...(p.length ? p : st._params)) ?? undefined;
      st.run = (...p) => {
        const info = raw.prepare(st._sql).run(...(p.length ? p : st._params));
        return { meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
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

// Seed `n` teachers with profiles directly via SQL (fast: no per-row encryption).
async function seedTeachers(raw, n) {
  for (let i = 0; i < n; i++) {
    raw.prepare("INSERT INTO users (username,password_hash,salt,role) VALUES (?,?,'s','teacher')").run(`t${i}`, 'h');
  }
  const rows = raw.prepare("SELECT id FROM users WHERE role='teacher' ORDER BY id").all();
  for (const r of rows) raw.prepare('INSERT INTO teacher_profiles (user_id) VALUES (?)').run(r.id);
}

// Seed one student + an auth session; returns the session token. I-29 is login-gated
// (no guest browsing, S6 §17) so the endpoint test must authenticate.
async function seedStudent(raw) {
  raw.prepare("INSERT INTO users (username,password_hash,salt,role) VALUES ('s1','h','s','student')").run();
  const stu = raw.prepare("SELECT id FROM users WHERE username='s1'").get().id;
  const token = 'stu-token';
  raw.prepare('INSERT INTO auth_sessions (token_hash,user_id,label,expires_at) VALUES (?,?,?,?)')
    .run(await tokenDigest(token), stu, 'x', '2099-01-01 00:00:00');
  return token;
}

test('dbGetTeachers public list is capped at PUBLIC_LIST_MAX (DoS guard)', async () => {
  const raw = rawOf();
  const db = d1Shim(raw);
  await initDb(db, ENV);
  await seedTeachers(raw, LIMITS.PUBLIC_LIST_MAX + 5);

  const list = await dbGetTeachers(db, {});
  assert.equal(list.length, LIMITS.PUBLIC_LIST_MAX,
    `public list truncated to PUBLIC_LIST_MAX (${LIMITS.PUBLIC_LIST_MAX}), not all ${LIMITS.PUBLIC_LIST_MAX + 5} rows`);
  // Mutation guard: removing `LIMIT ${LIMITS.PUBLIC_LIST_MAX}` from the SQL returns
  // PUBLIC_LIST_MAX+5 rows -> the equality assertion above goes red.
});

test('GET /api/teachers (I-29) caps items/teachers/total at PUBLIC_LIST_MAX', async () => {
  const raw = rawOf();
  const db = d1Shim(raw);
  await initDb(db, ENV);
  await seedTeachers(raw, LIMITS.PUBLIC_LIST_MAX + 5);
  const token = await seedStudent(raw);

  // I-29 is login-gated (no guest browsing, S6 §17) — the endpoint test authenticates.
  const res = await handleGetTeachers(db, new Request('http://x/api/teachers', { method: 'GET', headers: { 'X-Auth-Token': token } }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.items) && Array.isArray(body.teachers), 'dual-key array');
  assert.equal(body.items.length, LIMITS.PUBLIC_LIST_MAX, 'items capped');
  assert.equal(body.teachers.length, LIMITS.PUBLIC_LIST_MAX, 'teachers capped');
  assert.equal(body.total, LIMITS.PUBLIC_LIST_MAX, 'total is the post-cap count');
});

test('admin view stays uncapped (management list not limited by PUBLIC_LIST_MAX)', async () => {
  const raw = rawOf();
  const db = d1Shim(raw);
  await initDb(db, ENV);
  await seedTeachers(raw, LIMITS.PUBLIC_LIST_MAX + 5);

  const adminList = await dbGetTeachers(db, { adminView: true });
  assert.equal(adminList.length, LIMITS.PUBLIC_LIST_MAX + 5,
    'adminView is NOT truncated — management list keeps the full table');
});

// ============================================================================
// PA-1d-F6b fixture: 250 teachers — the 50 OLDEST carry price 50 / subjects
// ['english'] / rating 5 / experience 10 / gender 'female' / tags ['patience'];
// the 200 NEWEST carry price 300 / subjects ['math'] / rating 1 / experience 1 /
// gender 'male' / tags ['punctual']. The PUBLIC_LIST_MAX=200 cap truncates the
// table to the 200 newest, so JS-only sort/filter over that truncated set would
// NEVER see an old row. The SQL pushdown (buildTeacherPublicQuery) applies
// filters + ORDER BY BEFORE the LIMIT, so every assertion below targets a row that
// lives ONLY in the older-50 block — any revert to the JS-on-truncated-set
// behavior makes them red (G2 mutation guard).
// ============================================================================
async function seedTeacher250(raw) {
  const n = LIMITS.PUBLIC_LIST_MAX + 50; // 250
  for (let i = 0; i < n; i++) {
    raw.prepare("INSERT INTO users (username,password_hash,salt,role) VALUES (?,?,'s','teacher')").run(`u${i}`, 'h');
  }
  const rows = raw.prepare("SELECT id FROM users WHERE role='teacher' ORDER BY id").all();
  const ins = raw.prepare(`INSERT INTO teacher_profiles
    (user_id, price_min, price_max, subjects, rating, experience_years, gender, personality_tags, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  for (const r of rows.slice(0, 50)) { // 50 oldest
    ins.run(r.id, 50, 50, '["english"]', 5, 10, 'female', '["patience"]', '2026-01-01 00:00:00');
  }
  for (const r of rows.slice(50)) { // 200 newest
    ins.run(r.id, 300, 300, '["math"]', 1, 1, 'male', '["punctual"]', '2026-08-01 00:00:00');
  }
}

async function seedStudentWithDemand(raw, subject) {
  const token = await seedStudent(raw);
  const stu = raw.prepare("SELECT id FROM users WHERE username='s1'").get().id;
  raw.prepare("INSERT INTO student_demands (user_id, subject, grade, province) VALUES (?,?,'senior3','shanghai')")
    .run(stu, subject);
  return token;
}

const LIST = url => new Request('http://x/api/teachers' + url, { method: 'GET', headers: { 'X-Auth-Token': 'stu-token' } });

test('PA-1d-F6b: sort=price ASC ranks the global cheapest (older rows survive truncation)', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  await initDb(db, ENV);
  await seedTeacher250(raw);
  await seedStudent(raw);
  const res = await handleGetTeachers(db, LIST('?sort=price&order=asc'));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.items.length, LIMITS.PUBLIC_LIST_MAX, 'capped at PUBLIC_LIST_MAX');
  assert.equal(body.items[0].priceMin, 50, 'global cheapest (old teacher) leads price-ASC — not the recent-200 (300) set');
  assert.ok(body.items.some(i => i.priceMin === 50), 'price-50 rows present despite living outside the recent-200');
});

test('PA-1d-F6b: sort=rating DESC ranks the global highest rating (old 5.0 leads)', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  await initDb(db, ENV);
  await seedTeacher250(raw);
  await seedStudent(raw);
  const res = await handleGetTeachers(db, LIST('?sort=rating&order=desc'));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.items[0].rating, 5, 'highest rating (old teacher) leads rating-DESC');
  assert.ok(body.items.some(i => i.rating === 5), 'rating-5 rows present');
});

test('PA-1d-F6b: sort=exp DESC ranks the global highest experience (old 10y leads)', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  await initDb(db, ENV);
  await seedTeacher250(raw);
  await seedStudent(raw);
  const res = await handleGetTeachers(db, LIST('?sort=exp&order=desc'));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.items[0].experienceYears, 10, 'highest experience (old teacher) leads exp-DESC');
  assert.ok(body.items.some(i => i.experienceYears === 10), '10y rows present');
});

test('PA-1d-F6b: subjects filter applied in SQL BEFORE the LIMIT (old english teachers survive)', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  await initDb(db, ENV);
  await seedTeacher250(raw);
  await seedStudent(raw);
  const res = await handleGetTeachers(db, LIST('?subjects=english'));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.items.length, 50, '50 english teachers returned — JS-on-truncated would see 0 (all recent are math)');
  assert.ok(body.items.every(i => Array.isArray(i.subjects) && i.subjects.some(s => s && s.subject === 'english')));
});

test('PA-1d-F6b: price filter applied in SQL BEFORE the LIMIT (priceMax=100 keeps only the old 50)', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  await initDb(db, ENV);
  await seedTeacher250(raw);
  await seedStudent(raw);
  const res = await handleGetTeachers(db, LIST('?priceMax=100'));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.items.length, 50, 'priceMax=100 keeps only the old 50 — JS-on-truncated would see 0');
  assert.ok(body.items.every(i => i.priceMin === 50));
});

test('PA-1d-F6b: gender filter applied in SQL BEFORE the LIMIT (female keeps only the old 50)', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  await initDb(db, ENV);
  await seedTeacher250(raw);
  await seedStudent(raw);
  const res = await handleGetTeachers(db, LIST('?gender=female'));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.items.length, 50, 'gender=female keeps only the old 50 — JS-on-truncated would see 0');
});

test('PA-1d-F6b: personalities filter applied in SQL BEFORE the LIMIT (patience keeps only the old 50)', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  await initDb(db, ENV);
  await seedTeacher250(raw);
  await seedStudent(raw);
  const res = await handleGetTeachers(db, LIST('?personalities=patience'));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.items.length, 50, 'personalities=patience keeps only the old 50 — JS-on-truncated would see 0');
});

test('PA-1d-F6b: sort=match ranks within the capped set (documented boundary)', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  await initDb(db, ENV);
  await seedTeacher250(raw);
  await seedStudentWithDemand(raw, 'math'); // open demand matches the RECENT teachers
  const res = await handleGetTeachers(db, LIST('?sort=match&order=desc'));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.items.length, LIMITS.PUBLIC_LIST_MAX, 'match ranks the capped set, not the whole table');
  // capped set = the 200 newest (math) teachers — they all get a non-null match score
  assert.ok(body.items[0].matchScore != null, 'math teachers get a match score');
  const scores = body.items.map(i => i.matchScore ?? -1);
  for (let i = 1; i < scores.length; i++) {
    assert.ok(scores[i] <= scores[i - 1], `match-DESC non-increasing at ${i}`);
  }
});
