/**
 * 教师档案扩展字段服务端校验回归（R2-5/R2-1/R2-2/R2-3/R2-4）
 *
 * handleSaveProfile（server/routes-teacher.js）：
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
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../server/db.js';
import { handleSaveProfile } from '../server/routes-teacher.js';
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
const rowOf = (raw, tea) => raw.prepare('SELECT price_min, price_max, time_slots, teaching_method, personality_tags, nonacademic_projects, nonacademic_prices FROM teacher_profiles WHERE user_id=?').get(tea);

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

test('非学科项目：白名单去重、报价钳制、project 不在 projects 内剔除、min>max 钳制', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { token, tea } = await seed(db, raw);
  const r = await handleSaveProfile(db, { profile: {
    ...baseProfile,
    nonacademic_projects: ['music', 'chess', 'hacker', 'chess'],
    nonacademic_prices: [
      { project: 'music', price_min: -10, price_max: 9999999 },
      { project: 'chess', price_min: 200, price_max: 100 },
      { project: 'painting', price_min: 50, price_max: 80 }, // 未勾选项目 → 剔除
    ],
  } }, reqOf(token));
  assert.equal(r.status, 200);
  const row = rowOf(raw, tea);
  assert.equal(row.nonacademic_projects, JSON.stringify(['music', 'chess']), '白名单过滤 + 去重');
  const prices = JSON.parse(row.nonacademic_prices);
  assert.equal(prices.length, 2, '未勾选项目（painting）剔除');
  const music = prices.find(x => x.project === 'music');
  assert.equal(music.price_min, 0, 'music 负值钳到 0');
  assert.equal(music.price_max, 99999, 'music 超上限钳到 BUDGET_MAX');
  const chess = prices.find(x => x.project === 'chess');
  assert.equal(chess.price_max, 200, 'chess min=200 > max=100 → max 以 min 为准');
});
