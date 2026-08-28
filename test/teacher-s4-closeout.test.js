/**
 * S4 close-out tests:
 * - public teacher detail NEVER returns wechat/email/real_name/credential_image ().
 * Mutation guard: if the private-field stripping is removed from handleGetTeacherPublic,
 * the response gains those keys -> this test goes red.
 * - teacher list items NEVER carry those private fields either (list contract).
 * - profile save persists teacher_name + experience_years (/). Mutation guard:
 * if dbUpsertTeacherProfile stops persisting them, the row read-back loses the values -> red.
 *
 * Uses the same D1 shim pattern as test/teacher-profile-guard.test.js.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { TEST_SECRETS } from './_test-secrets.js';
import { initDb } from '../src/server/core/db.js';
import { tokenDigest } from '../src/server/core/crypto.js';
import { dbUpsertTeacherProfile, dbGetTeacherProfile } from '../src/server/domains/teacher/repo.js';
import { handleGetTeacherPublic } from '../src/server/domains/teacher/api.js';
import { handleGetTeachers } from '../src/server/domains/teacher/list.js';

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
const reqOf = token => ({ headers: new Headers({ 'X-Auth-Token': token }) });

async function seed(db, raw) {
  await initDb(db, ENV);
  raw.exec(`INSERT INTO users (username,password_hash,salt,role) VALUES ('t1','h','s','teacher')`);
  raw.exec(`INSERT INTO users (username,password_hash,salt,role) VALUES ('s1','h','s','student')`);
  const tea = raw.prepare("SELECT id FROM users WHERE username='t1'").get().id;
  const stu = raw.prepare("SELECT id FROM users WHERE username='s1'").get().id;
  const tToken = 'tea-token';
  const sToken = 'stu-token';
  raw.prepare('INSERT INTO auth_sessions (token_hash,user_id,label,expires_at) VALUES (?,?,?,?)')
    .run(await tokenDigest(tToken), tea, 'x', '2099-01-01 00:00:00');
  raw.prepare('INSERT INTO auth_sessions (token_hash,user_id,label,expires_at) VALUES (?,?,?,?)')
    .run(await tokenDigest(sToken), stu, 'x', '2099-01-01 00:00:00');
  return { tea, stu, tToken, sToken };
}

const PROFILE = {
  province: 'shanghai', grade: 'freshman', gender: 'male', subjects: ['math'], gaokao_scores: [],
  price_min: 150, price_max: 180, wechat: 'wx_teacher', email: 't@test.com', real_name: '实名教师',
  credential_image: 'data:image/png;base64,AA==', intro: '简介', address: '嘉定区·嘉定镇街道',
  teaching_method: 'offline', time_slots: JSON.stringify([{ type: 'week', dow: 1, start: '18:00', end: '20:00' }]),
  personality_tags: ['patience'], teacher_name: '王老师', experience_years: 5,
};

test('I-30 public detail: wechat/email/real_name/credential_image never returned', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { tea, stu, sToken } = await seed(db, raw);
  await dbUpsertTeacherProfile(db, tea, PROFILE);
  const res = await handleGetTeacherPublic(db, tea, reqOf(sToken));
  assert.equal(res.status, 200);
  const body = await res.json();
  const p = body.profile;
  assert.ok(p, 'profile present');
  for (const k of ['wechat', 'email', 'real_name', 'credential_image']) {
    assert.ok(!(k in p), `${k} must NOT be present in the public detail`);
  }
  // public fields still there
  assert.equal(p.teacher_name, '王老师');
  assert.equal(p.name, '王老师');
  assert.equal(p.experience_years, 5);
  assert.ok(Array.isArray(p.subjects) && p.subjects.some(s => s && s.subject === 'math'));
  // 变异守护：subjects 必须为 对象数组 {subject,score,full,awards[]}——
  // mapper 退回字符串 id 数组时 find(s=>s.subject) 取不到条目、断言红。
  const mathSubject = p.subjects.find(s => s && s.subject === 'math');
  assert.ok(mathSubject, 'subjects 含 math 对象条目');
  assert.equal(mathSubject.score, null, '无 gaokao_scores → score 为 null');
  assert.equal(mathSubject.full, 150, 'math gaokao 满分 150（senior 口径）');
  assert.deepEqual(mathSubject.awards, [], 'awards 为空占位数组');
});

test('I-29 list: items never carry wechat/email/real_name/credential_image; match fields null without a demand', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { tea, stu, sToken } = await seed(db, raw);
  await dbUpsertTeacherProfile(db, tea, PROFILE);
  const res = await handleGetTeachers(db, new Request('http://x/api/teachers', { method: 'GET', headers: { 'X-Auth-Token': sToken } }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.teachers) && Array.isArray(body.items), 'dual-key array');
  assert.equal(body.total, 1);
  const row = body.teachers[0];
  for (const k of ['wechat', 'email', 'real_name', 'credential_image']) {
    assert.ok(!(k in row), `${k} must NOT be present in the list item`);
  }
  // no open demand for this student -> matchScore/matchCount null ()
  assert.equal(row.matchScore, null);
  assert.equal(row.matchCount, null);
  assert.equal(row.teacherId, tea);
});

test('I-29 list: anonymous request is rejected with 401 (login-gated, PA-1d-F7)', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  await seed(db, raw);
  // No X-Auth-Token header -> requireUser rejects before any data is read.
  const res = await handleGetTeachers(db, new Request('http://x/api/teachers', { method: 'GET' }));
  assert.equal(res.status, 401, 'anonymous teacher list must be login-gated');
  // Mutation guard: reverting the handler to authUser (optional auth) makes this 200 -> red.
});

test('I-40 profile save persists teacher_name + experience_years', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { tea, tToken } = await seed(db, raw);
  const { handleSaveProfile } = await import('../src/server/domains/teacher/api.js');
  const res = await handleSaveProfile(db, { profile: PROFILE }, reqOf(tToken));
  assert.equal(res.status, 200);
  const saved = await dbGetTeacherProfile(db, tea);
  assert.equal(saved.teacher_name, '王老师');
  assert.equal(saved.experience_years, 5);
  assert.equal(saved.name, '王老师');
  // mutation guard: if dbUpsertTeacherProfile drops the two columns, these read back as ''/null -> red
});
