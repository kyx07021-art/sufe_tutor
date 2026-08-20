/**
 * Z-3-F1/U-3a rework F2：admin 用户名搜索必须返回与列表路径相同的完整行形状。
 * 断线类三（接口形状不一致）防线——dbSearchUsersByRole（complaints 轻量形状）喂给
 * renderAdminUserRow 会静默劣化行（无 meta/封禁态/日期），此处直调 dbAdminSearchUsers
 * 锁服务端契约（G1：核心路径直接测试 + G2：改回轻量形状必红）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { TEST_SECRETS } from './_test-secrets.js';
import { initDb } from '../src/server/core/db.js';
import { dbAdminSearchUsers } from '../src/server/domains/admin/repo.js';

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

async function seed(db, raw) {
  await initDb(db, ENV);
  raw.exec(`INSERT INTO users (username,password_hash,salt,role) VALUES
    ('张老师','h','s','teacher'),('李同学','h','s','student'),('王师','h','s','teacher'),('赵徒','h','s','student')`);
  const idOf = name => raw.prepare('SELECT id FROM users WHERE username=?').get(name).id;
  const t1 = idOf('张老师'), s1 = idOf('李同学');
  // 教师档案（完整 meta 字段：grade/rating/price/verified；credential_image 留空走 decryptField(null)）
  raw.prepare(`INSERT INTO teacher_profiles (user_id, grade, rating, rating_count, rating_sum, price_min, price_max, verified, province, subjects)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(t1, 'freshman', 4.8, 5, 24, 100, 200, 1, 'shanghai', '["math"]');
  // 学生需求（demand_count 计数源）
  raw.prepare(`INSERT INTO student_demands (user_id, student_grade, student_gender, target_subjects, current_scores, submitter_type, parent_contact, student_contact, status)
    VALUES (?,?,'female','["math"]','[]','self','13800000000','13800000000','open')`).run(s1, 'senior1');
  return { idOf };
}

test('F2 守护：教师搜索返回完整行形状（user_id/grade/rating/price/verified/banned/created_at）', async () => {
  const raw = new DatabaseSync(':memory:');
  const db = d1Shim(raw);
  const { idOf } = await seed(db, raw);
  const rows = await dbAdminSearchUsers(db, 'teacher', '张');
  assert.equal(rows.length, 1, 'LIKE 命中张老师');
  const r = rows[0];
  assert.equal(r.user_id, idOf('张老师'), 'user_id 对齐 adminView 出口');
  assert.equal(r.username, '张老师');
  assert.equal(r.grade, 'freshman', 'grade 在位');
  assert.equal(r.rating, 4.8, 'rating 在位');
  assert.equal(r.price_min, 100, 'price_min 在位');
  assert.equal(r.price_max, 200, 'price_max 在位');
  assert.equal(r.verified, true, 'verified 布尔化');
  assert.equal(r.banned, 0, 'banned 在位');
  assert.ok(r.created_at, 'created_at 在位');
});

test('F2 守护：学生搜索返回完整行形状（id/demand_count/banned/created_at）', async () => {
  const raw = new DatabaseSync(':memory:');
  const db = d1Shim(raw);
  const { idOf } = await seed(db, raw);
  const rows = await dbAdminSearchUsers(db, 'student', '李');
  assert.equal(rows.length, 1, 'LIKE 命中李同学');
  const r = rows[0];
  assert.equal(r.id, idOf('李同学'), 'id 对齐 dbGetStudentUsersAdmin 出口');
  assert.equal(r.username, '李同学');
  assert.equal(r.demand_count, 1, 'demand_count 在位（1 条需求）');
  assert.equal(r.banned, 0, 'banned 在位');
  assert.ok(r.created_at, 'created_at 在位');
});

test('F2 守护：LIKE 通配符转义（% 按字面不放大匹配）+ id 数字精确命中', async () => {
  const raw = new DatabaseSync(':memory:');
  const db = d1Shim(raw);
  const { idOf } = await seed(db, raw);
  // % 被 likeEscape 转义为字面：不命中任何用户名
  const wild = await dbAdminSearchUsers(db, 'teacher', '%');
  assert.equal(wild.length, 0, '% 不放大匹配');
  // 纯数字 = 精确 id 命中
  const byId = await dbAdminSearchUsers(db, 'teacher', String(idOf('王师')));
  assert.equal(byId.length, 1, 'id 精确命中');
  assert.equal(byId[0].username, '王师');
});
