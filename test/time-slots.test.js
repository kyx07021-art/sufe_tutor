/**
 * 结构化期望开课时间服务端校验回归（v0.25.0 需求一）
 *
 * sanitizeTimeSlots（server/util.js 导出，v0.25.x 从 routes-demands.js 迁入；需求 expected_time
 * 与教师档案 time_slots 共用同一实现）：库内 JSON
 * [{type:'week',dow:1..7,start:'HH:MM',end:'HH:MM'}] 白名单式校验。
 * 守卫 bug 类别：非 JSON/非数组入库、越界 dow、非法时刻、结束早于开始、
 * 条数超限、未知 type（未来扩展如月日+时间未实现前一律拒绝）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeTimeSlots } from '../src/server/core/util.js';

const slot = (dow, start, end) => JSON.stringify([{ type: 'week', dow, start, end }]);
const ok = r => !r.error && typeof r.value === 'string';

test('空/缺省 → 空串合法（时间非必填）', () => {
  assert.deepEqual(sanitizeTimeSlots(''), { value: '' });
  assert.deepEqual(sanitizeTimeSlots(undefined), { value: '' });
  assert.deepEqual(sanitizeTimeSlots('  '), { value: '' });
  assert.deepEqual(sanitizeTimeSlots(null), { value: '' });
});

test('合法周时段 JSON：规范化入库', () => {
  const r = sanitizeTimeSlots(JSON.stringify([
    { type: 'week', dow: 1, start: '18:00', end: '20:30' },
    { type: 'week', dow: 7, start: '09:00', end: '11:00' },
  ]));
  assert.ok(ok(r), '应返回 value');
  const arr = JSON.parse(r.value);
  assert.equal(arr.length, 2);
  assert.deepEqual(arr[0], { type: 'week', dow: 1, start: '18:00', end: '20:30' });
});

test('非 JSON / 非数组 / 历史纯文本 → 拒绝（写入路径不收旧格式）', () => {
  assert.ok(sanitizeTimeSlots('工作日晚上').error, '纯文本应拒绝');
  assert.ok(sanitizeTimeSlots('{"a":1}').error, '对象应拒绝');
  assert.ok(sanitizeTimeSlots('null').error, 'null 应拒绝');
  assert.ok(sanitizeTimeSlots('42').error, '标量应拒绝');
});

test('未知 type（未来扩展未实现）→ 拒绝', () => {
  assert.ok(sanitizeTimeSlots(JSON.stringify([{ type: 'date', date: '2026-09-01', start: '10:00', end: '12:00' }])).error);
});

test('星期越界 → 拒绝', () => {
  assert.ok(sanitizeTimeSlots(slot(0, '10:00', '12:00')).error, 'dow=0');
  assert.ok(sanitizeTimeSlots(slot(8, '10:00', '12:00')).error, 'dow=8');
  assert.ok(sanitizeTimeSlots(slot('1', '10:00', '12:00')).error, 'dow 非整数');
});

test('时刻格式/范围 → 拒绝', () => {
  assert.ok(sanitizeTimeSlots(slot(1, '24:00', '12:00')).error, '时=24');
  assert.ok(sanitizeTimeSlots(slot(1, '10:60', '12:00')).error, '分=60');
  assert.ok(sanitizeTimeSlots(slot(1, '8:00', '12:00')).error, '未补零 8:00');
  assert.ok(sanitizeTimeSlots(slot(1, '10:00', '12:00')).value, '合法边界 00:00~23:59 内');
});

test('结束须晚于开始 → 拒绝', () => {
  assert.ok(sanitizeTimeSlots(slot(1, '12:00', '12:00')).error, 'start==end');
  assert.ok(sanitizeTimeSlots(slot(1, '13:00', '12:00')).error, 'end<start');
  assert.ok(ok(sanitizeTimeSlots(slot(1, '00:00', '23:59'))), '全天段合法');
});

test('条数上限 TIME_SLOTS_MAX=8', () => {
  const slots = Array.from({ length: 9 }, (_, i) => ({ type: 'week', dow: (i % 7) + 1, start: '10:00', end: '11:00' }));
  assert.ok(sanitizeTimeSlots(JSON.stringify(slots)).error, '9 条超限');
  const r8 = sanitizeTimeSlots(JSON.stringify(slots.slice(0, 8)));
  assert.equal(JSON.parse(r8.value).length, 8, '8 条合法');
});
