/**
 * v0.27.6 UI 滑块拖动期元素级模拟重排（B4：直接 import core/ui-scale-reflow ESM）。
 *
 * v2 形态：src/client/core/ui-scale-reflow.js 导出 uiScaleReflow 对象
 * （prepare/begin/renderAt/teardown/_samples/_units），行为与 v1 全局 __uiScaleReflow 一致。
 *
 * 机制：拖动期把真实重排的"目标位"采样成离散档位（UI_SCALE_REFLOW_SAMPLE_STEP，v0.31.4 P4 定为 20
 * → [80,100,120]），用 per-element transform（translate+scale）把每个布局单元移动到真实重排后的
 * 位置——合成器只读，零 reflow 零 repaint；真实页面 --ui-scale 拖动期不动，松手 commit 才一次真重排。
 *
 * 本测试用 stub getBoundingClientRect 模拟真实重排目标（侧栏随缩放扩张 → 内容列右缘钉视口、
 * 左缘被顶右收窄的非均匀目标位），验证：
 *   1. prepare：采样档位 = [80,100,120]（CONFIG 单源 UI_SCALE_REFLOW_SAMPLE_STEP=20）；采样后 --ui-scale 还原；
 *   2. renderAt(100)：全恒等 → 样式表无 translate 规则（拖动起点零冗余）；
 *   3. renderAt(120)：非均匀收窄正确——顶栏钉宽 sy=1.2、侧栏 scale(1.2) 顶角锚定、内容列
 *      translate(48,12.8) scale(0.9538,1.2)（sx<1 = 真实收窄）、侧栏项 isText 等比 × 父链补偿收敛恒等；
 *   4. teardown：样式元素整节点移除 + data-ui-reflow-unit 属性全撤（成对零残留）；
 *   5. 页面切换后 prepare 重采：新可见页单元收录、旧页单元移除。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { CONFIG } from '../src/shared/config.js';
import { uiScaleReflow } from '../src/client/core/ui-scale-reflow.js';
import { STYLE_CSS } from './_css.js';

const SRC = readFileSync('./src/client/core/ui-scale-reflow.js', 'utf8');

// 真实重排模型（stub）：sf = 当前 --ui-scale。侧栏 240·sf 扩张、内容列右缘钉 1280 左缘被顶右收窄。
// 与真实 .client-sidebar max(144*S,13.3vw*S) 增长、内容列变窄的机制同构（测试用确定性简化模型）。
// v0.31.4：itA/itB 高度固定 44（文本行高不随字号比例——制造 sx≠sy 场景）；noteText 独立文本
//（宽随 sf、高固定 20，在 client-main 内）；divider 分隔线（宽随 sf、高固定 1px）。
function reflowModel(sf) {
  return {
    nav: { x: 0, y: 0, width: 1280, height: 64 * sf },
    side: { x: 0, y: 64 * sf, width: 240 * sf, height: 736 * sf },
    itA: { x: 12 * sf, y: 72 * sf, width: 216 * sf, height: 44 },
    itB: { x: 12 * sf, y: 124 * sf, width: 216 * sf, height: 44 },
    main: { x: 240 * sf, y: 64 * sf, width: 1280 - 240 * sf, height: 736 * sf },
    pg1: { x: 240 * sf, y: 64 * sf, width: 1280 - 240 * sf, height: 736 * sf },
    c1: { x: 240 * sf + 16 * sf, y: 64 * sf + 16 * sf, width: 1280 - 240 * sf - 32 * sf, height: 180 * sf },
    c2: { x: 240 * sf + 16 * sf, y: 64 * sf + 196 * sf, width: 1280 - 240 * sf - 32 * sf, height: 180 * sf },
    noteText: { x: 260 * sf, y: 100, width: 200 * sf, height: 20 },  // 独立文本：宽随 sf、高固定（reflow 中文字不扁，预览应等比）
    divider: { x: 280 * sf, y: 300, width: 600 * sf, height: 1 },   // 分隔线：宽随 sf、高恒 1px
    dot: { x: 200 * sf, y: 80 * sf, width: 8, height: 8 },           // 红点（sidebar-dot）：尺寸固定 8px（不随 sf）
    btn: { x: 16 * sf, y: 220 * sf, width: 90, height: 40 },         // 定宽按钮（filter-toggle 场景）：宽高固定不随 sf
  };
}

const DOM = `
  <div class="navbar" id="nav"></div>
  <div class="client-sidebar" id="side"><div class="sidebar-scroll"><nav class="sidebar-nav">
    <div class="sidebar-item" id="itA">A<div class="sidebar-dot" id="dot"></div></div><div class="sidebar-item" id="itB">B</div>
  </nav></div></div>
  <div class="client-main" id="main">
    <div class="note" id="noteText">独立说明文字</div>
    <div class="form-divider" id="divider"></div>
    <button class="btn" id="btn">筛选</button>
    <div class="client-page" id="pg1"><div class="list-card" id="c1"></div><div class="list-card" id="c2"></div></div>
    <div class="client-page hidden" id="pg2"><div class="list-card" id="c3"></div></div>
  </div>
`;

function setup() {
  const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body>${DOM}</body></html>`, {
    url: 'http://localhost/', pretendToBeVisual: true,
  });
  const w = dom.window;
  // stub：读取当前 --ui-scale 返回真实重排模型 rect（采样期间随档位变化，base 测量时 sf=1）
  w.Element.prototype.getBoundingClientRect = function () {
    const raw = w.document.documentElement.style.getPropertyValue('--ui-scale');
    const sf = parseFloat(raw) || 1;
    const r = reflowModel(sf)[this.id] || { x: 0, y: 0, width: 10, height: 10 };
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  };
  w.scrollTo = () => {};
  globalThis.window = w;
  globalThis.document = w.document;
  globalThis.getComputedStyle = w.getComputedStyle.bind(w);
  return dom;
}
function teardown() {
  uiScaleReflow.teardown(); // 模块级 styleEl/units 清干净（直接 import 共享模块，必须成对复位）
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.getComputedStyle;
}

// 从样式表解析某元素（按其 data-ui-reflow-unit 索引）的 transform 规则
function readTransform(id) {
  const el = document.getElementById(id);
  const idx = el.getAttribute('data-ui-reflow-unit');
  if (idx === null) return null;
  const css = document.getElementById('__ui-reflow-transforms').textContent;
  const m = css.match(new RegExp(`\\[data-ui-reflow-unit="${idx}"\\]\\{([^}]*)\\}`));
  if (!m) return { tx: 0, ty: 0, sx: 1, sy: 1, rule: '' };
  const t = m[1].match(/translate\(([-\d.]+)px,([-\d.]+)px\)/);
  const s = m[1].match(/scale\(([-\d.]+),([-\d.]+)\)/);
  return { tx: t ? +t[1] : 0, ty: t ? +t[2] : 0, sx: s ? +s[1] : 1, sy: s ? +s[2] : 1, rule: m[1] };
}

const hasTranslate = () => document.getElementById('__ui-reflow-transforms').textContent.includes('translate(');
const reflowText = () => document.querySelectorAll('.ui-reflow-text').length;

test('CONFIG 单源：UI_SCALE_REFLOW_SAMPLE_STEP=20 在 shared/config.js（UI_SCALE_MIN..MAX 整除步进）', () => {
  assert.equal(CONFIG.UI_SCALE_REFLOW_SAMPLE_STEP, 20, 'shared/config.js 定义 UI_SCALE_REFLOW_SAMPLE_STEP: 20（v0.31.4 P4 采样成本 9 档→3 档）');
});

test('prepare：采样档位 [80,100,120]；采样后 --ui-scale 还原（无闪屏中间态残留）', () => {
  setup();
  uiScaleReflow.prepare();
  assert.deepEqual(Array.from(uiScaleReflow._samples()), [80, 100, 120], 'UI_SCALE_MIN..MAX 每 20% 一档（3 档）');
  assert.equal(document.documentElement.style.getPropertyValue('--ui-scale'), '',
    '采样后 --ui-scale 还原空（不残留中间档位）');
  teardown();
});

test('renderAt(100)：全恒等 → 样式表无 translate 规则（拖动起点零冗余）', () => {
  setup();
  uiScaleReflow.prepare(); uiScaleReflow.begin(); uiScaleReflow.renderAt(100);
  assert.equal(hasTranslate(), false, 'scale=100 无任何 translate 规则');
  assert.notEqual(document.querySelector('.client-main').getAttribute('data-ui-reflow-unit'), null,
    'data-ui-reflow-unit 属性已挂（base 规则生效）');
  teardown();
});

test('v0.31.5 P1：renderAt 样式表含过渡禁用规则（引擎 transform 过渡致预览滞后/偏小的根因修复）', () => {
  setup();
  uiScaleReflow.prepare(); uiScaleReflow.begin(); uiScaleReflow.renderAt(120);
  const css = document.getElementById('__ui-reflow-transforms').textContent;
  assert.ok(css.includes('html[data-ui-reflowing] [data-ui-reflow-unit]{transition:none !important}'),
    '预览期禁用引擎 transform 过渡（.glass transition .18s 会让 transform 从恒等动画起点——拖动中预览滞后偏小）');
  assert.ok(css.includes('[data-ui-reflow-unit]{transform-origin:0 0}'), 'transform-origin 规则保留');
  teardown();
});

test('renderAt(120)：非均匀真实重排（顶栏钉宽/侧栏扩张/内容列收窄 sx<1）', () => {
  setup();
  uiScaleReflow.prepare(); uiScaleReflow.begin(); uiScaleReflow.renderAt(120);

  const nav = readTransform('nav');
  assert.ok(nav.rule, '顶栏有规则（高度缩放 sy=1.2）');
  assert.ok(Math.abs(nav.sy - 1.2) < 0.02 && Math.abs(nav.sx - 1) < 0.02, `顶栏 sy≈1.2 宽钉 1280 (sx≈1)，实得 sx=${nav.sx} sy=${nav.sy}`);

  const side = readTransform('side');
  assert.ok(Math.abs(side.sx - 1.2) < 0.02 && Math.abs(side.sy - 1.2) < 0.02, `侧栏整体 scale≈1.2（扩张），实得 ${side.sx},${side.sy}`);
  assert.ok(Math.abs(side.tx) < 0.5, `侧栏 x 顶角锚定 tx≈0，实得 ${side.tx}`);
  assert.ok(Math.abs(side.ty - 12.8) < 0.5, `侧栏随顶栏变高整体下移 ty≈12.8（真实重排），实得 ${side.ty}`);

  const main = readTransform('main');
  assert.ok(Math.abs(main.tx - 48) < 0.5, `内容列被顶右 tx≈48，实得 ${main.tx}`);
  assert.ok(main.sx < 1 && Math.abs(main.sx - (992 / 1040)) < 0.01,
    `内容列真实收窄 sx≈0.954 (<1)，区别于均匀预览 scale(1.2) 变宽；实得 ${main.sx}`);
  teardown();
});

// 祖先缩放补偿：itA 是 isText 单元（.sidebar-item 含直接文本、无 border、非 CONTROL）——fs 等比
// 1.2 与父链 side 缩放 1.2 相抵 → 视觉恒等 → 无自身 transform 规则（杜绝双重缩放）。
test('祖先缩放补偿：侧栏项随父缩放收敛恒等（无自身 transform 规则，无双重 1.44×）', () => {
  setup();
  uiScaleReflow.prepare(); uiScaleReflow.begin(); uiScaleReflow.renderAt(120);
  const itA = readTransform('itA');
  assert.equal(itA.rule, '', `侧栏项被父链缩放完全补偿 → 无自身 transform 规则（无双重缩放），实得规则「${itA.rule}」`);
  teardown();
});

// v0.31.4（P1/P5）断线回归：SHELL_SELECTORS 曾写 '.sidebar'（真实 DOM 是 .client-sidebar）——
// 整条侧栏（含左下用户卡）未遍历零单元。改对类名后 .client-sidebar 成单元，侧栏宽随 scale 采样
// 扩张（P5 分界移动同源）。
test('P1/P5：.client-sidebar 是 shell 单元（侧栏宽随 scale 扩张、分界移动）', () => {
  setup();
  uiScaleReflow.prepare();
  const units = uiScaleReflow._units();
  assert.ok(units.some(u => u.el.id === 'side'), '.client-sidebar 被收集为单元（曾 .sidebar 查不到整栏零单元）');
  uiScaleReflow.begin(); uiScaleReflow.renderAt(120);
  const side = readTransform('side');
  assert.ok(Math.abs(side.sx - 1.2) < 0.02, `侧栏宽随 scale 扩张 sx≈1.2（分界随之移动），实得 ${side.sx}`);
  teardown();
});

// v0.31.4（P2）文本元素统一等比：文本单元视觉缩放 = 字号比例（1.2），不随父块 rect 拉伸变扁；
// 块单元照旧 rect 拉伸（允许 sx≠sy）。
test('P2：文本单元统一等比（视觉 sx=sy=字号比例，不受父拉伸影响）；块单元照旧 rect 拉伸', () => {
  setup();
  uiScaleReflow.prepare(); uiScaleReflow.begin(); uiScaleReflow.renderAt(120);
  const main = readTransform('main');
  const note = readTransform('noteText');
  assert.ok(note.rule, '文本单元有 transform 规则');
  // 视觉缩放 = 局部 × 祖先：noteText 应等比 1.2（父 main sx≈0.954/sy≈1.2 不影响文字形状）
  assert.ok(Math.abs(note.sx * main.sx - 1.2) < 0.02 && Math.abs(note.sy * main.sy - 1.2) < 0.02,
    `文本单元视觉等比 1.2（sx*ancSx=${(note.sx * main.sx).toFixed(3)} sy*ancSy=${(note.sy * main.sy).toFixed(3)}）——曾 sx≠sy 文字变扁`);
  // 块单元（卡片）保持 rect 拉伸：视觉 sx≠sy（真实 reflow 中块变窄变高，允许）；卡片在 pg1 下，
  // 祖先链 = c1→pg1→main（pg1 收敛恒等 ≈1，链尾视觉 = c1×pg1×main）
  const c1 = readTransform('c1');
  const pg1 = readTransform('pg1');
  assert.ok(c1.rule, '卡片有规则');
  const visSx = c1.sx * pg1.sx * main.sx;
  const visSy = c1.sy * pg1.sy * main.sy;
  assert.ok(Math.abs(visSx - visSy) > 0.05,
    `块单元保持非等比 rect 拉伸（真实收窄 sx<sy），实得 视觉sx=${visSx.toFixed(3)} 视觉sy=${visSy.toFixed(3)}`);
  teardown();
});

// v0.31.4（P3）分隔线单元：参与预览（只位移 + 宽随布局），视觉高度恒 1px（不随字号/祖先放大）。
test('P3：分隔线单元——宽随布局、视觉高度恒 1px（不放大不压按钮）', () => {
  setup();
  uiScaleReflow.prepare(); uiScaleReflow.begin(); uiScaleReflow.renderAt(120);
  const div = readTransform('divider');
  assert.ok(div.rule, '分隔线收集为单元并有规则（曾 h<8 被过滤、原地不动与按钮错位）');
  const main = readTransform('main');
  assert.ok(Math.abs(div.sy * main.sy - 1) < 0.02,
    `分隔线视觉高度恒 1px（sy*ancSy≈1），实得 ${(div.sy * main.sy).toFixed(3)}`);
  assert.ok(Math.abs(div.sx * main.sx - 1.2) < 0.02,
    `分隔线宽度随布局（sx*ancSx≈1.2），实得 ${(div.sx * main.sx).toFixed(3)}`);
  teardown();
});

test('teardown：样式元素整节点移除 + data-ui-reflow-unit 属性全撤（成对零残留）', () => {
  setup();
  uiScaleReflow.prepare(); uiScaleReflow.begin(); uiScaleReflow.renderAt(120);
  assert.ok(hasTranslate(), '渲染期有 transform');
  assert.ok(document.getElementById('__ui-reflow-transforms'), '渲染期样式元素在 DOM');
  uiScaleReflow.teardown();
  assert.equal(document.getElementById('__ui-reflow-transforms'), null,
    '样式元素整节点移除（非仅清空——悬空引用即残留，v2 teardown 契约收紧）');
  assert.equal(document.querySelectorAll('[data-ui-reflow-unit]').length, 0, 'data-ui-reflow-unit 全撤');
  teardown();
});

test('页面切换后 prepare 重采：新可见页单元收录、旧页单元移除', () => {
  setup();
  uiScaleReflow.prepare();
  const before = uiScaleReflow._units();
  assert.ok(before.some(u => u.el.id === 'c1'), '切换前含旧页卡片 c1');
  assert.ok(!before.some(u => u.el.id === 'c3'), '切换前不含隐藏页卡片 c3');
  // 切页：pg1 隐藏、pg2 显示
  document.getElementById('pg1').classList.add('hidden');
  document.getElementById('pg2').classList.remove('hidden');
  uiScaleReflow.prepare();
  const after = uiScaleReflow._units();
  assert.ok(after.some(u => u.el.id === 'c3'), '切换后收录新可见页卡片 c3');
  assert.ok(!after.some(u => u.el.id === 'c1'), '切换后移除旧页卡片 c1');
  teardown();
});

test('陈旧守卫：预热采样后元素被重渲染摘除（isConnected=false）→ prepare 重建，死元素单元剔除', () => {
  setup();
  uiScaleReflow.prepare();
  const before = uiScaleReflow._units();
  assert.ok(before.some(u => u.el.id === 'c1'), '预热后含 c1 单元');
  // 模拟异步重渲染摘除 c1（innerHTML 替换把采样元素摘离 DOM）
  document.getElementById('c1').remove();
  const ready = uiScaleReflow.prepare();
  assert.equal(ready, true, '陈旧检测到脱树后重建成功返回就绪');
  const after = uiScaleReflow._units();
  assert.ok(!after.some(u => u.el.id === 'c1'), '重建后死元素 c1 单元剔除');
  assert.ok(after.some(u => u.el.id === 'c2'), '重建后仍收录存活元素 c2');
  // 重建后采样可用（目标位有值）
  uiScaleReflow.begin(); uiScaleReflow.renderAt(120);
  assert.ok(document.querySelectorAll('[data-ui-reflow-unit]').length > 0, '重建后 renderAt 生效挂属性');
  teardown();
});

// v0.31.7（R4-2/R4-6）固定尺寸装饰单元：红点/滑块 thumb 视觉恒定像素——isFixed 分支 sx=sy=1/_ancS，
// 抵消祖先非等比缩放（用户实证红点 8.4×7 椭圆、滑块 thumb 非等比）。视觉缩放 = 自身×祖先链 ≈ 1。
test('R4-2/R4-6：红点固定尺寸单元——视觉恒 8px（抵消祖先缩放，不椭圆）', () => {
  setup();
  uiScaleReflow.prepare(); uiScaleReflow.begin(); uiScaleReflow.renderAt(120);
  const dot = readTransform('dot');
  const itA = readTransform('itA');
  const side = readTransform('side');
  assert.ok(dot.rule, '红点收集为单元（isFixedDeco 放宽 h<8 阈值）');
  // 视觉缩放 = dot.sx × itA.sx × side.sx（祖先链）——isFixed 只位移不缩放 → ≈1（8px 恒定）
  const visual = dot.sx * itA.sx * side.sx;
  assert.ok(Math.abs(visual - 1) < 0.02,
    `红点视觉缩放≈1（8px 恒定），实得 ${visual.toFixed(3)}——曾随父链 sx≈1.2 放大成椭圆`);
  teardown();
});

// v0.31.7（R4-4）按钮类排除文本等比 → 走 block rect 拉伸：定宽按钮（filter-toggle 场景）采样 target 宽
// 恒 90 → 预览视觉宽 90 不超缩（fs 等比会预测 90×1.2=108）。按钮直接含文本但 CONTROL_RE 排除 isText。
test('R4-4：定宽按钮 block rect 拉伸——预览视觉宽 90 不超缩（fs 等比会错误放大到 108）', () => {
  setup();
  uiScaleReflow.prepare(); uiScaleReflow.begin(); uiScaleReflow.renderAt(120);
  const btn = readTransform('btn');
  const main = readTransform('main');
  assert.ok(btn.rule, '按钮收集为单元（LAYOUT_RE 补 btn 词）');
  // 视觉宽缩放 = btn.sx × main.sx（祖先链）——block 分支 = target.w/base.w = 90/90 = 1
  const visual = btn.sx * main.sx;
  assert.ok(Math.abs(visual - 1) < 0.02,
    `定宽按钮视觉宽缩放≈1（90px 不超缩），实得 ${visual.toFixed(3)}——若走 isText fs 等比会得 1.2（108px 超缩）`);
  const visualH = btn.sy * main.sy;
  assert.ok(Math.abs(visualH - 1) < 0.02, `定宽按钮视觉高缩放≈1（40px 恒定），实得 ${visualH.toFixed(3)}`);
  teardown();
});

// v0.31.7（R4-7）采样禁全站 transition：sampleTargets 期间挂 html[data-ui-sampling]，style.css 有
// `transition:none !important` 规则（.sidebar-item 等 padding var(--t-slow) 过渡让采样读到动画起点旧高度）。
test('R4-7：采样禁全站 transition（data-ui-sampling 门控 + style.css 规则）', () => {
  assert.match(SRC, /docEl\.dataset\.uiSampling = "1"/, 'sampleTargets 挂 data-ui-sampling 门控');
  assert.match(SRC, /delete docEl\.dataset\.uiSampling/, '采样后移除门控（成对零残留）');
  const css = STYLE_CSS;
  assert.match(css, /html\[data-ui-sampling\] \*[\s\S]*?transition: none !important/, 'style.css 禁全站 transition 规则');
});

// v0.31.8 用户验收抓出（横线戳出 184px）：带横线（border）的块不算纯文本容器——isText fs 等比会放大
// 宽度（大标题视觉宽 920→1104，border-bottom 横线戳出右缘；真实 reflow 容器定宽标题宽不变）。
test('v0.31.8 isText 排除 border 块（横线承载元素统一 block rect 拉伸）', () => {
  assert.match(SRC, /cs\[s\] && cs\[s\] !== "none" && parseFloat\(cs\[w\] \|\| "0"\) > 0/,
    'isTextUnit 排除带横线（border）的块（style 非 none + width>0，兼容 jsdom 默认 border-width）');
});

// v0.31.10（T1-T4）标题字非等比治本：block 单元直接含文本 → 预览期包 .ui-reflow-text span
//   （容器 block 定宽 + span isText 等比 × 祖先补偿）。修复 fix4「isText 排除 border 块」把标题退回
//   block 拉伸 sx=1/sy≈1.142 导致文字拉扁（用户「治标不治本，重做」定案）。
test('T1：block 文本容器包 span——容器 block 拉伸 + span 视觉等比（标题/按钮文字不变形）', () => {
  setup();
  uiScaleReflow.prepare(); uiScaleReflow.begin(); uiScaleReflow.renderAt(120);
  assert.ok(reflowText() >= 1, `block 文本容器已包 span（btn「筛选」等），实得 ${reflowText()}`);
  // 容器仍 block：定宽按钮视觉宽≈1（btn.sx×main.sx，R4-4 语义保留）
  const btn = readTransform('btn');
  const main = readTransform('main');
  assert.ok(Math.abs(btn.sx * main.sx - 1) < 0.02, `容器仍 block 拉伸（定宽按钮视觉宽≈1），实得 ${(btn.sx * main.sx).toFixed(3)}`);
  // span 是 isText 单元：fs 等比 × 祖先补偿 → 文字等比 1.2（曾随容器 block 拉伸 sx=1/sy≈1.142 拉扁）
  const sp = document.querySelector('.ui-reflow-text');
  const u = uiScaleReflow._units().find(x => x.el === sp);
  assert.ok(u && Math.abs(u.sx - 1.2) < 0.02 && Math.abs(u.sy - 1.2) < 0.02,
    `span 文字等比 1.2（sx=${u ? u.sx.toFixed(3) : '无单元'} sy=${u ? u.sy.toFixed(3) : ''}）——曾容器 block 拉伸 sx=1/sy≈1.142 文字拉扁`);
  teardown();
});
test('T2：teardown 还原文本包裹（span 移除、文本回容器原位，零残留）', () => {
  setup();
  uiScaleReflow.prepare(); uiScaleReflow.begin(); uiScaleReflow.renderAt(120);
  assert.ok(reflowText() >= 1, '预览期有包裹 span');
  assert.equal(document.getElementById('btn').textContent, '筛选', '包裹后按钮文本内容不变');
  uiScaleReflow.teardown();
  assert.equal(reflowText(), 0, 'teardown 后 span 全还原');
  assert.equal(document.getElementById('btn').textContent, '筛选', '文本回容器原位（无残留包裹）');
  teardown();
});

test('T1 幂等：陈旧重建后不重复包裹、不丢文本', () => {
  setup();
  uiScaleReflow.prepare();
  const n1 = reflowText();
  const t1 = document.getElementById('btn').textContent;
  document.getElementById('c1').remove(); // 触发陈旧重建
  uiScaleReflow.prepare();
  const n2 = reflowText();
  const t2 = document.getElementById('btn').textContent;
  assert.equal(n1, n2, `重复 prepare 包裹数不变（${n1}→${n2}）`);
  assert.equal(t1, t2, '文本内容不受重建影响');
  teardown();
});

// T6 回归防线：fix4「isText 排除 border 块」判定保留（横线不戳回归）
test('T6：isText 排除 border 块判定保留（横线不戳回归，fix4 语义未回退）', () => {
  assert.match(SRC, /cs\[s\] && cs\[s\] !== "none" && parseFloat\(cs\[w\] \|\| "0"\) > 0/,
    'isTextUnit 仍排除带横线（border）的块');
});
