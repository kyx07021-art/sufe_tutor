/**
 * C2（2026-08-26 全站同类缺陷扫描）：注销按钮不红——settings/actions.js:65/159 渲染
 * `.btn-danger`（注销账户入口 + 注销确认弹窗继续按钮）但全仓零 CSS 规则，死类落回标准白按钮。
 *
 * 修法：glass.css 补 `.btn-danger` 规则——危险色填充/描边按钮样式，对齐 `.btn-text-danger`
 * 的 --danger token 语义（--g-fg: var(--danger-deep) + --g-fill: var(--g-danger-fill) +
 * --g-border: 1px solid var(--g-danger-line)），零 padding 覆盖（保留 .btn 基类标准按钮内距）。
 *
 * 覆盖（源级契约 D1）：
 *   - glass.css 含 .btn-danger 规则 + 消费 --danger-deep/--g-danger-fill/--g-danger-line；
 *   - .btn-danger 位于 .btn-text-danger 之后（与主按钮规则同特异性，源序胜出，危险色不被
 *     --g-btn-bg 覆盖）；
 *   - 不覆盖 padding（保留 .btn 标准按钮内距）。
 *
 * G2 变异：删 .btn-danger 规则 → 全部断言红；还原 → 绿。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const glass = readFileSync('./glass.css', 'utf8');

test('C2: .btn-danger 规则存在于 glass.css（危险填充/描边 + 标准按钮内距）', () => {
  const idx = glass.indexOf('.btn-danger {');
  assert.ok(idx !== -1, '.btn-danger 规则存在');
  const textIdx = glass.indexOf('.btn-text-danger {');
  assert.ok(idx > textIdx, '.btn-danger 位于 .btn-text-danger 之后（源序胜出主按钮规则）');
  const rule = glass.slice(idx).split('}')[0];
  assert.ok(rule.includes('--danger-deep'), '.btn-danger 前景 = --danger-deep');
  assert.ok(rule.includes('--g-danger-fill'), '.btn-danger 填充 = --g-danger-fill');
  assert.ok(rule.includes('--g-danger-line'), '.btn-danger 描边 = --g-danger-line');
  assert.ok(!rule.includes('padding'), '.btn-danger 不覆盖 padding（保留 .btn 标准内距）');
});
