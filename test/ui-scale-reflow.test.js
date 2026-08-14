/**
 * v0.27.6 UI 滑块拖动期元素级模拟重排（ui-scale-reflow.js）
 *
 * 机制：拖动期把真实重排的"目标位"采样成离散档位（UI_SCALE_REFLOW_SAMPLE_STEP，v0.31.4 P4 定为 20 → [80,100,120]），
 * 用 per-element transform（translate+scale）把每个布局单元移动到真实重排后的位置——合成器只读，
 * 零 reflow 零 repaint；真实页面 --ui-scale 拖动期不动，松手 commit 才一次真重排。
 *
 * 本测试用 stub getBoundingClientRect 模拟真实重排目标（侧栏随缩放扩张 → 内容列右缘钉视口、
 * 左缘被顶右收窄的非均匀目标位），验证：
 *   1. prepare：采样档位 = [80,100,120]（CONFIG 单源 UI_SCALE_REFLOW_SAMPLE_STEP=20）；采样后 --ui-scale 还原，无闪屏中间态残留；
 *   2. renderAt(100)：全恒等 → 样式表无 translate 规则（拖动起点不重复写 transform）；
 *   3. renderAt(120)：非均匀收窄正确——
 *      顶栏 高度缩放 sy=1.2 宽度钉 1280（sx≈1）；
 *      侧栏 整体 scale(1.2,1.2) translate(0,0)（顶角锚定扩张）；
 *      内容列 translate(48,12.8) scale(0.9538,1.2)（sx<1 = 真实收窄，区别于四块均匀预览 scale(1.2) 变宽）；
 *      侧栏项 收敛到恒等 transform（父链缩放补偿，杜绝双重 1.44× 缩放）→ 样式表无其规则；
 *   4. teardown：样式表清空 + data-ui-reflow-unit 属性全撤（成对零残留）；
 *   5. 页面切换后 prepare 重采：新可见页单元收录、旧页单元移除。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const MODULE = readFileSync('./ui-scale-reflow.js', 'utf8');
const CONSTANTS = readFileSync('./constants.js', 'utf8');

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

function makeCtx() {
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
  w.APP_CONSTANTS = { CONFIG: { UI_SCALE_MIN: 80, UI_SCALE_MAX: 120, UI_SCALE_REFLOW_SAMPLE_STEP: 20 } };
  const ctx = vm.createContext({
    window: w, document: w.document, getComputedStyle: w.getComputedStyle.bind(w),
    console, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout,
  });
  vm.runInContext(MODULE, ctx, { filename: 'ui-scale-reflow.js' });
  return { dom, ctx };
}

// 从样式表解析某元素（按其 data-ui-reflow-unit 索引）的 transform 规则
function readTransform(ctx, id) {
  const out = vm.runInContext(`(() => {
    const el = document.getElementById('${id}');
    const idx = el.getAttribute('data-ui-reflow-unit');
    if (idx === null) return null;
    const css = document.getElementById('__ui-reflow-transforms').textContent;
    const m = css.match(new RegExp('\\\\[data-ui-reflow-unit=\\\\"' + idx + '\\\\"\\\\]\\\\{([^}]*)\\\\}'));
    if (!m) return { tx: 0, ty: 0, sx: 1, sy: 1, rule: '' };
    const t = m[1].match(/translate\\(([-\\d.]+)px,([-\\d.]+)px\\)/);
    const s = m[1].match(/scale\\(([-\\d.]+),([-\\d.]+)\\)/);
    return { tx: t ? +t[1] : 0, ty: t ? +t[2] : 0, sx: s ? +s[1] : 1, sy: s ? +s[2] : 1, rule: m[1] };
  })()`, ctx);
  return out;
}

const hasTranslate = (ctx) => vm.runInContext(
  `document.getElementById('__ui-reflow-transforms').textContent.includes('translate(')`, ctx);

test('CONFIG 单源：UI_SCALE_REFLOW_SAMPLE_STEP=20 在 constants.js（UI_SCALE_MIN..MAX 整除步进）', () => {
  assert.match(CONSTANTS, /UI_SCALE_REFLOW_SAMPLE_STEP:\s*20/, 'constants.js 定义 UI_SCALE_REFLOW_SAMPLE_STEP: 20（v0.31.4 P4 采样成本 9 档→3 档）');
});

test('prepare：采样档位 [80,100,120]；采样后 --ui-scale 还原（无闪屏中间态残留）', () => {
  const { ctx } = makeCtx();
  vm.runInContext(`window.__uiScaleReflow.prepare()`, ctx);
  const samples = vm.runInContext(`window.__uiScaleReflow._samples()`, ctx);
  assert.deepEqual(Array.from(samples), [80, 100, 120], 'UI_SCALE_MIN..MAX 每 20% 一档（3 档）');
  assert.equal(vm.runInContext(`document.documentElement.style.getPropertyValue('--ui-scale')`, ctx), '',
    '采样后 --ui-scale 还原空（不残留中间档位）');
});

test('renderAt(100)：全恒等 → 样式表无 translate 规则（拖动起点零冗余）', () => {
  const { ctx } = makeCtx();
  vm.runInContext(`window.__uiScaleReflow.prepare(); window.__uiScaleReflow.begin(); window.__uiScaleReflow.renderAt(100)`, ctx);
  assert.equal(hasTranslate(ctx), false, 'scale=100 无任何 translate 规则');
  assert.notEqual(vm.runInContext(`document.querySelector('.client-main').getAttribute('data-ui-reflow-unit')`, ctx), null,
    'data-ui-reflow-unit 属性已挂（base 规则生效）');
});

test('v0.31.5 P1：renderAt 样式表含过渡禁用规则（引擎 transform 过渡致预览滞后/偏小的根因修复）', () => {
  const { ctx } = makeCtx();
  vm.runInContext(`window.__uiScaleReflow.prepare(); window.__uiScaleReflow.begin(); window.__uiScaleReflow.renderAt(120)`, ctx);
  const css = vm.runInContext(`document.getElementById('__ui-reflow-transforms').textContent`, ctx);
  assert.ok(css.includes('html[data-ui-reflowing] [data-ui-reflow-unit]{transition:none !important}'),
    '预览期禁用引擎 transform 过渡（.glass transition .18s 会让 transform 从恒等动画起点——拖动中预览滞后偏小）');
  assert.ok(css.includes('[data-ui-reflow-unit]{transform-origin:0 0}'), 'transform-origin 规则保留');
});

test('renderAt(120)：非均匀真实重排（顶栏钉宽/侧栏扩张/内容列收窄 sx<1）', () => {
  const { ctx } = makeCtx();
  vm.runInContext(`window.__uiScaleReflow.prepare(); window.__uiScaleReflow.begin(); window.__uiScaleReflow.renderAt(120)`, ctx);

  const nav = readTransform(ctx, 'nav');
  assert.ok(nav.rule, '顶栏有规则（高度缩放 sy=1.2）');
  assert.ok(Math.abs(nav.sy - 1.2) < 0.02 && Math.abs(nav.sx - 1) < 0.02, `顶栏 sy≈1.2 宽钉 1280 (sx≈1)，实得 sx=${nav.sx} sy=${nav.sy}`);

  const side = readTransform(ctx, 'side');
  assert.ok(Math.abs(side.sx - 1.2) < 0.02 && Math.abs(side.sy - 1.2) < 0.02, `侧栏整体 scale≈1.2（扩张），实得 ${side.sx},${side.sy}`);
  assert.ok(Math.abs(side.tx) < 0.5, `侧栏 x 顶角锚定 tx≈0，实得 ${side.tx}`);
  assert.ok(Math.abs(side.ty - 12.8) < 0.5, `侧栏随顶栏变高整体下移 ty≈12.8（真实重排），实得 ${side.ty}`);

  const main = readTransform(ctx, 'main');
  assert.ok(Math.abs(main.tx - 48) < 0.5, `内容列被顶右 tx≈48，实得 ${main.tx}`);
  assert.ok(main.sx < 1 && Math.abs(main.sx - (992 / 1040)) < 0.01,
    `内容列真实收窄 sx≈0.954 (<1)，区别于均匀预览 scale(1.2) 变宽；实得 ${main.sx}`);
});

test('祖先缩放补偿：侧栏项随父缩放收敛恒等（无双重 1.44×）', () => {
  const { ctx } = makeCtx();
  vm.runInContext(`window.__uiScaleReflow.prepare(); window.__uiScaleReflow.begin(); window.__uiScaleReflow.renderAt(120)`, ctx);
  const itA = readTransform(ctx, 'itA');
  assert.equal(itA.rule, '', `侧栏项被父链缩放完全补偿 → 无自身 transform 规则（无双重缩放），实得规则「${itA.rule}」`);
});

// v0.31.4（P1/P5）断线回归：SHELL_SELECTORS 曾写 '.sidebar'（真实 DOM 是 .client-sidebar）——
// 整条侧栏（含左下用户卡）未遍历零单元。改对类名后 .client-sidebar 成单元，侧栏宽随 scale 采样
// 扩张（P5 分界移动同源）。
test('P1/P5：.client-sidebar 是 shell 单元（侧栏宽随 scale 扩张、分界移动）', () => {
  const { ctx } = makeCtx();
  vm.runInContext(`window.__uiScaleReflow.prepare()`, ctx);
  const units = vm.runInContext(`window.__uiScaleReflow._units()`, ctx);
  assert.ok(units.some(u => u.el.id === 'side'), '.client-sidebar 被收集为单元（曾 .sidebar 查不到整栏零单元）');
  vm.runInContext(`window.__uiScaleReflow.begin(); window.__uiScaleReflow.renderAt(120)`, ctx);
  const side = readTransform(ctx, 'side');
  assert.ok(Math.abs(side.sx - 1.2) < 0.02, `侧栏宽随 scale 扩张 sx≈1.2（分界随之移动），实得 ${side.sx}`);
});

// v0.31.4（P2）文本元素统一等比：文本单元视觉缩放 = 字号比例（1.2），不随父块 rect 拉伸变扁；
// 块单元照旧 rect 拉伸（允许 sx≠sy）。
test('P2：文本单元统一等比（视觉 sx=sy=字号比例，不受父拉伸影响）；块单元照旧 rect 拉伸', () => {
  const { ctx } = makeCtx();
  vm.runInContext(`window.__uiScaleReflow.prepare(); window.__uiScaleReflow.begin(); window.__uiScaleReflow.renderAt(120)`, ctx);
  const main = readTransform(ctx, 'main');
  const note = readTransform(ctx, 'noteText');
  assert.ok(note.rule, '文本单元有 transform 规则');
  // 视觉缩放 = 局部 × 祖先：noteText 应等比 1.2（父 main sx≈0.954/sy≈1.2 不影响文字形状）
  assert.ok(Math.abs(note.sx * main.sx - 1.2) < 0.02 && Math.abs(note.sy * main.sy - 1.2) < 0.02,
    `文本单元视觉等比 1.2（sx*ancSx=${(note.sx * main.sx).toFixed(3)} sy*ancSy=${(note.sy * main.sy).toFixed(3)}）——曾 sx≠sy 文字变扁`);
  // 块单元（卡片）保持 rect 拉伸：视觉 sx≠sy（真实 reflow 中块变窄变高，允许）
  const c1 = readTransform(ctx, 'c1');
  assert.ok(c1.rule, '卡片有规则');
  assert.ok(Math.abs(c1.sx * main.sx - c1.sy * main.sy) > 0.05,
    `块单元保持非等比 rect 拉伸（真实收窄 sx<sy），实得 视觉sx=${(c1.sx * main.sx).toFixed(3)} 视觉sy=${(c1.sy * main.sy).toFixed(3)}`);
});

// v0.31.4（P3）分隔线单元：参与预览（只位移 + 宽随布局），视觉高度恒 1px（不随字号/祖先放大）。
test('P3：分隔线单元——宽随布局、视觉高度恒 1px（不放大不压按钮）', () => {
  const { ctx } = makeCtx();
  vm.runInContext(`window.__uiScaleReflow.prepare(); window.__uiScaleReflow.begin(); window.__uiScaleReflow.renderAt(120)`, ctx);
  const div = readTransform(ctx, 'divider');
  assert.ok(div.rule, '分隔线收集为单元并有规则（曾 h<8 被过滤、原地不动与按钮错位）');
  const main = readTransform(ctx, 'main');
  assert.ok(Math.abs(div.sy * main.sy - 1) < 0.02,
    `分隔线视觉高度恒 1px（sy*ancSy≈1），实得 ${(div.sy * main.sy).toFixed(3)}`);
  assert.ok(Math.abs(div.sx * main.sx - 1.2) < 0.02,
    `分隔线宽度随布局（sx*ancSx≈1.2），实得 ${(div.sx * main.sx).toFixed(3)}`);
});

test('teardown：样式表清空 + data-ui-reflow-unit 属性全撤（成对零残留）', () => {
  const { ctx } = makeCtx();
  vm.runInContext(`window.__uiScaleReflow.prepare(); window.__uiScaleReflow.begin(); window.__uiScaleReflow.renderAt(120)`, ctx);
  assert.ok(hasTranslate(ctx), '渲染期有 transform');
  vm.runInContext(`window.__uiScaleReflow.teardown()`, ctx);
  assert.equal(vm.runInContext(`document.getElementById('__ui-reflow-transforms').textContent`, ctx), '', '样式表清空');
  assert.equal(vm.runInContext(`document.querySelectorAll('[data-ui-reflow-unit]').length`, ctx), 0, 'data-ui-reflow-unit 全撤');
});

test('页面切换后 prepare 重采：新可见页单元收录、旧页单元移除', () => {
  const { ctx } = makeCtx();
  vm.runInContext(`window.__uiScaleReflow.prepare()`, ctx);
  const before = vm.runInContext(`window.__uiScaleReflow._units()`, ctx);
  assert.ok(before.some(u => u.el.id === 'c1'), '切换前含旧页卡片 c1');
  assert.ok(!before.some(u => u.el.id === 'c3'), '切换前不含隐藏页卡片 c3');
  // 切页：pg1 隐藏、pg2 显示
  vm.runInContext(`document.getElementById('pg1').classList.add('hidden'); document.getElementById('pg2').classList.remove('hidden')`, ctx);
  vm.runInContext(`window.__uiScaleReflow.prepare()`, ctx);
  const after = vm.runInContext(`window.__uiScaleReflow._units()`, ctx);
  assert.ok(after.some(u => u.el.id === 'c3'), '切换后收录新可见页卡片 c3');
  assert.ok(!after.some(u => u.el.id === 'c1'), '切换后移除旧页卡片 c1');
});

test('陈旧守卫：预热采样后元素被重渲染摘除（isConnected=false）→ prepare 重建，死元素单元剔除（生产实证 54/144 脱树）', () => {
  const { ctx } = makeCtx();
  vm.runInContext(`window.__uiScaleReflow.prepare()`, ctx);
  const before = vm.runInContext(`window.__uiScaleReflow._units()`, ctx);
  assert.ok(before.some(u => u.el.id === 'c1'), '预热后含 c1 单元');
  // 模拟异步重渲染摘除 c1（innerHTML 替换把采样元素摘离 DOM）
  vm.runInContext(`document.getElementById('c1').remove()`, ctx);
  const ready = vm.runInContext(`window.__uiScaleReflow.prepare()`, ctx);
  assert.equal(ready, true, '陈旧检测到脱树后重建成功返回就绪');
  const after = vm.runInContext(`window.__uiScaleReflow._units()`, ctx);
  assert.ok(!after.some(u => u.el.id === 'c1'), '重建后死元素 c1 单元剔除');
  assert.ok(after.some(u => u.el.id === 'c2'), '重建后仍收录存活元素 c2');
  // 重建后采样可用（目标位有值）
  vm.runInContext(`window.__uiScaleReflow.begin(); window.__uiScaleReflow.renderAt(120)`, ctx);
  assert.ok(vm.runInContext(`document.querySelectorAll('[data-ui-reflow-unit]').length`, ctx) > 0, '重建后 renderAt 生效挂属性');
});

// v0.31.7（R4-2/R4-6）固定尺寸装饰单元：红点/滑块 thumb 视觉恒定像素——isFixed 分支 sx=sy=1/_ancS，
// 抵消祖先非等比缩放（用户实证红点 8.4×7 椭圆、滑块 thumb 非等比）。视觉缩放 = 自身×祖先链 ≈ 1。
test('R4-2/R4-6：红点固定尺寸单元——视觉恒 8px（抵消祖先缩放，不椭圆）', () => {
  const { ctx } = makeCtx();
  vm.runInContext(`window.__uiScaleReflow.prepare(); window.__uiScaleReflow.begin(); window.__uiScaleReflow.renderAt(120)`, ctx);
  const dot = readTransform(ctx, 'dot');
  const itA = readTransform(ctx, 'itA');
  const side = readTransform(ctx, 'side');
  assert.ok(dot.rule, '红点收集为单元（isFixedDeco 放宽 h<8 阈值）');
  // 视觉缩放 = dot.sx × itA.sx × side.sx（祖先链）——isFixed 只位移不缩放 → ≈1（8px 恒定）
  const visual = dot.sx * itA.sx * side.sx;
  assert.ok(Math.abs(visual - 1) < 0.02,
    `红点视觉缩放≈1（8px 恒定），实得 ${visual.toFixed(3)}——曾随父链 sx≈1.2 放大成椭圆`);
});

// v0.31.7（R4-4）按钮类排除文本等比 → 走 block rect 拉伸：定宽按钮（filter-toggle 场景）采样 target 宽
// 恒 90 → 预览视觉宽 90 不超缩（fs 等比会预测 90×1.2=108）。按钮直接含文本但 CONTROL_RE 排除 isText。
test('R4-4：定宽按钮 block rect 拉伸——预览视觉宽 90 不超缩（fs 等比会错误放大到 108）', () => {
  const { ctx } = makeCtx();
  vm.runInContext(`window.__uiScaleReflow.prepare(); window.__uiScaleReflow.begin(); window.__uiScaleReflow.renderAt(120)`, ctx);
  const btn = readTransform(ctx, 'btn');
  const main = readTransform(ctx, 'main');
  assert.ok(btn.rule, '按钮收集为单元（LAYOUT_RE 补 btn 词）');
  // 视觉宽缩放 = btn.sx × main.sx（祖先链）——block 分支 = target.w/base.w = 90/90 = 1
  const visual = btn.sx * main.sx;
  assert.ok(Math.abs(visual - 1) < 0.02,
    `定宽按钮视觉宽缩放≈1（90px 不超缩），实得 ${visual.toFixed(3)}——若走 isText fs 等比会得 1.2（108px 超缩）`);
  const visualH = btn.sy * main.sy;
  assert.ok(Math.abs(visualH - 1) < 0.02, `定宽按钮视觉高缩放≈1（40px 恒定），实得 ${visualH.toFixed(3)}`);
});

// v0.31.7（R4-7）采样禁全站 transition：sampleTargets 期间挂 html[data-ui-sampling]，style.css 有
// `transition:none !important` 规则（.sidebar-item 等 padding var(--t-slow) 过渡让采样读到动画起点旧高度）。
test('R4-7：采样禁全站 transition（data-ui-sampling 门控 + style.css 规则）', () => {
  const src = readFileSync('./ui-scale-reflow.js', 'utf8');
  assert.match(src, /docEl\.dataset\.uiSampling = '1'/, 'sampleTargets 挂 data-ui-sampling 门控');
  assert.match(src, /delete docEl\.dataset\.uiSampling/, '采样后移除门控（成对零残留）');
  const css = readFileSync('./style.css', 'utf8');
  assert.match(css, /html\[data-ui-sampling\] \*[\s\S]*?transition: none !important/, 'style.css 禁全站 transition 规则');
});
