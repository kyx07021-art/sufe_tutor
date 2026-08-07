/**
 * app-display.diffLines 行级 diff 回归（v0.24.3 合同改动高亮）
 *
 * 纯函数层（constants + region-data + app-display，零 DOM）真实加载验证：
 * LCS 回溯分类 same/del/add 的边界：纯新增、纯删除、混合替换、空文本、单行、全同。
 * 守卫 bug 类别：dp 越界、回溯顺序错（del/add 次序翻转）、空文本误产出。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function loadDisplay() {
  const sandbox = { console };
  vm.createContext(sandbox);
  for (const f of ['constants.js', 'region-data.js', 'app-display.js']) {
    vm.runInContext(readFileSync('./' + f, 'utf8'), sandbox, { filename: f });
  }
  return vm.runInContext('globalThis.SUFE_DISPLAY', sandbox);
}
// 跨 vm 沙箱返回值原型属沙箱域，deepEqual 判不等 → 展开归一化到测试域
const types = ops => [...ops.map(o => o.t)];

test('diffLines：纯新增行', () => {
  const D = loadDisplay();
  const ops = D.diffLines('A\nB', 'A\nB\nC');
  assert.deepEqual(types(ops), ['same', 'same', 'add']);
  assert.equal(ops[2].text, 'C');
});

test('diffLines：纯删除行', () => {
  const D = loadDisplay();
  const ops = D.diffLines('A\nB\nC', 'A\nC');
  assert.deepEqual(types(ops), ['same', 'del', 'same']);
  assert.equal(ops[1].text, 'B');
});

test('diffLines：混合替换（2 → X）', () => {
  const D = loadDisplay();
  const ops = D.diffLines('1\n2\n3', '1\nX\n3');
  assert.deepEqual(types(ops), ['same', 'del', 'add', 'same']);
  assert.equal(ops[1].text, '2');
  assert.equal(ops[2].text, 'X');
});

test('diffLines：空文本边界', () => {
  const D = loadDisplay();
  assert.deepEqual(types(D.diffLines('', '')), []);
  assert.deepEqual(types(D.diffLines('', 'A\nB')), ['add', 'add']);
  assert.deepEqual(types(D.diffLines('A\nB', '')), ['del', 'del']);
});

test('diffLines：完全相同的文本 → 全 same 无增删', () => {
  const D = loadDisplay();
  const ops = D.diffLines('第一条\n第二条', '第一条\n第二条');
  assert.ok(ops.length > 0 && ops.every(o => o.t === 'same'), '全同应无 del/add');
});

test('diffLines：行内容相同但顺序调整（LCS 保持最长公共子序列）', () => {
  const D = loadDisplay();
  const ops = D.diffLines('甲\n乙\n丙', '丙\n乙\n甲');
  // LCS = ['乙']（或 ['丙']/'['甲'] 之一），回溯必产出 add+del 对
  assert.ok(ops.some(o => o.t === 'add') && ops.some(o => o.t === 'del'), '重排应检出增删');
});
