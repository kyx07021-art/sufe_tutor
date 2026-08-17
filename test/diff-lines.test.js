/**
 * core/display.diffLines 行级 diff 回归（B4：直接 import ESM）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffLines } from '../src/client/core/display.js';

const types = ops => [...ops.map(o => o.t)];

test('diffLines：纯新增行', () => {
  const ops = diffLines('A\nB', 'A\nB\nC');
  assert.deepEqual(types(ops), ['same', 'same', 'add']);
  assert.equal(ops[2].text, 'C');
});

test('diffLines：纯删除行', () => {
  const ops = diffLines('A\nB\nC', 'A\nC');
  assert.deepEqual(types(ops), ['same', 'del', 'same']);
  assert.equal(ops[1].text, 'B');
});

test('diffLines：混合替换（2 → X）', () => {
  const ops = diffLines('1\n2\n3', '1\nX\n3');
  assert.deepEqual(types(ops), ['same', 'del', 'add', 'same']);
  assert.equal(ops[1].text, '2');
  assert.equal(ops[2].text, 'X');
});

test('diffLines：空文本边界', () => {
  assert.deepEqual(types(diffLines('', '')), []);
  assert.deepEqual(types(diffLines('', 'A\nB')), ['add', 'add']);
  assert.deepEqual(types(diffLines('A\nB', '')), ['del', 'del']);
});

test('diffLines：完全相同的文本 → 全 same 无增删', () => {
  const ops = diffLines('第一条\n第二条', '第一条\n第二条');
  assert.ok(ops.length > 0 && ops.every(o => o.t === 'same'));
});

test('diffLines：行内容相同但顺序调整（LCS 保持最长公共子序列）', () => {
  const ops = diffLines('A\nB\nC', 'C\nA');
  assert.ok(ops.some(o => o.t === 'same'));
});
