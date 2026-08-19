/**
 * 学生需求侧扩充服务端校验回归（R2-b：需求类型 / 偏好性格 / 偏好性别 / 学生性别改造）
 *
 * handleCreateDemand（demand/api.js）sanitizeDemand：
 *   - target_type 白名单 ['academic','nonacademic']，非法静默回退 'academic'（不拒绝整个需求）；
 *   - target_subjects 按类型分流白名单：academic → SUBJECTS；nonacademic → NONACADEMIC_PROJECTS；
 *   - type==='nonacademic' 时 current_scores 强制置 []（非学科无成绩概念）；
 *   - preferred_personality_tags 数组、≤PERSONALITY_TAGS_MAX、白名单、去重（照抄 teacher/api.js 2a 口径，
 *     非法静默回退空数组，超限截断而非拒绝）；
 *   - preferred_teacher_gender 白名单 ['','male','female']，非法回退 ''（不限）；
 *   - student_gender 白名单 ['','male','female','nonbinary']，非法回退 ''；'' = 不愿透露（创建需求合法）。
 *
 * D1 形状同 teacher-profile-guard.test.js：db.prepare(sql).bind(...).all()/.first()/.run() + db.batch。
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import { handleCreateDemand } from '../src/server/domains/demand/api.js';
import { tokenDigest } from '../src/server/core/crypto.js';
import { bindTextAuditEnv } from '../src/server/core/text-audit.js';

const ENV = { ADMIN_USERNAMES: ['admin_sufe'], ADMIN_DEFAULT_PASSWORD: 'test-pw-123' };

// V-4-1d QA 回归：文本审核咽喉绑定 + fetch mock（镜像生产配置；QA 最小 body 带真实 additional_info，
// 无配置 auditSemantic fail-closed 回 TEXT_AUDIT_UNAVAILABLE，会掩盖被测的 500 崩溃路径）
const origFetch = globalThis.fetch;
beforeEach(() => {
  bindTextAuditEnv({ TEXT_AUDIT_API_KEY: 'test-key' });
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"flagged": false}' } }] }) });
});
afterEach(() => { bindTextAuditEnv(null); globalThis.fetch = origFetch; });

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
  address: '杨浦区·四平路街道', budget_min: 0, budget_max: 0, // 需求五：线下单地址须合法「区·镇/街道」（'杨浦区' 单区名已不合法）
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

// v0.31.7 R1/R2：教学目标白名单（≤2、TEACHING_GOALS 池、去重）；技能现状仅非学科保留、project 白名单、note 截断
test('teaching_goal：≤2、白名单去重、超限截断；skill_notes 仅非学科保留 + project 白名单 + note 截断', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { token, stu } = await seedStudent(db, raw);
  // 教学目标：白名单外剔除、去重、超 2 截断
  let r = await handleCreateDemand(db, { demand: {
    ...baseDemand,
    teaching_goal: ['score', 'hacker', 'interest', 'score', 'habit'], // hacker 剔除 + score 去重 + 超 2 截断
  } }, reqOf(token));
  assert.equal(r.status, 200, '教学目标超限静默截断不拒绝');
  let row = raw.prepare('SELECT teaching_goal FROM student_demands WHERE user_id=?').get(stu);
  assert.deepEqual(JSON.parse(row.teaching_goal), ['score', 'interest'], '教学目标白名单去重 + ≤2 截断');
  // 非数组 → 归空数组（不落脏）
  r = await handleCreateDemand(db, { demand: { ...baseDemand, teaching_goal: 'attack' } }, reqOf(token));
  assert.equal(r.status, 200);
  row = raw.prepare('SELECT teaching_goal FROM student_demands WHERE user_id=? ORDER BY id DESC LIMIT 1').get(stu);
  assert.deepEqual(JSON.parse(row.teaching_goal), [], '非数组 teaching_goal 归空');
  // 非学科技能现状：project 白名单、note 截断、学科需求强制清空
  const longNote = 'x'.repeat(500);
  r = await handleCreateDemand(db, { demand: {
    ...baseDemand,
    target_type: 'nonacademic', target_subjects: ['music'],
    teaching_goal: ['interest'], current_scores: [],
    skill_notes: [{ project: 'music', note: longNote }, { project: 'hacker', note: '注入' }, { project: 'code', note: 'Python' }, 'junk'],
  } }, reqOf(token));
  assert.equal(r.status, 200);
  row = raw.prepare('SELECT skill_notes, teaching_goal FROM student_demands WHERE user_id=? ORDER BY id DESC LIMIT 1').get(stu);
  const notes = JSON.parse(row.skill_notes);
  assert.deepEqual(notes.map(n => n.project), ['music', 'code'], 'skill_notes project 白名单 + 非法项剔除');
  assert.equal(notes.find(n => n.project === 'music').note.length, 300, 'note 截断到 SKILL_NOTE_MAX=300');
  assert.deepEqual(JSON.parse(row.teaching_goal), ['interest'], '非学科教学目标照常保留');
  // 学科需求：skill_notes 强制清空（同 current_scores 口径）
  r = await handleCreateDemand(db, { demand: { ...baseDemand, skill_notes: [{ project: 'music', note: '不该存' }] } }, reqOf(token));
  assert.equal(r.status, 200);
  row = raw.prepare('SELECT skill_notes FROM student_demands WHERE user_id=? ORDER BY id DESC LIMIT 1').get(stu);
  assert.equal(row.skill_notes, '[]', '学科需求 skill_notes 强制清空');
});

// v1.3.0 修复：student_grade 白名单（此前无校验——生产脏数据 'grade7' 泄漏到卡片英文原文）
test('student_grade：非法值静默回退空串；合法值正常入库', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { token, stu } = await seedStudent(db, raw);
  // 非法年级（脏数据 'grade7' 同款）→ 静默回退空（不拒绝整表，与 target_type 非法回退同口径）
  const r = await handleCreateDemand(db, { demand: { ...baseDemand, student_grade: 'grade7' } }, reqOf(token));
  assert.equal(r.status, 200, '非法年级不拒绝整表，实际 ' + r.status);
  let row = raw.prepare('SELECT student_grade FROM student_demands WHERE user_id=? ORDER BY id DESC LIMIT 1').get(stu);
  assert.equal(row.student_grade, '', '非法年级回退空串');
  // 合法年级正常入库
  const r2 = await handleCreateDemand(db, { demand: { ...baseDemand, student_grade: 'junior2' } }, reqOf(token));
  assert.equal(r2.status, 200);
  row = raw.prepare('SELECT student_grade FROM student_demands WHERE user_id=? ORDER BY id DESC LIMIT 1').get(stu);
  assert.equal(row.student_grade, 'junior2', '合法年级正常入库');
});

// V-4-1d QA 抓到的生产 500：缺 current_scores 字段 → sanitizeDemand 未归一 → dbCreateDemand
// JSON.stringify(undefined) 绑 SQL 参数 6 抛错（复现 _tmp_repro_demand.mjs 参数 6 绑定失败）。
// 修复：current_scores 缺失归一 []、submitter_type 缺失归一 'parent'
//（与 teaching_goal/skill_notes/personality_tags 同口径；schema submitter_type NOT NULL 无默认值）。
// 用 QA 全链路原样最小 body 实证：缺 current_scores + submitter_type + student_grade 等可选字段不得 500。
test('QA 最小 body（缺 current_scores/submitter_type 等）→ 归一落库不 500（生产 500 回归）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { token, stu } = await seedStudent(db, raw);
  // 精确复刻 QA 全链路 body：只有最小字段集，无 current_scores / submitter_type / student_grade / 联系方式
  const minimal = {
    province: 'shanghai', grade: 'senior1', target_subjects: ['math'],
    expected_time: JSON.stringify([{ type: 'week', dow: 1, start: '18:00', end: '20:00' }]),
    teaching_method: 'online', additional_info: 'QA 全链路测试', budget_min: 100, budget_max: 200,
    title: 'QA 测试需求', description: '',
  };
  const r = await handleCreateDemand(db, { demand: minimal }, reqOf(token));
  assert.equal(r.status, 200, '缺 current_scores/submitter_type 不得 500，实际 ' + r.status);
  const row = raw.prepare('SELECT current_scores, submitter_type FROM student_demands WHERE user_id=? ORDER BY id DESC LIMIT 1').get(stu);
  assert.equal(row.current_scores, '[]', 'current_scores 缺失归一空数组落库');
  assert.equal(row.submitter_type, 'parent', 'submitter_type 缺失归一 parent 落库（NOT NULL 无默认）');
});
