/**
 * Q-6-M1 覆盖空洞补齐：reviews 域服务端审核 API 零直接测试（Z-5-F1 复发风险——
 * auth/repo.js dbRecomputeTeacherRating 依赖 dbGetApprovedReviewStats/dbUpdateTeacherRating，
 * 未 import 时 approve/reject/delete 评分重算全 500，此前仅靠 node 复现抓到）。
 * 守护：approve 后 teacher_profiles.rating 按公式重算 + 幂等（二次 approve 不漂移）。
 */
import { test } from 'node:test';
import { TEST_SECRETS } from './_test-secrets.js';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import { tokenDigest } from '../src/server/core/crypto.js';
import { handleLogin } from '../src/server/domains/auth/api.js';
import { handleReviewAction, handleAdminDeleteReview } from '../src/server/domains/reviews/api.js';
import { INITIAL_RATING, INITIAL_WEIGHT } from '../src/shared/config.js';

const ENV = { ...TEST_SECRETS, ADMIN_USERNAMES: ['admin_sufe'], ADMIN_DEFAULT_PASSWORD: 'test-pw-123' };

function d1Shim(raw) {
  return {
    prepare(sql) {
      const st = { _sql: sql, _params: [], bind(...p) { st._params = p; return st; },
        all(...p) { return { results: raw.prepare(st._sql).all(...(p.length ? p : st._params)) }; },
        first(...p) { return raw.prepare(st._sql).get(...(p.length ? p : st._params)) ?? undefined; },
        run(...p) { const info = raw.prepare(st._sql).run(...(p.length ? p : st._params)); return { meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } }; } };
      return st;
    },
    async batch(stmts) {
      if (!stmts.length) throw new Error('D1 batch requires at least one statement');
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

async function seed(db, raw) {
  await initDb(db, ENV);
  raw.exec(`INSERT INTO users (username,password_hash,salt,role) VALUES ('stu','h','s','student'),('tea','h','s','teacher')`);
  const teaId = raw.prepare("SELECT id FROM users WHERE username='tea'").get().id;
  const stuId = raw.prepare("SELECT id FROM users WHERE username='stu'").get().id;
  // 教师档案行（rating 默认 INITIAL_RATING=4.5）——评分重算的 UPDATE 目标
  raw.prepare('INSERT INTO teacher_profiles (user_id) VALUES (?)').run(teaId);
  // 学生 pending 评价
  const r = raw.prepare("INSERT INTO reviews (teacher_user_id, reviewer_user_id, rating, comment, status) VALUES (?,?,?,?,'pending')")
    .run(teaId, stuId, 5, '教学清晰');
  return { teaId, stuId, reviewId: Number(r.lastInsertRowid) };
}

async function adminToken(db, raw) {
  const res = await handleLogin(db, { identifier: 'admin_sufe', password: 'test-pw-123' }, { headers: new Headers() });
  const data = await res.json();
  return data.authToken;
}
const req = token => ({ headers: new Headers(token ? { 'X-Auth-Token': token } : {}) });

test('Q-6-M1：review approve 后教师评分按公式重算 + 幂等（不漂移）', async () => {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  const db = d1Shim(raw);
  const { teaId, reviewId } = await seed(db, raw);
  const token = await adminToken(db, raw);

  const res = await handleReviewAction(db, reviewId, 'approve', {}, req(token));
  assert.equal(res.status, 200, 'approve 成功');
  const row = raw.prepare('SELECT rating, rating_count, rating_sum FROM teacher_profiles WHERE user_id=?').get(teaId);
  const expected = (INITIAL_RATING * INITIAL_WEIGHT + 5) / (INITIAL_WEIGHT + 1);
  assert.ok(Math.abs(row.rating - expected) < 1e-9, `rating 重算 (${row.rating} ≈ ${expected})`);
  assert.equal(row.rating_count, 1, '计数 1');
  assert.equal(row.rating_sum, 5, '和 5');

  // 幂等：已 approved 再 approve → wasApproved=true 重算同值（stats 不变）
  const res2 = await handleReviewAction(db, reviewId, 'approve', {}, req(token));
  assert.equal(res2.status, 200);
  const row2 = raw.prepare('SELECT rating FROM teacher_profiles WHERE user_id=?').get(teaId);
  assert.ok(Math.abs(row2.rating - expected) < 1e-9, '幂等 approve 不漂移');
});

test('Q-6-M1：reject 原已通过评价摘掉评分（重算回落）', async () => {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  const db = d1Shim(raw);
  const { teaId, reviewId } = await seed(db, raw);
  const token = await adminToken(db, raw);

  await handleReviewAction(db, reviewId, 'approve', {}, req(token));
  const before = raw.prepare('SELECT rating FROM teacher_profiles WHERE user_id=?').get(teaId).rating;
  await handleReviewAction(db, reviewId, 'reject', {}, req(token)); // wasApproved → 摘掉评分
  const after = raw.prepare('SELECT rating FROM teacher_profiles WHERE user_id=?').get(teaId).rating;
  assert.ok(after < before, `reject 已通过评价后评分回落 (${after} < ${before})`);
  assert.ok(Math.abs(after - INITIAL_RATING) < 1e-9, '回落到初始分');
});

test('Q-6-M1：admin delete 已通过评价重算评分', async () => {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  const db = d1Shim(raw);
  const { teaId, reviewId } = await seed(db, raw);
  const token = await adminToken(db, raw);

  await handleReviewAction(db, reviewId, 'approve', {}, req(token));
  const res = await handleAdminDeleteReview(db, reviewId, {}, req(token));
  assert.equal(res.status, 200, 'delete 成功');
  const row = raw.prepare('SELECT rating, rating_count FROM teacher_profiles WHERE user_id=?').get(teaId);
  assert.equal(row.rating_count, 0, '计数清零');
  assert.ok(Math.abs(row.rating - INITIAL_RATING) < 1e-9, '回落到初始分');
});
