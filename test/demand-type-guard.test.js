/**
 * 需求域服务端校验回归（S3 单科目新模型，）
 *
 * handleCreateDemand（demand/api.js）sanitizeDemand + 地址门禁：
 * - subject 单值白名单（SUBJECTS ∪ NONACADEMIC_PROJECTS），非法 → INVALID_PARAMS（400，拒绝不静默）；
 * - grade 单值白名单（STUDENT_GRADES），非法 → INVALID_PARAMS（400）；
 * - province 必填且合法（PROVINCE_REQUIRED）；非线下许可省强制 online；
 * - teachingMethod online 清空地址；offline/both 必须合法「区·镇/街道」上海地址（ADDRESS_REQUIRED）；
 * - preferredTags 数组、≤PERSONALITY_TAGS_MAX、白名单、去重（非法静默回退空数组，超限截断而非拒绝）；
 * - preferredGender 白名单 ['','male','female']，非法回退 ''（不限）；
 * - currentScore 单值文本：数字钳 [0, subjectMaxFor]（region-data 单源），等第字母保留，缺失空串；
 * - targetType 由 subject 派生（academic/nonacademic），不落库。
 *
 * D1 形状同 teacher-profile-guard.test.js：db.prepare(sql).bind(...).all()/.first()/.run() + db.batch。
 */
import { test, beforeEach, afterEach } from 'node:test';
import { TEST_SECRETS } from './_test-secrets.js';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import { handleCreateDemand, handleGetMyDemands, handleGetDemands } from '../src/server/domains/demand/api.js';
import { dbGetDemandById } from '../src/server/domains/demand/repo.js';
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
// S3 单科目直接 body（无 v2 {demand} 包装）；线下合法上海地址
const baseDemand = { province: 'shanghai', grade: 'senior1', subject: 'math',
  teachingMethod: 'offline', addressArea: '杨浦区·四平路街道', budgetMin: 0, budgetMax: 0, additionalInfo: '' };

test('subject 白名单：非法科目 400 不落库；academic/nonacademic 派生 targetType', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { token, stu } = await seedStudent(db, raw);
  // 非法科目 → 拒绝（单科目无 v2 数组静默回退）
  let r = await handleCreateDemand(db, { ...baseDemand, subject: 'hacker' }, reqOf(token));
  assert.equal(r.status, 400, '非法科目拒绝，实际 ' + r.status);
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM student_demands WHERE user_id=?').get(stu).c, 0, '未落库');
  // 学科科目（math）入库，targetType 派生 academic
  r = await handleCreateDemand(db, baseDemand, reqOf(token));
  assert.equal(r.status, 200);
  let row = raw.prepare('SELECT id, subject, status FROM student_demands WHERE user_id=?').get(stu);
  assert.equal(row.subject, 'math');
  assert.equal(row.status, 'open');
  assert.equal((await dbGetDemandById(db, row.id)).targetType, 'academic', 'math → academic');
  // 非学科项目（music）入库，targetType 派生 nonacademic
  r = await handleCreateDemand(db, { ...baseDemand, subject: 'music' }, reqOf(token));
  assert.equal(r.status, 200);
  row = raw.prepare('SELECT id, subject FROM student_demands WHERE user_id=? ORDER BY id DESC LIMIT 1').get(stu);
  assert.equal(row.subject, 'music', '非学科项目白名单入库');
  assert.equal((await dbGetDemandById(db, row.id)).targetType, 'nonacademic', 'music → nonacademic');
});

test('grade：非法值 400（拒绝不静默回退空串）；合法值正常入库', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { token, stu } = await seedStudent(db, raw);
  const r = await handleCreateDemand(db, { ...baseDemand, grade: 'grade7' }, reqOf(token));
  assert.equal(r.status, 400, '非法年级拒绝整表（S3 白名单拒绝语义），实际 ' + r.status);
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM student_demands WHERE user_id=?').get(stu).c, 0, '未落库');
  const r2 = await handleCreateDemand(db, { ...baseDemand, grade: 'junior2' }, reqOf(token));
  assert.equal(r2.status, 200);
  const row = raw.prepare('SELECT grade FROM student_demands WHERE user_id=?').get(stu);
  assert.equal(row.grade, 'junior2', '合法年级正常入库');
});

