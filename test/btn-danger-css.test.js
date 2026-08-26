/**
 * C2（2026-08-26 全站同类缺陷扫描）：注销按钮不红——settings/actions.js:65/159 渲染
 * `.btn-danger`（注销账户入口 + 注销确认弹窗继续按钮）但全仓零 CSS 规则，死类落回标准白按钮。
 *
 * 修法（W29 回滚重做版，首版 FAIL 教训）：`.btn-danger` (0,1,0) 若只靠源序
 * （位于主按钮规则后）会被主按钮规则 `.btn:not(...)` (0,5,0) 按特异性压过——
 * --g-fill/--g-border 成死声明。正确机制 = 主按钮规则 :not() 排除链加 :not(.btn-danger)
 * （与 .btn-text-danger 对称），本类声明才不被 --g-btn-bg/--g-btn-line 覆盖。
 *
 * 覆盖（源级契约 D1 + 承重面锁定）：
 *   - 主按钮规则 :not 链含 :not(.btn-danger)（排除链存在 = .btn-danger 生效的承重面）；
 *   - .btn-danger 规则存在 + 消费 --danger-deep/--g-danger-fill/--g-danger-line；
 *   - 零 padding 覆盖（保留 .btn 标准按钮内距）。
 *
 * G2 变异：删 :not(.btn-danger) 排除项 → 承重面断言红；删 .btn-danger 规则 → 规则断言红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const glass = readFileSync('./glass.css', 'utf8');

test('C2: 主按钮规则排除 :not(.btn-danger)（承重面——删除即红）', () => {
  const mainRule = glass.split('.btn:not(.btn-soft):not(.btn-outline):not(.btn-ghost)')[1] || '';
  const rule = mainRule.split('{')[0] || '';
  assert.ok(rule.includes(':not(.btn-danger)'), '主按钮规则 :not 链含 .btn-danger 排除（否则 (0,5,0) 压过 (0,1,0)，--g-fill/--g-border 成死声明）');
});

test('C2: .btn-danger 规则存在（危险填充/描边 + 标准按钮内距）', () => {
  const idx = glass.indexOf('.btn-danger {');
  assert.ok(idx !== -1, '.btn-danger 规则存在');
  const rule = glass.slice(idx).split('}')[0];
  assert.ok(rule.includes('--danger-deep'), '.btn-danger 前景 = --danger-deep');
  assert.ok(rule.includes('--g-danger-fill'), '.btn-danger 填充 = --g-danger-fill');
  assert.ok(rule.includes('--g-danger-line'), '.btn-danger 描边 = --g-danger-line');
  assert.ok(!rule.includes('padding'), '.btn-danger 不覆盖 padding（保留 .btn 标准内距）');
});
