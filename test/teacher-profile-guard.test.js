/**
 * 教师档案扩展字段服务端校验回归（R2-5/R2-1/R2-2/R2-3/R2-4）
 *
 * handleSaveProfile（teacher/api.js）：
 *   - price_min/price_max 各自钳制 [0, BUDGET_MAX]，max<min 以 min 为准，null=未填保留；
 *   - time_slots 与需求 expected_time 共用 sanitizeTimeSlots（server/util.js），空串合法；
 *   - teaching_method 白名单 ['online','offline','both']，非法值回退 '';
 *   - personality_tags 数组、<=PERSONALITY_TAGS_MAX、白名单（APP_CONSTANTS.PERSONALITY_TAGS）；
 *   - nonacademic_projects 白名单去重；nonacademic_prices 每项 project 须在 projects 内、
 *     价格数字且 min<=max、钳制 [0, BUDGET_MAX]。
 *
 * D1 形状：db.prepare(sql).bind(...).all()/.first()/.run() + db.batch（与 signing-guard 同款 shim）。
 */
import { test } from 'node:test';
import { TEST_SECRETS } from './_test-secrets.js';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import { handleSaveProfile } from '../src/server/domains/teacher/api.js';
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

async function seed(db, raw) {
  await initDb(db, ENV);
  raw.exec(`INSERT INTO users (username,password_hash,salt,role) VALUES ('t1','h','s','teacher')`);
  // 注意：initDb 先建种子管理员（admin_sufe 占 id=1），教师 t1 的 id 须实测反查
  const tea = raw.prepare("SELECT id FROM users WHERE username='t1'").get().id;
  const token = 'tea-token';
  raw.prepare('INSERT INTO auth_sessions (token_hash,user_id,label,expires_at) VALUES (?,?,?,?)')
    .run(await tokenDigest(token), tea, 'x', '2099-01-01 00:00:00');
  return { token, tea };
}
const reqOf = token => ({ headers: new Headers({ 'X-Auth-Token': token }) });
const baseProfile = { province: 'shanghai', grade: 'freshman', gender: 'male', subjects: ['math'], gaokao_scores: [] };
const rowOf = (raw, tea) => raw.prepare('SELECT price_min, price_max, time_slots, teaching_method, personality_tags, nonacademic_projects, nonacademic_prices, graduation_year, grade, gender, subjects, gaokao_scores FROM teacher_profiles WHERE user_id=?').get(tea);

test('报价区间钳制：负值/超上限夹到 [0,BUDGET_MAX]，max<min 以 min 为准，null=未填保留', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { token, tea } = await seed(db, raw);
  // 负值→0、超上限→99999
  let r = await handleSaveProfile(db, { profile: { ...baseProfile, price_min: -50, price_max: 9999999 } }, reqOf(token));
  assert.equal(r.status, 200);
  let row = rowOf(raw, tea);
  assert.equal(row.price_min, 0, '负值钳到 0');
  assert.equal(row.price_max, 99999, '超上限钳到 BUDGET_MAX');
  // max<min → max 以 min 为准
  r = await handleSaveProfile(db, { profile: { ...baseProfile, price_min: 100, price_max: 50 } }, reqOf(token));
  assert.equal(r.status, 200);
  row = rowOf(raw, tea);
  assert.equal(row.price_max, 100, 'max<min 时以 min 为准');
  // 双 null → 保留 null（完整性门槛据此拦截；0 是合法报价）
  r = await handleSaveProfile(db, { profile: { ...baseProfile, price_min: null, price_max: null } }, reqOf(token));
  assert.equal(r.status, 200);
  row = rowOf(raw, tea);
  assert.equal(row.price_min, null, 'null 保留（不落 0）');
  r = await handleSaveProfile(db, { profile: { ...baseProfile, price_min: 0, price_max: 0 } }, reqOf(token));
  row = rowOf(raw, tea);
  assert.equal(row.price_min, 0, '0 是合法报价');
});

test('可授课时间段：合法 JSON 入库、空串合法、非法结构 400', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { token, tea } = await seed(db, raw);
  const valid = JSON.stringify([{ type: 'week', dow: 1, start: '18:00', end: '20:00' }]);
  let r = await handleSaveProfile(db, { profile: { ...baseProfile, time_slots: valid } }, reqOf(token));
  assert.equal(r.status, 200);
  assert.equal(rowOf(raw, tea).time_slots, valid);
  r = await handleSaveProfile(db, { profile: { ...baseProfile, time_slots: '' } }, reqOf(token));
  assert.equal(r.status, 200, '空串合法（可授课时间段非必填）');
  assert.equal(rowOf(raw, tea).time_slots, '');
  r = await handleSaveProfile(db, { profile: { ...baseProfile, time_slots: '工作日晚上' } }, reqOf(token));
  assert.equal(r.status, 400, '非法时间段拒绝');
  assert.equal(rowOf(raw, tea).time_slots, '', '非法值不入库');
});

