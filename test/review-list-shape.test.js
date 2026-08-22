/**
 * PA-1f-F2 guard tests: review list response contract key reviewerName (I-31).
 *
 * The teacher-detail featured review and the admin review list both map the reviewer
 * username through SQL aliases. Contract I-31 (docs/interfaces.md) fixes the public
 * list shape as { reviews: [{ ..., reviewerName, ... }], mine }, and the new-frontend
 * DetailMiddle.vue signature renders featured.reviewerName. The mapper must emit the
 * camelCase key (reviewer_name is retained for the v2 legacy render paths).
 *
 * Approved reviews are seeded directly via SQL (no capToken dependency) so the guard
 * is self-contained: removing the `as reviewerName` alias in reviews/repo.js turns the
 * assertions below red (G2 mutation).
 */
import { test } from 'node:test';
import { TEST_SECRETS } from './_test-secrets.js';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import { handleLogin } from '../src/server/domains/auth/api.js';
import { handleGetReviews, handleAdminReviews } from '../src/server/domains/reviews/api.js';
import { dbGetApprovedReviews, dbGetReviewsAdmin } from '../src/server/domains/reviews/repo.js';

const ENV = { ...TEST_SECRETS, ADMIN_USERNAMES: ['admin_sufe'], ADMIN_DEFAULT_PASSWORD: 'test-pw-123' };

function d1Shim(raw) {
  return {
    prepare(sql) {
      const st = {
        _sql: sql, _params: [],
        bind(...p) { st._params = p; return st; },
        all(...p) { return { results: raw.prepare(st._sql).all(...(p.length ? p : st._params)) }; },
        first(...p) { return raw.prepare(st._sql).get(...(p.length ? p : st._params)) ?? undefined; },
        run(...p) { const info = raw.prepare(st._sql).run(...(p.length ? p : st._params)); return { meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } }; },
      };
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
  raw.prepare('INSERT INTO teacher_profiles (user_id) VALUES (?)').run(teaId);
  // 已通过评价直接落库（公开列表/管理端列表都只发 approved）
  raw.prepare("INSERT INTO reviews (teacher_user_id, reviewer_user_id, rating, comment, status) VALUES (?,?,?,?,'approved')")
    .run(teaId, stuId, 5, '教学清晰');
  return { teaId, stuId };
}

async function adminToken(db, raw) {
  const res = await handleLogin(db, { identifier: 'admin_sufe', password: 'test-pw-123' }, { headers: new Headers() });
  const data = await res.json();
  return data.authToken;
}
const req = token => ({ headers: new Headers(token ? { 'X-Auth-Token': token } : {}) });

test('PA-1f-F2：GET /api/reviews 列表响应含 reviewerName（I-31 契约键，正确用户名）', async () => {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  const db = d1Shim(raw);
  const { teaId } = await seed(db, raw);

  // 数据层直接断言（G1 关键路径）
  const rows = await dbGetApprovedReviews(db, teaId);
  assert.equal(rows.length, 1, '1 条已通过评价');
  assert.equal(rows[0].reviewerName, 'stu', 'repo mapper 补 reviewerName 别名');
  assert.equal(rows[0].reviewer_name, 'stu', 'reviewer_name 旧键保留（v2 旧前端渲染路径）');

  // API 层响应形状断言（契约 I-31 端点）
  const res = await handleGetReviews(db, new URL(`http://x/api/reviews?teacherUserId=${teaId}`), req({}));
  assert.equal(res.status, 200, '公开列表 200');
  const data = await res.json();
  assert.equal(data.reviews.length, 1, '1 条已通过评价');
  assert.equal(data.reviews[0].reviewerName, 'stu', '响应 reviewerName = 评价者用户名（契约 I-31 键）');
});

test('PA-1f-F2：管理端评价列表同样含 reviewerName 别名', async () => {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  const db = d1Shim(raw);
  await seed(db, raw);
  const token = await adminToken(db, raw);

  const rows = await dbGetReviewsAdmin(db, {});
  assert.equal(rows.length, 1, '1 条已通过评价');
  assert.equal(rows[0].reviewerName, 'stu', '管理端 repo mapper 补 reviewerName 别名');

  const res = await handleAdminReviews(db, new URL('http://x/api/admin/reviews?status=approved'), req(token));
  assert.equal(res.status, 200, '管理端 200');
  const data = await res.json();
  assert.equal(data.reviews.length, 1, '1 条已通过评价');
  assert.equal(data.reviews[0].reviewerName, 'stu', '管理端响应 reviewerName 同样对齐契约键');
});
