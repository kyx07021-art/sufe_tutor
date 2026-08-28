/**
 * server contract: teacher profile save accepts camelCase + snake_case dual-receive,
 * partial save = keep old value (merge), subjects object-array write/read consistent, philosophy column.
 *
 * 历史缺陷：handleSaveProfile 只读 snake_case（province/teacher_name/price_min...）且要求必填省份，
 * camelCase PUT（teacherName/region/priceMin...）会 400 PROVINCE_REQUIRED、空白覆盖省略字段（全量覆盖）、
 * 前端 subject 对象行从不落库。本文件锁定修复后的服务端契约。
 *
 * Uses the same D1 shim pattern as test/teacher-profile-guard.test.js.
 */
import { test } from 'node:test';
import { TEST_SECRETS } from './_test-secrets.js';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import { handleSaveProfile, handleGetProfile } from '../src/server/domains/teacher/api.js';
import { dbGetTeacherProfile } from '../src/server/domains/teacher/repo.js';
import { tokenDigest } from '../src/server/core/crypto.js';

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
  const tea = raw.prepare("SELECT id FROM users WHERE username='t1'").get().id;
  const token = 'tea-token';
  raw.prepare('INSERT INTO auth_sessions (token_hash,user_id,label,expires_at) VALUES (?,?,?,?)')
    .run(await tokenDigest(token), tea, 'x', '2099-01-01 00:00:00');
  return { tea, token };
}
const rowOf = (raw, tea) => raw.prepare('SELECT province,grade,gender,subjects,gaokao_scores,price_min,price_max,wechat,email,intro,address,school,real_name,credential_image,time_slots,teaching_method,personality_tags,nonacademic_projects,nonacademic_prices,graduation_year,teacher_name,experience_years,philosophy FROM teacher_profiles WHERE user_id=?').get(tea);

const CAMEL_PROFILE = {
  region: 'shanghai',
  teacherName: '王老师',
  priceMin: 100,
  priceMax: 150,
  experienceYears: 5,
  gender: 'female',
  graduationYear: 2020,
  timeSlots: [{ type: 'week', dow: 1, start: '18:00', end: '20:00' }],
  personalityTags: ['patience'],
  subjects: [{ subject: 'math', score: '140', full: 999 }, { subject: 'english' }],
  philosophy: '启发式教学，注重逻辑',
  bio: '多年教学经验',
  addressArea: '浦东新区·张江镇',
  teachingMethod: 'online',
};

test('I-40 camelCase PUT: all fields accepted, subjects object-array stored canonical (full derived, not frontend)', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { tea, token } = await seed(db, raw);
  const r = await handleSaveProfile(db, { profile: CAMEL_PROFILE }, reqOf(token));
  assert.equal(r.status, 200);
  const row = rowOf(raw, tea);
  assert.equal(row.province, 'shanghai', 'region -> province');
  assert.equal(row.teacher_name, '王老师', 'teacherName -> teacher_name');
  assert.equal(row.price_min, 100, 'priceMin -> price_min');
  assert.equal(row.price_max, 150, 'priceMax -> price_max');
  assert.equal(row.experience_years, 5, 'experienceYears -> experience_years');
  assert.equal(row.gender, 'female');
  assert.equal(row.graduation_year, 2020, 'graduationYear -> graduation_year');
  assert.equal(row.teaching_method, 'online', 'teachingMethod -> teaching_method');
  assert.equal(row.intro, '多年教学经验', 'bio -> intro');
  assert.equal(row.address, '浦东新区·张江镇', 'addressArea -> address');
  assert.equal(row.philosophy, '启发式教学，注重逻辑', 'philosophy persisted');
  assert.deepEqual(JSON.parse(row.time_slots), [{ type: 'week', dow: 1, start: '18:00', end: '20:00' }], 'timeSlots object array accepted');
  // subjects: object-array rows stored canonical — score normalized to number, full DERIVED by
  // region/grade (senior 150), the frontend `full: 999` ignored. Mutation guard: using it.full or
  // leaving score a string turns this deepEqual red.
  assert.deepEqual(JSON.parse(row.subjects), [
    { subject: 'math', score: 140, full: 150, awards: [] },
    { subject: 'english', score: null, full: 150, awards: [] },
  ], 'subjects stored as canonical object rows (full derived)');
});

test('I-40 GET read-back: philosophy + subjects object rows returned via mapper', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { tea, token } = await seed(db, raw);
  await handleSaveProfile(db, { profile: CAMEL_PROFILE }, reqOf(token));
  const res = await handleGetProfile(db, new URL('http://x/api/teacher/profile'), reqOf(token));
  assert.equal(res.status, 200);
  const body = await res.json();
  const p = body.profile;
  assert.equal(p.philosophy, '启发式教学，注重逻辑', 'GET returns philosophy');
  assert.equal(p.teacher_name, '王老师');
  const math = p.subjects.find(s => s && s.subject === 'math');
  assert.equal(math.score, 140, 'subjects object row score read back');
  assert.equal(math.full, 150, 'full derived read back');
  const eng = p.subjects.find(s => s && s.subject === 'english');
  assert.equal(eng.score, null, 'subject without score -> null');
});