test('授课方式：白名单入库、非法值回退空串', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { token, tea } = await seed(db, raw);
  let r = await handleSaveProfile(db, { profile: { ...baseProfile, teaching_method: 'both' } }, reqOf(token));
  assert.equal(r.status, 200);
  assert.equal(rowOf(raw, tea).teaching_method, 'both');
  r = await handleSaveProfile(db, { profile: { ...baseProfile, teaching_method: 'on-site' } }, reqOf(token));
  assert.equal(r.status, 200, '非法授课方式不报错，回退空串');
  assert.equal(rowOf(raw, tea).teaching_method, '', '非法值回退空串');
});

test('性格关键词：超限 400、白名单过滤、非数组拒绝', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { token, tea } = await seed(db, raw);
  // 超限（4 个）→ 400 PERSONALITY_TAGS_TOO_MANY
  let r = await handleSaveProfile(db, { profile: { ...baseProfile, personality_tags: ['patience', 'strict', 'humorous', 'gentle'] } }, reqOf(token));
  assert.equal(r.status, 400, '超 3 个应拒绝');
  // 3 个合法 → 入库
  r = await handleSaveProfile(db, { profile: { ...baseProfile, personality_tags: ['patience', 'strict', 'humorous'] } }, reqOf(token));
  assert.equal(r.status, 200);
  assert.equal(rowOf(raw, tea).personality_tags, JSON.stringify(['patience', 'strict', 'humorous']));
  // 白名单外 id 被滤除 + 去重
  r = await handleSaveProfile(db, { profile: { ...baseProfile, personality_tags: ['patience', 'hacker', 'patience'] } }, reqOf(token));
  assert.equal(r.status, 200);
  assert.equal(rowOf(raw, tea).personality_tags, JSON.stringify(['patience']), '白名单外滤除且去重');
  // 非数组 → 400
  r = await handleSaveProfile(db, { profile: { ...baseProfile, personality_tags: 'patience' } }, reqOf(token));
  assert.equal(r.status, 400, '非数组应拒绝');
});

test('毕业年份（R2-12）：空/null 合法入库为 null；整数钳制 [1980,2030]；非法回空串落 null', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { token, tea } = await seed(db, raw);
  // 空 / null → null（未填 = 前端按最新政策渲染）
  let r = await handleSaveProfile(db, { profile: { ...baseProfile, graduation_year: null } }, reqOf(token));
  assert.equal(r.status, 200);
  assert.equal(rowOf(raw, tea).graduation_year, null, 'null 合法（按最新政策）');
  r = await handleSaveProfile(db, { profile: { ...baseProfile, graduation_year: '' } }, reqOf(token));
  assert.equal(r.status, 200);
  assert.equal(rowOf(raw, tea).graduation_year, null, '空串合法（按最新政策）');
  // 合法整数 → 原样入库
  r = await handleSaveProfile(db, { profile: { ...baseProfile, graduation_year: 2020 } }, reqOf(token));
  assert.equal(r.status, 200);
  assert.equal(rowOf(raw, tea).graduation_year, 2020, '整数年份入库');
  // 超上限 / 低下限 → 钳制到 [1980,2030]
  r = await handleSaveProfile(db, { profile: { ...baseProfile, graduation_year: 2050 } }, reqOf(token));
  assert.equal(rowOf(raw, tea).graduation_year, 2030, '超上限钳到 2030');
  r = await handleSaveProfile(db, { profile: { ...baseProfile, graduation_year: 1970 } }, reqOf(token));
  assert.equal(rowOf(raw, tea).graduation_year, 1980, '低下限钳到 1980');
  // 非整数 / 非数字 → 回 '' → 落库 null
  r = await handleSaveProfile(db, { profile: { ...baseProfile, graduation_year: 2020.5 } }, reqOf(token));
  assert.equal(r.status, 200);
  assert.equal(rowOf(raw, tea).graduation_year, null, '非整数回空串→落库 null');
  r = await handleSaveProfile(db, { profile: { ...baseProfile, graduation_year: 'abc' } }, reqOf(token));
  assert.equal(rowOf(raw, tea).graduation_year, null, '非数字回空串→落库 null');
});

test('非学科项目：白名单去重、报价钳制、project 不在 projects 内剔除、min>max 钳制', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { token, tea } = await seed(db, raw);
  const r = await handleSaveProfile(db, { profile: {
    ...baseProfile,
    nonacademic_projects: ['music', 'chess', 'hacker', 'chess'],
    nonacademic_prices: [
      { project: 'music', price_min: -10, price_max: 9999999 },
      { project: 'chess', price_min: 200, price_max: 100 },
      { project: 'chess', price_min: 300, price_max: 400 }, // Q-2c-F7 BUG-M：重复 project 只留首条
      { project: 'painting', price_min: 50, price_max: 80 }, // 未勾选项目 → 剔除
    ],
  } }, reqOf(token));
  assert.equal(r.status, 200);
  const row = rowOf(raw, tea);
  assert.equal(row.nonacademic_projects, JSON.stringify(['music', 'chess']), '白名单过滤 + 去重');
  const prices = JSON.parse(row.nonacademic_prices);
  assert.equal(prices.length, 2, '未勾选项目（painting）剔除 + 重复 project 只留一条');
  const music = prices.find(x => x.project === 'music');
  assert.equal(music.price_min, 0, 'music 负值钳到 0');
  assert.equal(music.price_max, 99999, 'music 超上限钳到 BUDGET_MAX');
  const chess = prices.find(x => x.project === 'chess');
  assert.equal(chess.price_max, 200, 'chess min=200 > max=100 → max 以 min 为准');
  assert.equal(chess.price_max, 200, 'chess 重复行被去重（首条 200/100 保留，非 300/400）');
});

