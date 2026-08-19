/**
 * Z-13-F3：JSON 咽喉反序列化单测——safeJsonObject/safeJsonArray 是路由层零 JSON.parse 契约
 * （规则 42）的承重面，complaints/repo.js:74 的 target_snapshot 反序列化等走此咽喉。
 * 覆盖：空值回退 / 对象原样 / 数组拒绝 / 合法字符串解析 / 非法与标量回退 / 自定义 fallback。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeJsonArray, safeJsonObject } from '../src/server/core/json.js';

test('safeJsonObject：空值/未定义 → 默认 fallback', () => {
  assert.deepEqual(safeJsonObject(undefined), {}, 'undefined 回退空对象');
  assert.deepEqual(safeJsonObject(null), {}, 'null 回退空对象');
  assert.deepEqual(safeJsonObject(''), {}, '空串回退空对象');
  assert.deepEqual(safeJsonObject(undefined, { a: 1 }), { a: 1 }, '自定义 fallback 生效');
});

test('safeJsonObject：已是对象 → 原样返回（非数组）', () => {
  const o = { a: 1, b: 'x' };
  assert.equal(safeJsonObject(o), o, '对象原样返回（引用相等）');
  assert.deepEqual(safeJsonObject([1, 2]), {}, '数组拒绝 → fallback（对象咽喉不接数组）');
});

test('safeJsonObject：合法 JSON 字符串 → 解析为对象', () => {
  assert.deepEqual(safeJsonObject('{"a":1,"b":"x"}'), { a: 1, b: 'x' }, '对象 JSON 解析');
  assert.deepEqual(safeJsonObject('{"nested":{"k":[1,2]}}'), { nested: { k: [1, 2] } }, '嵌套对象解析');
  assert.deepEqual(safeJsonObject('{"a":1}', { x: 9 }), { a: 1 }, '解析成功不落 fallback');
});

test('safeJsonObject：非法/标量 JSON → fallback（fail-closed 不炸）', () => {
  assert.deepEqual(safeJsonObject('not json'), {}, '非法 JSON 回退');
  assert.deepEqual(safeJsonObject('{"a":1'), {}, '截断 JSON 回退');
  assert.deepEqual(safeJsonObject('123'), {}, '标量 JSON 回退（非对象）');
  assert.deepEqual(safeJsonObject('"str"'), {}, '字符串 JSON 回退');
  assert.deepEqual(safeJsonObject('true'), {}, '布尔 JSON 回退');
  assert.deepEqual(safeJsonObject('[1,2]'), {}, '数组 JSON 回退');
  assert.deepEqual(safeJsonObject('null'), {}, 'null JSON 回退');
  assert.deepEqual(safeJsonObject('bad json', { x: 9 }), { x: 9 }, '非法时自定义 fallback');
});

test('safeJsonArray：数组安全解析（对偶咽喉）', () => {
  assert.deepEqual(safeJsonArray('["a","b"]'), ['a', 'b'], '数组 JSON 解析');
  assert.deepEqual(safeJsonArray(undefined), [], '空值回退空数组');
  assert.deepEqual(safeJsonArray('{"a":1}'), [], '对象 JSON 回退空数组');
  assert.deepEqual(safeJsonArray('bad'), [], '非法 JSON 回退空数组');
  const arr = ['x'];
  assert.equal(safeJsonArray(arr), arr, '已是数组原样返回');
});
