/**
 * 网安报告 F-09 —— 管理员需求 keyset 游标分页回归：
 * 无 cursor → 纯倒序无 WHERE、LIMIT 51；有 cursor → 复合条件 (created_at,id)；
 * 51 行 → hasMore 且 nextCursor=末行编码；50 行 → nextCursor=null（不再 LIMIT 300 硬截断）；
 * mapper 出口剥除联系方式/门牌（mapDemandRow），Full 变体解密回填。
 * fake D1：db.prepare(sql).bind(...).all() 链捕获 SQL/params。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { dbGetDemands } from '../src/server/domains/demand/repo.js';

function fakeDb(rowFactory) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        bind(...params) {
          return {
            all: async () => {
              calls.push({ sql, params });
              return { results: rowFactory(sql, params) };
            },
          };
        },
      };
    },
  };
}

function makeRow(id, createdAt) {
  return {
    id, user_id: 1, username: 'u', avatar: '',
    student_grade: '高一', student_gender: 'male', target_subjects: '["数学"]', current_scores: '[]',
    teaching_method: 'offline', address: '', address_detail: '门牌号不该出门',
    expected_time: '', budget_min: 0, budget_max: 0, submitter_type: 'parent',
    parent_contact: '13800138000', student_contact: '13900139000', additional_info: '',
    created_at: createdAt,
  };
}

test('无 cursor：倒序无 WHERE、LIMIT 51', async () => {
  const db = fakeDb(() => []);
  await dbGetDemands(db, { admin: true });
  const { sql, params } = db.calls[0];
  assert.ok(!/WHERE/.test(sql), '首屏无 WHERE');
  assert.ok(/ORDER BY sd\.created_at DESC, sd\.id DESC/.test(sql), '复合倒序键');
  assert.ok(/LIMIT 51/.test(sql), 'LIMIT 51 判 hasMore');
  assert.deepEqual(params, []);
});

test('有 cursor：复合条件 (created_at,id) 下推 SQL', async () => {
  const db = fakeDb(() => []);
  await dbGetDemands(db, { admin: true, cursor: '2026-07-01 00:00:00|42' });
  const { sql, params } = db.calls[0];
  assert.ok(/sd\.created_at < \? OR \(sd\.created_at = \? AND sd\.id < \?\)/.test(sql), 'keyset 复合条件');
  assert.deepEqual(params, ['2026-07-01 00:00:00', '2026-07-01 00:00:00', 42]);
});

test('51 行 → 返回 50 + hasMore + nextCursor 编码', async () => {
  const rows = Array.from({ length: 51 }, (_, i) => makeRow(100 - i, `2026-06-01 0${i}:00:00`));
  const db = fakeDb(() => rows);
  const out = await dbGetDemands(db, { admin: true });
  assert.equal(out.demands.length, 50);
  const last = rows[49];
  assert.equal(out.nextCursor, `${last.created_at}|${last.id}`);
});

test('50 行 → nextCursor=null（到尾）', async () => {
  const rows = Array.from({ length: 50 }, (_, i) => makeRow(100 - i, `2026-06-01 0${i}:00:00`));
  const out = await dbGetDemands(fakeDb(() => rows), { admin: true });
  assert.equal(out.demands.length, 50);
  assert.equal(out.nextCursor, null);
});

test('mapper 出口：mapDemandRow 剥联系方式与门牌；Full 解密回填', async () => {
  const rows = [makeRow(1, '2026-06-01 00:00:00')];
  const out = await dbGetDemands(fakeDb(() => rows), { admin: true }); // Full 路径（管理员）
  const d = out.demands[0];
  assert.equal(d.parent_contact, '13800138000', 'Full 解密回填');
  assert.equal(d.student_contact, '13900139000');
  assert.ok(!('address_detail' in d), '门牌永不出口');
  assert.deepEqual(d.target_subjects, ['数学'], 'JSON 列走 safeJsonArray');
});

test('空表 → 空列表 + nextCursor=null', async () => {
  const out = await dbGetDemands(fakeDb(() => []), { admin: true });
  assert.deepEqual(out.demands, []);
  assert.equal(out.nextCursor, null);
});
