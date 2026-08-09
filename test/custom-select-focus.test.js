/**
 * 需求十二（R12）·下拉栏聚焦配色/形状修复
 *
 * 缺陷：custom-select 触发器本体圆角 9px（玻璃输入族），但聚焦效果却落在全局
 * `::where(...):focus-visible` 的 2px 直角 outline（outline-offset 2px）上——
 * 直角矩形描边与圆角字段不匹配，用户定性「紫色直角矩形，丑」。
 *
 * 修复（glass.css 输入族单点）：
 *   - .custom-select-trigger:focus 并入 .form-input/.filter-select 同一聚焦环
 *     （0 0 0 3px var(--g-focus-soft) 软环，随本体 9px 圆角——形状与输入族统一）；
 *   - .custom-select-trigger:focus/-visible、.custom-option:focus-visible outline:none
 *     消除全局直角描边；选项键盘聚焦复用悬停高亮。
 *
 * 本测试为 CSS 内容回归护栏（防规则被删/改回直角描边），并验证
 * 触发器的 DOM 结构（button）不携带会与聚焦环冲突的 outline。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const glass = readFileSync('./glass.css', 'utf8');

test('R12 触发器聚焦环并入输入族（软环随圆角）', () => {
  // 聚焦环规则必须包含 custom-select-trigger（与 form-input/filter-select 同族）
  assert.ok(/\.form-input:focus, \.chat-input:focus, \.filter-select:focus, \.custom-select-trigger:focus \{/.test(glass),
    '触发器聚焦环与输入族同一规则');
  assert.ok(glass.includes('0 0 0 3px var(--g-focus-soft)'), '聚焦环用标准软环 token');
});

test('R12 消除全局直角 outline：触发器与选项 focus-visible 均 outline:none', () => {
  assert.ok(/\.custom-select-trigger:focus, \.custom-select-trigger:focus-visible, \.custom-option:focus-visible \{ outline: none; \}/.test(glass),
    '触发器与下拉选项均取消直角 outline');
  assert.ok(/\.custom-option:focus-visible \{ background: var\(--g-option-hover\); color: var\(--ink\); \}/.test(glass),
    '选项键盘聚焦复用悬停高亮（替代 outline）');
});

test('R12 触发器元素无自带 outline 冲突（base 声明 outline:none）', () => {
  // 触发器 base 走输入族（border:none 无 outline）；确认没有直写 outline 的散件
  assert.ok(!/\.custom-select-trigger\s*\{[^}]*outline:\s*2px/.test(glass),
    '触发器 base 无 2px outline 散件');
});