test('province：非法/缺失 400；非线下许可省强制 online 且清空地址', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { token, stu } = await seedStudent(db, raw);
  let r = await handleCreateDemand(db, { ...baseDemand, province: 'atlantis' }, reqOf(token));
  assert.equal(r.status, 400, '非法省份拒绝');
  r = await handleCreateDemand(db, { ...baseDemand, province: '' }, reqOf(token));
  assert.equal(r.status, 400, '缺失省份拒绝');
  // 非线下许可省（beijing）：offline 请求被强制 online，地址清空，仍 200
  r = await handleCreateDemand(db, { ...baseDemand, province: 'beijing', teachingMethod: 'offline', addressArea: '黄浦区·四平路街道' }, reqOf(token));
  assert.equal(r.status, 200, '非线下许可省强制 online 不拒绝');
  const row = raw.prepare('SELECT teaching_method, address_area FROM student_demands WHERE user_id=? ORDER BY id DESC LIMIT 1').get(stu);
  assert.equal(row.teaching_method, 'online', '强制 online');
  assert.equal(row.address_area, '', '地址被清空');
});

test('teachingMethod 地址门禁：online 清空地址；offline/both 须合法上海地址', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { token, stu } = await seedStudent(db, raw);
  // online：即使带地址也被清空
  let r = await handleCreateDemand(db, { ...baseDemand, teachingMethod: 'online', addressArea: '黄浦区·南京东路街道' }, reqOf(token));
  assert.equal(r.status, 200);
  let row = raw.prepare('SELECT teaching_method, address_area FROM student_demands WHERE user_id=? ORDER BY id DESC LIMIT 1').get(stu);
  assert.equal(row.address_area, '', 'online 清空地址');
  // offline：非法地址（单区名不合法）→ ADDRESS_REQUIRED 拒绝
  r = await handleCreateDemand(db, { ...baseDemand, teachingMethod: 'offline', addressArea: '杨浦区' }, reqOf(token));
  assert.equal(r.status, 400, 'offline 非法地址拒绝');
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM student_demands WHERE user_id=?').get(stu).c, 1, '非法地址不落库');
  // offline：合法地址入库
  r = await handleCreateDemand(db, { ...baseDemand, teachingMethod: 'offline', addressArea: '杨浦区·四平路街道' }, reqOf(token));
  assert.equal(r.status, 200);
  row = raw.prepare('SELECT address_area FROM student_demands WHERE user_id=? ORDER BY id DESC LIMIT 1').get(stu);
  assert.equal(row.address_area, '杨浦区·四平路街道', '合法地址入库');
});

test('preferredTags：≤3、白名单去重、超限截断、非数组回退空', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { token, stu } = await seedStudent(db, raw);
  // 白名单外 id 剔除 + 去重
  let r = await handleCreateDemand(db, { ...baseDemand, preferredTags: ['patience', 'hacker', 'patience', 'strict'] }, reqOf(token));
  assert.equal(r.status, 200);
  let row = raw.prepare('SELECT preferred_tags FROM student_demands WHERE user_id=?').get(stu);
  assert.deepEqual(JSON.parse(row.preferred_tags), ['patience', 'strict'], '白名单过滤 + 去重');
  // 超限 4 个合法 → 静默截断到 3（不拒绝整表）
  r = await handleCreateDemand(db, { ...baseDemand, preferredTags: ['patience', 'strict', 'humorous', 'gentle'] }, reqOf(token));
  assert.equal(r.status, 200, '超限不拒绝，截断到 PERSONALITY_TAGS_MAX');
  row = raw.prepare('SELECT preferred_tags FROM student_demands WHERE user_id=? ORDER BY id DESC LIMIT 1').get(stu);
  assert.equal(JSON.parse(row.preferred_tags).length, 3, '超限截断到 3');
  // 非数组 → 静默回退空数组
  r = await handleCreateDemand(db, { ...baseDemand, preferredTags: 'patience' }, reqOf(token));
  assert.equal(r.status, 200);
  row = raw.prepare('SELECT preferred_tags FROM student_demands WHERE user_id=? ORDER BY id DESC LIMIT 1').get(stu);
  assert.deepEqual(JSON.parse(row.preferred_tags), [], '非数组回退空数组');
});

test('preferredGender：白名单入库、非法回退空串', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { token, stu } = await seedStudent(db, raw);
  let r = await handleCreateDemand(db, { ...baseDemand, preferredGender: 'female' }, reqOf(token));
  assert.equal(r.status, 200);
  let row = raw.prepare('SELECT preferred_gender FROM student_demands WHERE user_id=?').get(stu);
  assert.equal(row.preferred_gender, 'female');
  r = await handleCreateDemand(db, { ...baseDemand, preferredGender: 'hacker' }, reqOf(token));
  assert.equal(r.status, 200);
  row = raw.prepare('SELECT preferred_gender FROM student_demands WHERE user_id=? ORDER BY id DESC LIMIT 1').get(stu);
  assert.equal(row.preferred_gender, '', '非法偏好性别回退空串');
});

