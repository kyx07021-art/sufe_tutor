/**
 * 网安报告 F-09 —— 管理员需求 keyset 游标分页回归（S3 单科目新模型）：
 * 无 cursor → 纯倒序无 WHERE、LIMIT 51；有 cursor → 复合条件 (created_at,id)；
 * 51 行 → hasMore 且 nextCursor=末行编码；50 行 → nextCursor=null（不再 LIMIT 300 硬截断）；
 * mapper 出口（mapDemandRow）= 单科目业务形状（subject/targetType/preferredTags 等），
 * 联系方式/门牌列不存储（S3 整列删除）→ 任何出口拿不到，无 Full 解密变体。
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
    subject: 'math', grade: 'senior1', province: 'shanghai',
    teaching_method: 'online', current_score: '120', address_area: '',
    expected_time: '', preferred_tags: '["patience"]', preferred_gender: 'female',
    budget_min: 0, budget_max: 0, additional_info: '', status: 'open',
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

test('mapper 出口：单科目业务形状 + JSON 列 safeJsonArray；联系方式/门牌永不出口', async () => {
  const rows = [makeRow(1, '2026-06-01 00:00:00')];
  const out = await dbGetDemands(fakeDb(() => rows), { admin: true });
  const d = out.demands[0];
  assert.equal(d.subject, 'math', '单科目');
  assert.equal(d.targetType, 'academic', 'targetType 由 subject 派生');
  assert.equal(d.grade, 'senior1');
  assert.equal(d.province, 'shanghai');
  assert.equal(d.teachingMethod, 'online');
  assert.equal(d.currentScore, '120');
  assert.deepEqual(d.preferredTags, ['patience'], 'JSON 列走 safeJsonArray');
  assert.equal(d.preferredGender, 'female');
  assert.equal(d.status, 'open');
  // S3 联系方式/门牌列不存储 → 任何出口都拿不到（无 Full 解密变体）
  for (const k of ['parent_contact', 'student_contact', 'submitter_type', 'address_detail']) {
    assert.ok(!(k in d), `${k} 永不出口`);
  }
});

test('空表 → 空列表 + nextCursor=null', async () => {
  const out = await dbGetDemands(fakeDb(() => []), { admin: true });
  assert.deepEqual(out.demands, []);
  assert.equal(out.nextCursor, null);
});
