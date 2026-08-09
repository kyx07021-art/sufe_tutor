/**
 * v0.25.101 Q7 页头筛选/排序控件统一标准按钮样式 + 标准高度
 *
 * 用户：「筛选和排序两个紧挨着的下拉栏样式不一样」「包括排序按钮本身和筛选项下拉栏，都应该是
 * 标准按钮样式」「别处的下拉栏是什么样式我不管」「你的按钮控件没有标准高度吗？为啥筛选按钮
 * 比旁边的下拉栏矮一截？」
 *
 * 背景（实测证据）：页头排序下拉 40px（custom-select-trigger 输入控件族）、筛选按钮 31px
 * （drop-toggle glass--solid 按钮族）、标准按钮 .btn 42px——三种控件三种高度，紧挨着矮一截。
 *
 * 修复：
 *   1. 定义标准按钮高度 token --btn-h（40px，随 --ui-scale 缩放），全站页头/筛选动作控件统一引用；
 *   2. 页头排序下拉触发器 = 标准按钮玻璃参数（--g-btn-bg 白调面 + 发丝边 + 交互叠层 + .875rem/600）；
 *   3. 页头筛选按钮（drop-toggle）对齐同字面同高度；
 *   4. 筛选项下拉栏（filter-panel 内 filter-group 的选项下拉）同样标准按钮样式 + --btn-h。
 *   表单/其他面板内下拉保持输入控件族不变（用户「别处不管」）。
 *
 * 本测试覆盖：
 *   - --btn-h token 存在且 = 40px * ui-scale；
 *   - 页头排序触发器：标准按钮参数（--g-btn-bg、.875rem/600、height: var(--btn-h)）；
 *   - 页头筛选按钮：同字面、height: var(--btn-h)；
 *   - 筛选项下拉：标准按钮参数、height: var(--btn-h)；
 *   - 非页头 custom-select-trigger 基础规则保留（不误伤表单）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function blockOf(css, selector) {
  // 匹配「selector 独占一行 + 换行后 {」的多行规则块（支持 CRLF，避开单行内联规则如 .filter-group .custom-select-trigger { font-size })
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('(?:^|\\r?\\n)' + esc + ' \\{\\r?\\n');
  const m = css.match(re);
  if (!m) return '';
  const start = m.index + m[0].length;
  const end = css.indexOf('\n}', start);
  return end < 0 ? '' : css.slice(start, end);
}

test('Q7 标准按钮高度 token：--btn-h 定义且 = 40px * ui-scale', () => {
  const css = readFileSync('./style.css', 'utf8');
  assert.ok(css.includes('--btn-h: calc(40px * var(--ui-scale, 1))'),
    '--btn-h = 40px * ui-scale（标准按钮高度）');
});

test('Q7 页头排序触发器：标准按钮玻璃参数 + 标准高度（非输入控件族）', () => {
  const css = readFileSync('./style.css', 'utf8');
  const b = blockOf(css, '.page-header-actions .custom-select-trigger');
  assert.ok(b, '页头排序触发器规则存在');
  assert.ok(b.includes('--g-fill: var(--g-btn-bg'), '标准按钮白调面填充');
  assert.ok(b.includes('font-size: .875rem') && b.includes('font-weight: 600'), '标准按钮字面 .875rem/600');
  assert.ok(b.includes('height: var(--btn-h)'), '统一标准按钮高度（Q7：不再自定 min-height 导致高度不齐）');
  assert.ok(b.includes('justify-content: center'), '按钮式内容居中');
});

test('Q7 页头筛选按钮：同字面 + 标准高度（不再矮一截）', () => {
  const css = readFileSync('./style.css', 'utf8');
  const b = blockOf(css, '.page-header-actions .drop-toggle');
  assert.ok(b, '页头筛选按钮规则存在');
  assert.ok(b.includes('height: var(--btn-h)'), '筛选按钮也用标准按钮高度（Q7：不再比相邻下拉矮）');
  assert.ok(b.includes('font-size: .875rem') && b.includes('font-weight: 600'), '与排序触发器同字面');
});

test('Q7 筛选项下拉栏：标准按钮样式 + 标准高度', () => {
  const css = readFileSync('./style.css', 'utf8');
  const b = blockOf(css, '.filter-group .custom-select-trigger');
  assert.ok(b, '筛选项下拉规则存在');
  assert.ok(b.includes('--g-fill: var(--g-btn-bg'), '标准按钮填充');
  assert.ok(b.includes('height: var(--btn-h)'), '筛选项下拉统一标准按钮高度');
  assert.ok(b.includes('font-weight: 600'), '标准按钮字重');
});

test('Q7 非页头场景：表单/其他面板下拉保持输入控件族（不误伤）', () => {
  const css = readFileSync('./style.css', 'utf8');
  // 输入控件族基础规则仍在（custom-select-trigger 基础 padding/字号等）
  assert.ok(css.includes('.custom-select-trigger {') || css.includes('.form-group .custom-select'),
    '输入控件族基础规则保留');
  // 页头/筛选覆盖只限定各自容器
  assert.ok(css.includes('.page-header-actions .custom-select-trigger'), '排序覆盖限定页头');
  assert.ok(css.includes('.filter-group .custom-select-trigger'), '筛选项覆盖限定筛选面板');
  assert.ok(!css.includes('.form-group .custom-select-trigger {'), '表单内下拉无标准按钮覆盖（保持输入族）');
});

test('Q7 页头 HTML：教师信息/需求大厅排序+筛选按钮同页头动作容器', () => {
  const html = readFileSync('./index.html', 'utf8');
  assert.ok(html.includes('id="teacher-sort"') && html.includes('id="filter-toggle-btn"'),
    '教师信息页排序+筛选按钮同页');
  assert.ok(html.includes('id="demand-sort"') && html.includes('id="demand-filter-toggle-btn"'),
    '需求大厅排序+筛选按钮同页');
  assert.ok(html.includes('class="drop-toggle glass glass--solid" id="filter-toggle-btn"'),
    '教师信息页筛选按钮为 drop-toggle 类（统一入口）');
});