test('currentScore：数字钳制 [0, subjectMaxFor]、等第字母保留、缺失空串', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { token, stu } = await seedStudent(db, raw);
  // 缺失 → ''
  let r = await handleCreateDemand(db, baseDemand, reqOf(token));
  assert.equal(r.status, 200);
  let row = raw.prepare('SELECT current_score FROM student_demands WHERE user_id=?').get(stu);
  assert.equal(row.current_score, '', '缺失 currentScore → 空串');
  // 数字超上限 → 钳到 subjectMaxFor（上海 senior1 数学 = 150）
  r = await handleCreateDemand(db, { ...baseDemand, currentScore: '200' }, reqOf(token));
  assert.equal(r.status, 200);
  row = raw.prepare('SELECT current_score FROM student_demands WHERE user_id=? ORDER BY id DESC LIMIT 1').get(stu);
  assert.equal(row.current_score, '150', '数字钳制到满分');
  // 等第字母保留原样
  r = await handleCreateDemand(db, { ...baseDemand, currentScore: 'A' }, reqOf(token));
  assert.equal(r.status, 200);
  row = raw.prepare('SELECT current_score FROM student_demands WHERE user_id=? ORDER BY id DESC LIMIT 1').get(stu);
  assert.equal(row.current_score, 'A', '等第字母原样保留');
});

test('QA 最小 body（缺 currentScore/preferredTags/preferredGender 等）→ 归一落库不 500', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { token, stu } = await seedStudent(db, raw);
  // 最小字段集：province + subject + grade + budget（单科目无 currentScore/preferredTags 等可选字段）
  const minimal = {
    province: 'shanghai', grade: 'senior1', subject: 'math',
    expectedTime: JSON.stringify([{ type: 'week', dow: 1, start: '18:00', end: '20:00' }]),
    teachingMethod: 'online', additionalInfo: 'QA 全链路测试', budgetMin: 100, budgetMax: 200,
  };
  const r = await handleCreateDemand(db, minimal, reqOf(token));
  assert.equal(r.status, 200, '缺可选字段不得 500，实际 ' + r.status);
  const row = raw.prepare('SELECT current_score, preferred_tags, preferred_gender, status FROM student_demands WHERE user_id=? ORDER BY id DESC LIMIT 1').get(stu);
  assert.equal(row.current_score, '', 'currentScore 缺失归一空串');
  assert.equal(row.preferred_tags, '[]', 'preferredTags 缺失归一空数组');
  assert.equal(row.preferred_gender, '', 'preferredGender 缺失归一空串');
  assert.equal(row.status, 'open', '默认 open');
});

// ---------------------------------------------------------------------------
// 列表信封对齐契约 {items}（/）。前端 useDemands/demands-service
// 读 data.items（+ total），后端曾返回 {demands} 致生产恒空列表；smoke mock 按前端预期
// {items} 造数掩盖了形状失配（教训）。变异守护：信封改回 {demands} → 本测试红。
// ---------------------------------------------------------------------------
test('I-33 envelope: handleGetMyDemands returns { items } (no legacy { demands } key)', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { token } = await seedStudent(db, raw);
  assert.equal((await handleCreateDemand(db, baseDemand, reqOf(token))).status, 200);
  assert.equal((await handleCreateDemand(db, { ...baseDemand, subject: 'chinese' }, reqOf(token))).status, 200);

  const r = await handleGetMyDemands(db, reqOf(token));
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok('items' in body, 'I-33 envelope uses items (frontend useDemands reads data.items)');
  assert.ok(!('demands' in body), 'no legacy { demands } envelope key');
  assert.ok(Array.isArray(body.items), 'items is an array');
  assert.equal(body.items.length, 2, 'both own demands listed (incl. open)');
  assert.ok(body.items.every(x => x.subject && x.status), 'row shape mapped (subject/status present)');
});

test('I-34 envelope: handleGetDemands returns { items, total } with matchScore/matchCount placeholders', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { token } = await seedStudent(db, raw);
  assert.equal((await handleCreateDemand(db, baseDemand, reqOf(token))).status, 200);
  assert.equal((await handleCreateDemand(db, { ...baseDemand, subject: 'chinese' }, reqOf(token))).status, 200);

  const r = await handleGetDemands(db, new URL('http://localhost/api/demands'), reqOf(token));
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok('items' in body, 'I-34 envelope uses items (frontend demands-service reads json.items)');
  assert.ok(!('demands' in body), 'no legacy { demands } envelope key');
  assert.ok('total' in body, 'I-34 exposes total (frontend demands-service reads json.total)');
  assert.ok(Array.isArray(body.items), 'items is an array');
  assert.equal(body.total, body.items.length, 'total equals items length');
  assert.equal(body.items.length, 2, 'two open demands in the plaza');
  assert.ok(body.items.every(x => x.matchScore === null && x.matchCount === null),
    'S3-15 matchScore/matchCount placeholders null until S4 wires in');
});
