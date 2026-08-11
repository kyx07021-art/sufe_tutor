/**
 * v0.27.6 UI 滑块拖动期元素级模拟重排（ui-scale-reflow.js）
 *
 * 机制：拖动期把真实重排的"目标位"采样成离散档位（UI_SCALE_REFLOW_SAMPLE_STEP 每 5% 一档），
 * 用 per-element transform（translate+scale）把每个布局单元移动到真实重排后的位置——合成器只读，
 * 零 reflow 零 repaint；真实页面 --ui-scale 拖动期不动，松手 commit 才一次真重排。
 *
 * 本测试用 stub getBoundingClientRect 模拟真实重排目标（侧栏随缩放扩张 → 内容列右缘钉视口、
 * 左缘被顶右收窄的非均匀目标位），验证：
 *   1. prepare：采样档位 = [80,85,…,120]（CONFIG 单源 5）；采样后 --ui-scale 还原，无闪屏中间态残留；
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
// 与真实 .sidebar max(144*S,13.3vw*S) 增长、内容列变窄的机制同构（测试用确定性简化模型）。
function reflowModel(sf) {
  return {
    nav: { x: 0, y: 0, width: 1280, height: 64 * sf },
    side: { x: 0, y: 64 * sf, width: 240 * sf, height: 736 * sf },
    itA: { x: 12 * sf, y: 72 * sf, width: 216 * sf, height: 44 * sf },
    itB: { x: 12 * sf, y: 124 * sf, width: 216 * sf, height: 44 * sf },
    main: { x: 240 * sf, y: 64 * sf, width: 1280 - 240 * sf, height: 736 * sf },
    pg1: { x: 240 * sf, y: 64 * sf, width: 1280 - 240 * sf, height: 736 * sf },
    c1: { x: 240 * sf + 16 * sf, y: 64 * sf + 16 * sf, width: 1280 - 240 * sf - 32 * sf, height: 180 * sf },
    c2: { x: 240 * sf + 16 * sf, y: 64 * sf + 196 * sf, width: 1280 - 240 * sf - 32 * sf, height: 180 * sf },
  };
}

const DOM = `
  <div class="navbar" id="nav"></div>
  <div class="sidebar" id="side"><div class="sidebar-scroll"><nav class="sidebar-nav">
    <div class="sidebar-item" id="itA">A</div><div class="sidebar-item" id="itB">B</div>
  </nav></div></div>
  <div class="client-main" id="main">
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
  w.APP_CONSTANTS = { CONFIG: { UI_SCALE_MIN: 80, UI_SCALE_MAX: 120, UI_SCALE_REFLOW_SAMPLE_STEP: 5 } };
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

test('CONFIG 单源：UI_SCALE_REFLOW_SAMPLE_STEP=5 在 constants.js（UI_SCALE_MIN..MAX 整除步进）', () => {
  assert.match(CONSTANTS, /UI_SCALE_REFLOW_SAMPLE_STEP:\s*5/, 'constants.js 定义 UI_SCALE_REFLOW_SAMPLE_STEP: 5');
});

test('prepare：采样档位 [80,85,…,120]；采样后 --ui-scale 还原（无闪屏中间态残留）', () => {
  const { ctx } = makeCtx();
  vm.runInContext(`window.__uiScaleReflow.prepare()`, ctx);
  const samples = vm.runInContext(`window.__uiScaleReflow._samples()`, ctx);
  assert.deepEqual(Array.from(samples), [80, 85, 90, 95, 100, 105, 110, 115, 120], 'UI_SCALE_MIN..MAX 每 5% 一档');
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
