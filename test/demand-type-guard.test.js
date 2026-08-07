/**
 * 学生需求侧扩充服务端校验回归（R2-b：需求类型 / 偏好性格 / 偏好性别 / 学生性别改造）
 *
 * handleCreateDemand（server/routes-demands.js）sanitizeDemand：
 *   - target_type 白名单 ['academic','nonacademic']，非法静默回退 'academic'（不拒绝整个需求）；
 *   - target_subjects 按类型分流白名单：academic → SUBJECTS；nonacademic → NONACADEMIC_PROJECTS；
 *   - type==='nonacademic' 时 current_scores 强制置 []（非学科无成绩概念）；
 *   - preferred_personality_tags 数组、≤PERSONALITY_TAGS_MAX、白名单、去重（照抄 routes-teacher 2a 口径，
 *     非法静默回退空数组，超限截断而非拒绝）；
 *   - preferred_teacher_gender 白名单 ['','male','female']，非法回退 ''（不限）；
 *   - student_gender 白名单 ['','male','female','nonbinary']，非法回退 ''；'' = 不愿透露（创建需求合法）。
 *
 * D1 形状同 teacher-profile-guard.test.js：db.prepare(sql).bind(...).all()/.first()/.run() + db.batch。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../server/db.js';
import { handleCreateDemand } from '../server/routes-demands.js';
import { tokenDigest } from '../server/crypto.js';

const ENV = { ADMIN_USERNAMES: ['admin_sufe'], ADMIN_DEFAULT_PASSWORD: 'test-pw-123' };

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

async function seedStudent(db, raw) {
  await initDb(db, ENV);
  raw.exec(`INSERT INTO users (username,password_hash,salt,role) VALUES ('s1','h','s','student')`);
  const stu = raw.prepare("SELECT id FROM users WHERE username='s1'").get().id;
  const token = 'stu-token';
  raw.prepare('INSERT INTO auth_sessions (token_hash,user_id,label,expires_at) VALUES (?,?,?,?)')
    .run(await tokenDigest(token), stu, 'x', '2099-01-01 00:00:00');
  return { token, stu };
}
const reqOf = token => ({ headers: new Headers({ 'X-Auth-Token': token }) });
const baseDemand = { province: 'shanghai', student_grade: 'senior1', student_gender: 'male',
  target_subjects: ['math'], current_scores: [], teaching_method: 'offline',
  address: '杨浦区', budget_min: 0, budget_max: 0,
  submitter_type: 'parent', parent_contact: '13800138000', student_contact: '13900139000', additional_info: '' };

test('target_type：非法值静默回退 academic；nonacademic 按项目白名单并强制清成绩', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { token, stu } = await seedStudent(db, raw);
  // 非法 target_type → 回退 academic（不拒绝），科目按 SUBJECTS 白名单
  let r = await handleCreateDemand(db, { demand: { ...baseDemand, target_type: 'hacker' } }, reqOf(token));
  assert.equal(r.status, 200, '非法 target_type 不拒绝，静默回退');
  let row = raw.prepare('SELECT target_type, target_subjects, current_scores FROM student_demands WHERE user_id=?').get(stu);
  assert.equal(row.target_type, 'academic', '非法 target_type 回退 academic');
  assert.deepEqual(JSON.parse(row.target_subjects), ['math']);
  // nonacademic：项目白名单（music/chess 合法，未知 id 剔除）+ current_scores 强制置空
  r = await handleCreateDemand(db, { demand: {
    ...baseDemand,
    target_type: 'nonacademic',
    target_subjects: ['music', 'hacker', 'chess'],
    current_scores: [{ subject: 'math', mode: 'score', scale: 150, score: '90' }],
  } }, reqOf(token));
  assert.equal(r.status, 200);
  row = raw.prepare('SELECT target_type, target_subjects, current_scores FROM student_demands WHERE user_id=? ORDER BY id DESC LIMIT 1').get(stu);
  assert.equal(row.target_type, 'nonacademic');
  assert.deepEqual(JSON.parse(row.target_subjects), ['music', 'chess'], '非学科项目白名单过滤');
  assert.equal(row.current_scores, '[]', 'nonacademic 强制清成绩');
});

test('target_subjects 去重 + 按池封顶（网安 M1）；非数组归空被拒（网安 L1）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { token, stu } = await seedStudent(db, raw);
  // 重复 id 铺量 → 去重后只留唯一值（防存储/响应放大）
  let r = await handleCreateDemand(db, { demand: { ...baseDemand, target_subjects: Array(500).fill('math') } }, reqOf(token));
  assert.equal(r.status, 200);
  let row = raw.prepare('SELECT target_subjects FROM student_demands WHERE user_id=?').get(stu);
  assert.deepEqual(JSON.parse(row.target_subjects), ['math'], '重复 id 去重');
  // 超池数量 → 按池大小封顶（academic 池 9 个）
  r = await handleCreateDemand(db, { demand: { ...baseDemand, target_subjects: ['math','physics','chemistry','biology','history','geography','politics','chinese','english','math'] } }, reqOf(token));
  assert.equal(r.status, 200);
  row = raw.prepare('SELECT target_subjects FROM student_demands WHERE user_id=? ORDER BY id DESC LIMIT 1').get(stu);
  assert.equal(JSON.parse(row.target_subjects).length, 9, '去重后按池封顶 9');
  // 非数组（字符串）→ 归空数组 → 路由无有效科目拒绝（与教师侧 INVALID_PARAMS 口径一致）
  r = await handleCreateDemand(db, { demand: { ...baseDemand, target_subjects: 'attack' } }, reqOf(token));
  assert.equal(r.status, 400, '非数组 target_subjects 拒绝（不静默落库脏字符串）');
});

test('preferred_personality_tags：≤3、白名单去重、超限截断、非数组回退空', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { token, stu } = await seedStudent(db, raw);
  // 白名单外 id 剔除 + 去重
  let r = await handleCreateDemand(db, { demand: { ...baseDemand, preferred_personality_tags: ['patience', 'hacker', 'patience', 'strict'] } }, reqOf(token));
  assert.equal(r.status, 200);
  let row = raw.prepare('SELECT preferred_personality_tags FROM student_demands WHERE user_id=?').get(stu);
  assert.deepEqual(JSON.parse(row.preferred_personality_tags), ['patience', 'strict'], '白名单过滤 + 去重');
  // 超限 4 个合法 → 静默截断到 3（不拒绝）
  r = await handleCreateDemand(db, { demand: { ...baseDemand, preferred_personality_tags: ['patience', 'strict', 'humorous', 'gentle'] } }, reqOf(token));
  assert.equal(r.status, 200, '超限不拒绝，截断到 PERSONALITY_TAGS_MAX');
  row = raw.prepare('SELECT preferred_personality_tags FROM student_demands WHERE user_id=? ORDER BY id DESC LIMIT 1').get(stu);
  assert.equal(JSON.parse(row.preferred_personality_tags).length, 3, '超限截断到 3');
  // 非数组 → 静默回退空数组
  r = await handleCreateDemand(db, { demand: { ...baseDemand, preferred_personality_tags: 'patience' } }, reqOf(token));
  assert.equal(r.status, 200);
  row = raw.prepare('SELECT preferred_personality_tags FROM student_demands WHERE user_id=? ORDER BY id DESC LIMIT 1').get(stu);
  assert.deepEqual(JSON.parse(row.preferred_personality_tags), [], '非数组回退空数组');
});

test('preferred_teacher_gender：白名单入库、非法回退空串', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { token, stu } = await seedStudent(db, raw);
  let r = await handleCreateDemand(db, { demand: { ...baseDemand, preferred_teacher_gender: 'female' } }, reqOf(token));
  assert.equal(r.status, 200);
  let row = raw.prepare('SELECT preferred_teacher_gender FROM student_demands WHERE user_id=?').get(stu);
  assert.equal(row.preferred_teacher_gender, 'female');
  r = await handleCreateDemand(db, { demand: { ...baseDemand, preferred_teacher_gender: 'hacker' } }, reqOf(token));
  assert.equal(r.status, 200);
  row = raw.prepare('SELECT preferred_teacher_gender FROM student_demands WHERE user_id=? ORDER BY id DESC LIMIT 1').get(stu);
  assert.equal(row.preferred_teacher_gender, '', '非法偏好性别回退空串');
});

test('student_gender 空串合法（不愿透露默认）：创建成功；非法值回退空串', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { token, stu } = await seedStudent(db, raw);
  let r = await handleCreateDemand(db, { demand: { ...baseDemand, student_gender: '' } }, reqOf(token));
  assert.equal(r.status, 200, '空串 = 不愿透露，创建成功');
  let row = raw.prepare('SELECT student_gender FROM student_demands WHERE user_id=?').get(stu);
  assert.equal(row.student_gender, '');
  r = await handleCreateDemand(db, { demand: { ...baseDemand, student_gender: 'attack' } }, reqOf(token));
  assert.equal(r.status, 200, '非法性别不拒绝');
  row = raw.prepare('SELECT student_gender FROM student_demands WHERE user_id=? ORDER BY id DESC LIMIT 1').get(stu);
  assert.equal(row.student_gender, '', '非法性别回退空串');
});
