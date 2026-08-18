/**
 * v0.25.101 Q7 + v0.31.5 P4 页头筛选/排序控件统一标准按钮样式
 *
 * Q7 用户：「筛选和排序两个紧挨着的下拉栏样式不一样」「包括排序按钮本身和筛选项下拉栏，都应该是
 * 标准按钮样式」「别处的下拉栏是什么样式我不管」「你的按钮控件没有标准高度吗？为啥筛选按钮
 * 比旁边的下拉栏矮一截？」
 *
 * v0.31.5 P4 用户返工：「所有本质上是按钮而非输入框的下拉栏组件都应该用按钮配置」「单纯统一高度到
 * 40px 是没法解决观感问题的」——Q7 曾只设 --g-fill/--g-frost 引擎变量不挂 .glass 类，引擎不消费，
 * 观感仍是输入框（白染 0.10 + 9px + 细边，非按钮的透明磨砂透镜+弯月环）。P4 改为：按钮语境
 * （筛选组/页头操作区）触发器在 JS 端挂 .btn .btn-soft .glass .glass--pressable，标准按钮玻璃面
 * 由按钮组件提供；CSS 只留布局适配（高度/定宽/字面/居中/圆角对齐）。
 *
 * 本测试覆盖：
 *   - --btn-h token 存在且 = 40px * ui-scale；
 *   - 页头排序触发器：按钮语境布局适配（--g-r 对齐按钮圆角、.875rem/600、height var(--btn-h)、居中），
 *     且不再设引擎变量（--g-fill 等已由 .btn 组件提供，防死变量复现）；
 *   - 页头筛选按钮：同字面、height var(--btn-h)；
 *   - 筛选项下拉：紧凑按钮字面、height var(--btn-h)；
 *   - app-ui.js 按钮语境触发器挂 .btn .btn-soft .glass .glass--pressable（组件级按钮配置）；
 *   - glass.css 输入控件族排除 .glass 触发器（引擎 surface 不被 0-1-0 直写盖掉）；
 *   - 非页头 custom-select-trigger 基础规则保留（不误伤表单）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STYLE_CSS } from './_css.js';

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

test('P4 标准按钮高度 token：--btn-h 定义且 = 40px * ui-scale', () => {
  const css = STYLE_CSS;
  assert.ok(css.includes('--btn-h: calc(40px * var(--ui-scale, 1))'),
    '--btn-h = 40px * ui-scale（标准按钮高度）');
});

test('P4 页头排序触发器：布局适配 + 圆角对齐按钮 + 不再设死引擎变量', () => {
  const css = STYLE_CSS;
  const b = blockOf(css, '.page-header-actions .custom-select-trigger');
  assert.ok(b, '页头排序触发器布局规则存在');
  // 按钮面（磨砂/填充/弯月环/交互叠层）由 .btn .btn-soft .glass 组件提供（app-ui.js 挂类）——
  // 布局规则若再设 --g-fill/--g-frost 即死变量复现（引擎变量必须配 .glass 消费）
  assert.ok(!b.includes('--g-fill') && !b.includes('--g-frost'), '不再设引擎变量（防 Q7 死变量复现）');
  assert.ok(b.includes('--g-r: var(--lg-r)'), '圆角对齐标准按钮（引擎默认 9px 须显式 12px）');
  assert.ok(b.includes('font-size: .875rem') && b.includes('font-weight: 600'), '标准按钮字面 .875rem/600');
  assert.ok(b.includes('height: var(--btn-h)'), '统一标准按钮高度');
  assert.ok(b.includes('justify-content: center'), '按钮式内容居中');
});

test('P4 页头筛选按钮：接 .btn 组件 + 布局适配（同字面 + 标准高度 + 12px 圆角对齐）', () => {
  const css = STYLE_CSS;
  const b = blockOf(css, '.page-header-actions .filter-toggle');
  assert.ok(b, '页头筛选按钮布局规则存在（.filter-toggle）');
  assert.ok(b.includes('height: var(--btn-h)'), '筛选按钮也用标准按钮高度');
  assert.ok(b.includes('font-size: .875rem') && b.includes('font-weight: 600'), '与排序触发器同字面');
  assert.ok(b.includes('--g-r: var(--lg-r)'), '圆角对齐排序下拉（12px，非旧 9px）');
});

test('P4 筛选项下拉：紧凑按钮字面 + 标准高度', () => {
  const css = STYLE_CSS;
  const b = blockOf(css, '.filter-group .custom-select-trigger');
  assert.ok(b, '筛选项下拉布局规则存在');
  assert.ok(!b.includes('--g-fill') && !b.includes('--g-frost'), '不再设引擎变量（按钮面由组件提供）');
  assert.ok(b.includes('height: var(--btn-h)'), '筛选项下拉统一标准按钮高度');
  assert.ok(b.includes('font-weight: 600'), '标准按钮字重');
  assert.ok(b.includes('font-size: .8rem'), '紧凑按钮字面（面板内小空间）');
});

test('P4 按钮语境触发器 JS 挂标准按钮组件类（组件级按钮配置）', () => {
  const js = readFileSync('./app-ui.js', 'utf8');
  assert.ok(/sel\.closest\('\.filter-group'\) \|\| sel\.closest\('\.page-header-actions'\)/.test(js),
    '按钮语境判定：筛选组/页头操作区');
  assert.ok(js.includes("'custom-select-trigger btn btn-soft glass glass--pressable'"),
    '按钮语境触发器挂 .btn .btn-soft .glass .glass--pressable（复用按钮组件）');
  assert.ok(js.includes(": 'custom-select-trigger'"), '其余语境保持输入控件族');
});

test('P4 输入控件族排除 .glass 触发器：引擎 surface 不被 0-1-0 直写盖掉', () => {
  const css = readFileSync('./glass.css', 'utf8');
  assert.ok(css.includes('.form-input, .custom-select-trigger:not(.glass), .filter-select'),
    '输入控件族表面规则排除 .glass 触发器（引擎背景/圆角/shadow 生效）');
  assert.ok(css.includes('.custom-select-trigger:not(.glass), .filter-select { padding-left'),
    '水平内边距规则同样排除 .glass 触发器（按钮 padding 由 .btn/布局规则提供）');
});

test('P4 非页头场景：表单/其他面板下拉保持输入控件族（不误伤）', () => {
  const css = STYLE_CSS;
  assert.ok(css.includes('.custom-select-trigger {') || css.includes('.form-group .custom-select'),
    '输入控件族基础规则保留');
  assert.ok(css.includes('.page-header-actions .custom-select-trigger'), '排序覆盖限定页头');
  assert.ok(css.includes('.filter-group .custom-select-trigger'), '筛选项覆盖限定筛选面板');
  assert.ok(!css.includes('.form-group .custom-select-trigger {'), '表单内下拉无按钮布局覆盖（保持输入族）');
});

test('P4 页头 HTML：教师信息/需求大厅排序+筛选按钮同页头动作容器', () => {
  const html = readFileSync('./index.html', 'utf8');
  assert.ok(html.includes('id="teacher-sort"') && html.includes('id="filter-toggle-btn"'),
    '教师信息页排序+筛选按钮同页');
  assert.ok(html.includes('id="demand-sort"') && html.includes('id="demand-filter-toggle-btn"'),
    '需求大厅排序+筛选按钮同页');
  assert.ok(html.includes('class="btn btn-soft glass glass--pressable filter-toggle" id="filter-toggle-btn"'),
    '教师信息页筛选按钮接 .btn .btn-soft 按钮组件（v0.31.5 P4 补，与排序下拉同族）');
});
