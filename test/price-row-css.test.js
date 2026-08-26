/**
 * C4（2026-08-26 全站同类缺陷扫描）：非学科报价行错乱——JS 渲染用 `.price-row/.price-row-name`
 * 但 CSS 零命中；CSS 里 `.nonacademic-price-row/.na-project-name/.na-range` 为无消费方孤儿。
 *
 * 修法（任务判据 = 复用既有 + 干净）：`.price-row/.price-row-name` 是 JS 收集/渲染/测试的活 DOM
 * 契约（actions.js:321/522/531-532），而 `.na-*` 全仓零消费者（grep 仅 CSS 自身）——故按 W18
 * 统一为 `.price-row` 补一套规则（复用原 `.na-*` 布局），并删 `.na-*` 死规则，禁止两套并存。
 *
 * 覆盖：
 *   - CSS 源级契约：features/teacher.css 含 .price-row flex 行布局 + .price-row-name 消费 --ink-3
 *     + .price-row .form-input 撑满规则；responsive.css 含 .price-row 纵向窄屏规则；
 *   - 死类零残留（W18）：全 CSS 面（STYLE_CSS 含 responsive）零 .nonacademic-price-row/.na-project-name/.na-range。
 *
 * G2 变异：删 .price-row-name 规则 → 契约断言红；还原任一 .na-* 死类 → 死类零残留断言红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STYLE_CSS } from './_css.js';

const teacherCss = readFileSync('./features/teacher.css', 'utf8');
const responsive = readFileSync('./responsive.css', 'utf8');

test('C4: .price-row 规则存在（非学科报价行布局）', () => {
  const rowRule = teacherCss.split('.price-row {')[1] || '';
  assert.ok(rowRule.split('}')[0].includes('display: flex'), '.price-row flex 行布局');
  const nameRule = teacherCss.split('.price-row-name {')[1] || '';
  assert.ok(nameRule.split('}')[0].includes('--ink-3'), '.price-row-name 消费 --ink-3');
  assert.ok(teacherCss.includes('.price-row .form-input'), '.price-row 内输入框撑满规则');
  assert.ok(responsive.includes('.price-row {'), 'responsive 含 .price-row 窄屏规则');
  assert.ok(responsive.includes('.price-row-name {'), 'responsive 含 .price-row-name 窄屏规则');
});

test('C4: .na-* 死规则零残留（W18 禁止两套并存）', () => {
  // 断言规则形态（带 {），teacher.css 注释里历史类名引用不误命中
  assert.ok(!STYLE_CSS.includes('.nonacademic-price-row {'), '全 CSS 面无 .nonacademic-price-row 规则');
  assert.ok(!STYLE_CSS.includes('.na-project-name {'), '全 CSS 面无 .na-project-name 规则');
  assert.ok(!STYLE_CSS.includes('.na-range {'), '全 CSS 面无 .na-range 规则');
  assert.ok(!responsive.includes('.nonacademic-price-row {'), 'responsive 无 .nonacademic-price-row 规则');
  assert.ok(!responsive.includes('.na-project-name {'), 'responsive 无 .na-project-name 规则');
});
