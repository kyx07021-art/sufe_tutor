/**
 * Q-2a-L2 守护：parseIdParam 严格数字路由参数解析（core/util.js）。
 * 变异：parseIdParam 放宽回 parseInt → /api/users/1abc 命中 id=1 → 本测试红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIdParam } from '../src/server/core/util.js';

test('parseIdParam 接受纯十进制正整数', () => {
  assert.equal(parseIdParam('1'), 1);
  assert.equal(parseIdParam('42'), 42);
  assert.equal(parseIdParam('0'), 0);
  assert.equal(parseIdParam('999'), 999);
});

test('parseIdParam 拒绝脏输入（前缀数字截断 / 非数字 / 非字符串）', () => {
  assert.equal(parseIdParam('1abc'), null, '前缀数字截断是 L2 根因：parseInt("1abc")===1');
  assert.equal(parseIdParam('abc'), null);
  assert.equal(parseIdParam(''), null);
  assert.equal(parseIdParam('-1'), null);
  assert.equal(parseIdParam('1.5'), null);
  assert.equal(parseIdParam(' 1'), null, '前导空白不入内');
  assert.equal(parseIdParam('1e3'), null);
  assert.equal(parseIdParam(undefined), null);
  assert.equal(parseIdParam(null), null);
  assert.equal(parseIdParam(5), null, '非字符串（数字）拒绝');
  assert.equal(parseIdParam('0x10'), null, '十六进制拒绝');
  assert.equal(parseIdParam('+7'), null, '符号拒绝');
});
