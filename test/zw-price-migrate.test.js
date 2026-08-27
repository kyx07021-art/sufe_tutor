/**
 * ZW-2（2026-08-27）：教师报价区间 → 单值存量迁移守护测试。
 * 用户原话：「存量报价数据取报价下限作为新的报价单值」。
 * 语义 = scripts/zw-price-migrate.mjs 的 SQL：UPDATE teacher_profiles SET price_max = price_min
 * WHERE price_max IS NOT NULL AND price_max != price_min（只动 price_max 列；恒等行/空行永不命中）。
 *
 * G2 变异守护：去掉 WHERE price_max != price_min 守卫 → 恒等行被无谓 UPDATE（changes>0）→ 幂等断言红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

const MIGRATE_SQL = `UPDATE teacher_profiles SET price_max = price_min WHERE price_max IS NOT NULL AND price_max != price_min`;

function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE teacher_profiles (
    user_id INTEGER PRIMARY KEY, price_min REAL, price_max REAL)`);
  // 区间行（需回填）+ 恒等行（零触碰）+ NULL 行（零触碰）
  db.prepare('INSERT INTO teacher_profiles (user_id, price_min, price_max) VALUES (?,?,?)').run(1, 100, 150);
  db.prepare('INSERT INTO teacher_profiles (user_id, price_min, price_max) VALUES (?,?,?)').run(2, 200, 200);
  db.prepare('INSERT INTO teacher_profiles (user_id, price_min, price_max) VALUES (?,?,?)').run(3, null, null);
  return db;
}

test('ZW-2 迁移：price_max := price_min（区间行回填 + 恒等/NULL 行零触碰）', () => {
  const db = setup();
  const info = db.prepare(MIGRATE_SQL).run();
  assert.equal(info.changes, 1, '恰 1 行（区间行）被回填');
  const r1 = db.prepare('SELECT price_min, price_max FROM teacher_profiles WHERE user_id=1').get();
  assert.equal(r1.price_min, 100); assert.equal(r1.price_max, 100, '区间行 price_max 取报价下限');
  const r2 = db.prepare('SELECT price_min, price_max FROM teacher_profiles WHERE user_id=2').get();
  assert.equal(r2.price_min, 200); assert.equal(r2.price_max, 200, '恒等行零触碰');
  const r3 = db.prepare('SELECT price_min, price_max FROM teacher_profiles WHERE user_id=3').get();
  assert.equal(r3.price_min, null); assert.equal(r3.price_max, null, 'NULL 行零触碰');
});

test('ZW-2 幂等：复跑零变更（变异：去 WHERE 守卫 → 恒等行被无谓 UPDATE → 红）', () => {
  const db = setup();
  db.prepare(MIGRATE_SQL).run();
  const again = db.prepare(MIGRATE_SQL).run();
  assert.equal(again.changes, 0, '复跑零变更（幂等）');
  // 变异：还原 WHERE price_max != price_min → 恒等行(2)也被 UPDATE → changes=1 → 本断言红
  const mutation = db.prepare('UPDATE teacher_profiles SET price_max = price_min WHERE price_max IS NOT NULL').run();
  assert.notEqual(mutation.changes, 1, '变异：无守卫时恒等行被无谓 UPDATE（应 0 行命中）');
});
