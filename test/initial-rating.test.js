/**
 * 需求十六（R16）·教师默认评分 4.5、默认权重 10、对所有用户应用
 *
 * 改动：
 *   - server/constants.js：INITIAL_RATING 4.0 → 4.5（INITIAL_WEIGHT 保持 10）；
 *   - server/db.js initDb 幂等回填：存量从未被评价的教师（rating_count=0，rating=旧默认）
 *     回填 4.5，被评价过的保留实际加权分——「对所有用户应用」。
 *
 * 本测试覆盖：新档案默认 4.5；存量未评价 4.0 → initDb 幂等回填 4.5；被评价教师不受影响；
 * 权重常数保持 10。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb, dbUpsertTeacherProfile } from '../server/db.js';
import { INITIAL_RATING, INITIAL_WEIGHT } from '../server/constants.js';

const ENV = { ADMIN_USERNAMES: ['admin_sufe'], ADMIN_DEFAULT_PASSWORD: 'test-pw-123' };

function d1Shim(raw) {
  return {
    prepare(sql) {
      const st = { _sql: sql, _params: [], bind(...p) { st._params = p; return st; },
        all(...p) { return { results: raw.prepare(st._sql).all(...(p.length ? p : st._params)) }; },
        first(...p) { return raw.prepare(st._sql).get(...(p.length ? p : st._params)) ?? undefined; },
        run(...p) { const info = raw.prepare(st._sql).run(...(p.length ? p : st._params)); return { meta: { changes: Number(info.changes) } }; } };
      return st;
    },
    batch(stmts) {
      raw.exec('BEGIN');
      try { const out = []; for (const s of stmts) {
        if (/^\s*(SELECT|PRAGMA|WITH|EXPLAIN)/i.test(s._sql)) out.push({ results: raw.prepare(s._sql).all(...s._params) });
        else { const info = raw.prepare(s._sql).run(...s._params); out.push({ meta: { changes: Number(info.changes) } }); }
      } raw.exec('COMMIT'); return out; }
      catch (e) { try { raw.exec('ROLLBACK'); } catch { /* ignore */ } throw e; }
    },
  };
}
const rawOf = () => { const r = new DatabaseSync(':memory:'); r.exec('PRAGMA foreign_keys = ON'); return r; };
const ratingOf = (raw, userId) => raw.prepare('SELECT rating, rating_count FROM teacher_profiles WHERE user_id=?').get(userId);

/** 播种一名教师（含用户行 + 档案） */
async function seedTeacher(raw, db, name) {
  raw.exec(`INSERT INTO users (username,password_hash,salt,role) VALUES ('${name}','h','s','teacher')`);
  const userId = raw.prepare("SELECT id FROM users WHERE username=?").get(name).id;
  await dbUpsertTeacherProfile(db, userId, {
    province: 'shanghai', grade: '', gender: '', subjects: [], gaokao_scores: [],
    price: 100, wechat: '', email: '', intro: '', address: '', school: '', real_name: '',
    credential_image: '',
  });
  return userId;
}

test('R16 新教师档案默认评分 4.5（INITIAL_RATING），权重常数保持 10', async () => {
  assert.equal(INITIAL_RATING, 4.5, '默认评分常量 4.5');
  assert.equal(INITIAL_WEIGHT, 10, '默认权重保持 10');
  const raw = rawOf(); const db = d1Shim(raw);
  await initDb(db, ENV);
  const uid = await seedTeacher(raw, db, 't_new');
  const row = ratingOf(raw, uid);
  assert.equal(row.rating, 4.5, '新档案默认评分 4.5');
  assert.equal(row.rating_count, 0, '未评价计数 0');
});

test('R16 存量未评价教师（旧默认 4.0）→ initDb 幂等回填 4.5', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  await initDb(db, ENV);
  const uid = await seedTeacher(raw, db, 't_old');
  // 模拟旧默认（initDb 首次跑后置回 4.0，rating_count=0）
  raw.prepare('UPDATE teacher_profiles SET rating=4.0 WHERE user_id=?').run(uid);
  assert.equal(ratingOf(raw, uid).rating, 4.0, '前置：存量旧默认 4.0');
  // initDb 幂等重跑（真实发布后每次启动都会走）→ 回填
  await initDb(db, ENV);
  assert.equal(ratingOf(raw, uid).rating, 4.5, '未评价存量教师回填 4.5');
  // 再跑一次仍稳定（幂等）
  await initDb(db, ENV);
  assert.equal(ratingOf(raw, uid).rating, 4.5, '幂等：重复 initDb 不回退');
});

test('R16 已被评价教师（rating_count>0）保留实际加权分，不强制改 4.5', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  await initDb(db, ENV);
  const uid = await seedTeacher(raw, db, 't_reviewed');
  raw.prepare('UPDATE teacher_profiles SET rating=3.8, rating_count=5, rating_sum=19 WHERE user_id=?').run(uid);
  await initDb(db, ENV);
  const row = ratingOf(raw, uid);
  assert.equal(row.rating, 3.8, '已评价教师保留加权分');
  assert.equal(row.rating_count, 5, '评价计数不动');
});
