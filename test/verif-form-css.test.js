/**
 * B2（2026-08-26 全站同类缺陷扫描）：admin 学信网核验通过表单窄输入——.verif-grid
 * （auto-fit minmax(200px,1fr)）内 .form-label flex:0 0 116px 固定宽吃宽度，紧凑格内输入框
 * 被挤到 ~60-130px（同「label 吃宽度」机制，CHSI 输入框同类已修于 features/teacher.css）。
 *
 * 修法（对齐 teacher.css .verify-pane 先例）：.verif-grid .form-label 收缩到内容宽 +
 * .form-input flex-basis 100% 换行占满整格 → 输入框宽度 = 网格列宽；
 * .verif-grid 基规则 minmax(200px,1fr) 保证列宽 ≥200px → 输入框 ≥200px。
 *
 * 覆盖（源级契约 D1）：
 *   - .verif-grid .form-label 收缩规则（flex: 0 0 auto + min-width: 0）；
 *   - .verif-grid .form-input 占满规则（flex: 1 1 100% + min-width: 0）；
 *   - .verif-grid 基规则保留 minmax(200px（输入框 ≥200px 的宽度保证）。
 *
 * G2 变异：删任一条修复规则 → 对应断言红；还原 → 绿。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const adminCss = readFileSync('./features/admin.css', 'utf8');

test('B2: .verif-grid 标签收缩 + 输入框占满整格（输入框 ≥ 网格列宽 ≥200px）', () => {
  const labelRule = adminCss.split('.verif-grid .form-label {')[1] || '';
  assert.ok(labelRule.split('}')[0].includes('flex: 0 0 auto'), '.verif-grid 标签收缩到内容宽');
  assert.ok(labelRule.split('}')[0].includes('min-width: 0'), '.verif-grid 标签 min-width 0');
  const inputRule = adminCss.split('.verif-grid .form-input {')[1] || '';
  assert.ok(inputRule.split('}')[0].includes('flex: 1 1 100%'), '.verif-grid 输入框 flex-basis 100% 换行占满整格');
  assert.ok(inputRule.split('}')[0].includes('min-width: 0'), '.verif-grid 输入框 min-width 0');
  const gridRule = adminCss.split('.verif-grid {')[1] || '';
  assert.ok(gridRule.split('}')[0].includes('minmax(200px'), '.verif-grid 列宽下限 200px 保留（输入框 ≥200px 保证）');
});