test('擅长科目白名单：合法入库、注入/未知 id 滤除去重、非数组 400（网安纵深防御）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { token, tea } = await seed(db, raw);
  // 合法科目 + 注入串 + 重复 → 只留白名单内且去重（技术属浙江地区科目池，全量池含）
  let r = await handleSaveProfile(db, { profile: { ...baseProfile, subjects: ['math', '<img onerror=1>', 'math', 'technology'] } }, reqOf(token));
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(rowOf(raw, tea).subjects).join(','), 'math,technology', '白名单过滤 + 去重（注入串丢弃，技术保留）');
  // 非数组 → 400
  r = await handleSaveProfile(db, { profile: { ...baseProfile, subjects: 'math,physics' } }, reqOf(token));
  assert.equal(r.status, 400, 'subjects 非数组拒绝');
  // 缺省 → 空数组
  const { subjects, ...noSubj } = baseProfile;
  r = await handleSaveProfile(db, { profile: noSubj }, reqOf(token));
  assert.equal(r.status, 200);
  assert.equal(rowOf(raw, tea).subjects, '[]', '缺省 subjects 落空数组');
});

test('年级/性别白名单：合法入库、非法静默回退空串（性别含历史 nonbinary）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { token, tea } = await seed(db, raw);
  let r = await handleSaveProfile(db, { profile: { ...baseProfile, grade: 'graduated_master', gender: 'undeclared' } }, reqOf(token));
  assert.equal(r.status, 200);
  assert.equal(rowOf(raw, tea).grade, 'graduated_master', '合法年级入库');
  assert.equal(rowOf(raw, tea).gender, 'undeclared', '合法性别（不愿透露）入库');
  r = await handleSaveProfile(db, { profile: { ...baseProfile, grade: 'hacker', gender: '<script>' } }, reqOf(token));
  assert.equal(r.status, 200, '非法年级/性别不报错，静默回退');
  assert.equal(rowOf(raw, tea).grade, '', '非法年级回退空串');
  assert.equal(rowOf(raw, tea).gender, '', '非法性别回退空串（注入串被丢弃）');
  // 历史 nonbinary 保留（展示层视同未填）
  r = await handleSaveProfile(db, { profile: { ...baseProfile, gender: 'nonbinary' } }, reqOf(token));
  assert.equal(rowOf(raw, tea).gender, 'nonbinary', '历史 nonbinary 兼容保留');
  // Q-2c-F2 守护：undefined/null 穿透白名单（原 `p.x != null` 只拦非空非法值）→ repo 裸绑 undefined → 500
  for (const miss of [{ grade: undefined, gender: undefined }, { grade: null, gender: null }]) {
    const rr = await handleSaveProfile(db, { profile: { ...baseProfile, ...miss } }, reqOf(token));
    assert.equal(rr.status, 200, 'grade/gender undefined/null 归一空串不 500');
    assert.equal(rowOf(raw, tea).grade, '', 'grade undefined/null 归一空串');
    assert.equal(rowOf(raw, tea).gender, '', 'gender undefined/null 归一空串');
  }
});

test('高考成绩白名单：subject 池过滤、score 钳到 [0,300]、非法 grade 丢弃、非数组 400', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { token, tea } = await seed(db, raw);
  const gk = [
    { subject: 'math', score: 150 },
    { subject: 'chinese', score: 9999 },   // 超 300 钳到 300
    { subject: 'hacker', score: 100 },      // 未知科目丢弃
    { subject: 'chemistry', grade: 'A' },   // 合法等第保留
    { subject: 'physics', grade: '<script>' }, // 非法等第丢弃
  ];
  let r = await handleSaveProfile(db, { profile: { ...baseProfile, gaokao_scores: gk } }, reqOf(token));
  assert.equal(r.status, 200);
  const scores = JSON.parse(rowOf(raw, tea).gaokao_scores);
  assert.equal(scores.length, 3, '未知科目与非法等第被丢弃');
  const math = scores.find(x => x.subject === 'math');
  assert.equal(math.score, 150, '合法分数入库');
  const chinese = scores.find(x => x.subject === 'chinese');
  assert.equal(chinese.score, 300, '超上限钳到 300（海南标准分上限）');
  const chem = scores.find(x => x.subject === 'chemistry');
  assert.equal(chem.grade, 'A', '合法等第保留');
  assert.ok(!scores.some(x => x.subject === 'physics'), '非法等第条目被丢弃');
  // 非数组 → 400
  r = await handleSaveProfile(db, { profile: { ...baseProfile, gaokao_scores: 'x' } }, reqOf(token));
  assert.equal(r.status, 400, 'gaokao_scores 非数组拒绝');
});
