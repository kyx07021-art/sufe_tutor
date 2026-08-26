/**
 * ZH-1（2026-08-26）：教师广场公开列表过滤 chsi_verified=1——未认证教师不出现在
 * 教师广场（匿名/登录学生视图），adminView 管理端全量保留（审核需要）。
 * 变异守护：删过滤 → 未认证教师出现在公开列表 → 断言红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import { dbUpsertTeacherProfile, dbGetTeachers, dbApplyChsiToProfile } from '../src/server/domains/teacher/repo.js';
import { TEST_SECRETS } from './_test-secrets.js';

const ENV = { ...TEST_SECRETS, ADMIN_USERNAMES: ['admin_sufe'], ADMIN_DEFAULT_PASSWORD: 'test-pw-123' };

// 与 initdb-migration.test.js 同款 D1 形状薄封装（node:sqlite → D1 形状）
function d1Shim(raw) {
  return {
    prepare(sql) {
      const st = { _sql: sql, _params: [], bind(...p) { st._params = p; return st; }, all(...p) { return { results: raw.prepare(st._sql).all(...(p.length ? p : st._params)) }; }, first(...p) { return raw.prepare(st._sql).get(...(p.length ? p : st._params)) ?? undefined; }, run(...p) { const info = raw.prepare(st._sql).run(...(p.length ? p : st._params)); return { meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } }; } };
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

async function seed() {
  const raw = new DatabaseSync(':memory:');
  const db = d1Shim(raw);
  await initDb(db, ENV);
  raw.prepare("INSERT INTO users (username,password_hash,salt,role) VALUES ('stu1','h','s','student'),('t_verified','h','s','teacher'),('t_unverified','h','s','teacher')").run();
  const stu = raw.prepare("SELECT id FROM users WHERE username='stu1'").get().id;
  const v = raw.prepare("SELECT id FROM users WHERE username='t_verified'").get().id;
  const u = raw.prepare("SELECT id FROM users WHERE username='t_unverified'").get().id;
  await dbUpsertTeacherProfile(db, v, { province: 'shanghai', grade: '', gender: 'male', subjects: ['数学'], gaokao_scores: [], price: 100 });
  await dbUpsertTeacherProfile(db, u, { province: 'shanghai', grade: '', gender: 'female', subjects: ['物理'], gaokao_scores: [], price: 80 });
  await dbApplyChsiToProfile(db, v, { school: '测试大学', level: '本科', major: '', enrollmentStatus: '在校', enrollYear: '2024' });
  return { db, stu, v, u };
}

test('ZH-1 匿名访客公开列表：已认证可见、未认证被排除', async () => {
  const { db, v, u } = await seed();
  const list = await dbGetTeachers(db, {});
  const ids = list.map(t => t.user_id);
  assert.deepEqual(ids, [v], '公开列表应仅含已认证教师（匿名访客）');
  assert.ok(!ids.includes(u), '未认证教师不应出现在公开列表');
});

test('ZH-1 登录学生公开列表：已认证可见、未认证被排除', async () => {
  const { db, stu, v, u } = await seed();
  const list = await dbGetTeachers(db, { viewerId: stu });
  const ids = list.map(t => t.user_id);
  assert.ok(ids.includes(v), '已认证教师应出现在公开列表');
  assert.ok(!ids.includes(u), '未认证教师不应出现在公开列表');
});

test('ZH-1 adminView：未认证教师仍全量保留（管理端审核需要）', async () => {
  const { db, u } = await seed();
  const adminList = await dbGetTeachers(db, { adminView: true });
  const ids = adminList.map(t => t.user_id);
  assert.ok(ids.includes(u), 'adminView 应保留未认证教师（管理端审核需要）');
  assert.equal(ids.length, 2, 'adminView 两教师全量可见');
});