test('I-40 merge semantics: partial save keeps omitted fields (no full overwrite)', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { tea, token } = await seed(db, raw);
  // baseline full save (snake_case, v2-compatible)
  let r = await handleSaveProfile(db, { profile: {
    province: 'shanghai', grade: 'sophomore', gender: 'female', subjects: ['math', 'english'], gaokao_scores: [],
    price_min: 100, price_max: 150, teaching_method: 'online',
    time_slots: JSON.stringify([{ type: 'week', dow: 1, start: '18:00', end: '20:00' }]),
    intro: 'original bio', philosophy: 'original philosophy', teacher_name: '原名',
  } }, reqOf(token));
  assert.equal(r.status, 200);
  // partial update: only teacherName + region (province required by contract)
  r = await handleSaveProfile(db, { profile: { region: 'shanghai', teacherName: '新名' } }, reqOf(token));
  assert.equal(r.status, 200);
  const saved = await dbGetTeacherProfile(db, tea);
  assert.equal(saved.teacher_name, '新名', 'teacherName updated');
  // mutation guard: if the repo UPDATE always wrote every column (ignoring `provided`), these
  // would be blanked to '' / [] / null -> assertions go red.
  assert.equal(saved.intro, 'original bio', 'omitted intro keeps old value');
  assert.equal(saved.philosophy, 'original philosophy', 'omitted philosophy keeps old value');
  assert.equal(saved.price_min, 100, 'omitted price_min keeps old value');
  assert.equal(saved.gender, 'female', 'omitted gender keeps old value');
  assert.equal(saved.subjects.length, 2, 'omitted subjects keep old rows');
});

test('I-40 merge semantics: explicit null/empty clears a field', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { tea, token } = await seed(db, raw);
  await handleSaveProfile(db, { profile: {
    region: 'shanghai', teacherName: '甲', philosophy: 'some philosophy', intro: 'bio',
    priceMin: 100, priceMax: 150, subjects: [{ subject: 'math', score: '140' }],
  } }, reqOf(token));
  // explicit clear: philosophy:'' + priceMin:null + subjects:[] (provided, so written)
  const r = await handleSaveProfile(db, { profile: {
    region: 'shanghai', philosophy: '', priceMin: null, subjects: [],
  } }, reqOf(token));
  assert.equal(r.status, 200);
  const row = rowOf(raw, tea);
  assert.equal(row.philosophy, '', 'explicit empty philosophy clears');
  assert.equal(row.price_min, null, 'explicit null price_min clears');
  assert.equal(row.subjects, '[]', 'explicit empty subjects clears');
  assert.equal(row.teacher_name, '甲', 'omitted teacher_name kept');
});

test('I-40 timeSlots: invalid object array rejected 400, snake_case still accepted', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { tea, token } = await seed(db, raw);
  // invalid array shape -> 400 (no write)
  let r = await handleSaveProfile(db, { profile: { region: 'shanghai', timeSlots: [{ dow: 1, start: 'bad', end: 'worse' }] } }, reqOf(token));
  assert.equal(r.status, 400, 'invalid timeSlots array rejected');
  // snake_case serialized string still accepted (v2 compat)
  r = await handleSaveProfile(db, { profile: {
    region: 'shanghai', grade: 'freshman', gender: 'male', subjects: ['math'], gaokao_scores: [],
    price_min: 100, price_max: 150,
    time_slots: JSON.stringify([{ type: 'week', dow: 1, start: '18:00', end: '20:00' }]),
  } }, reqOf(token));
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(rowOf(raw, tea).time_slots)[0].dow, 1, 'snake_case time_slots still works');
});

test('I-40 stray/unknown keys are ignored (no 500); empty profile body rejected', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { tea, token } = await seed(db, raw);
  // unknown `graduation` (old frontend shape) is ignored, known camelCase keys still applied
  let r = await handleSaveProfile(db, { profile: { region: 'shanghai', teacherName: '甲', graduation: '某某大学' } }, reqOf(token));
  assert.equal(r.status, 200);
  assert.equal(rowOf(raw, tea).teacher_name, '甲', 'known key applied despite stray key');
  // no writable fields -> 400
  r = await handleSaveProfile(db, { profile: { foo: 'bar' } }, reqOf(token));
  assert.equal(r.status, 400, 'body with only unknown keys rejected');
});
