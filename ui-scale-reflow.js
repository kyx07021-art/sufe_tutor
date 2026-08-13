/**
 * ui-scale-reflow.js — 元素级模拟重排预览（v0.27.6）
 *
 * 架构补丁注释：本模块是从「--ui-scale 走布局属性通路」主干上生出来的补丁。
 *   折射的架构缺陷：--ui-scale 全站 calc() 扩散（根字号 + 69 处 calc + 305 处 rem），任何缩放都要
 *   整树 reflow——生产实测完整每帧 ~36-42ms（25fps，paint 是大头），拖动期真实重排 60fps 不可达
 *   （即 v0.25.111 全页重绘返工红线）。补丁把"真实重排的结果"采样成离散档位目标位（flash-free，
 *   同帧 set+测+还原不闪屏），拖动期用 per-element transform 把每个布局单元插值移动到真实重排后的
 *   位置（合成器只读零 reflow 零 repaint）——即用户要求的「切到元素级分区、按真实重排表现驱动移动、
 *   实现模拟重排」。
 *   真实页拖动期只写 transform/属性；commit 仍走 --ui-scale 一次真重排（成本与今天相同）。
 *
 * 机制：
 *   1. collectUnits：壳（.navbar/.sidebar/.client-main）+ 可见页内"布局显著块"（类名命中 LAYOUT_RE
 *      + 有几何尺寸的叶子块）→ 单元表，每个单元记录 当前 rect（base）。
 *   2. sampleTargets：对每个采样档位（CONFIG.UI_SCALE_REFLOW_SAMPLE_STEP 每 5% 一档，MIN~MAX），
 *      同帧 set --ui-scale → 强制 layout 测各单元 rect → 还原（浏览器只在任务结束 paint，不闪屏）。
 *   3. renderAt(scale)：插值目标 rect → 自顶向下算 per-element transform（translate+scale，origin 0 0，
 *      translate 含祖先 transform 补偿）→ 写进单张 <style>（合成器只读）。
 *   4. teardown：撤 data 属性 + 清样式表，成对零残留。
 *
 * 铁律相容：JS 只写 CSS 变量/属性（data-ui-reflow-unit 由本模块管理，transform 全在 CSS 呈现层经
 *   动态样式表消费）；无内联样式；无 transition/逐帧动画（静态 transform）；真实页零 reflow。
 */
(function () {
  var SAMPLE_STEP = 5; // CONFIG.UI_SCALE_REFLOW_SAMPLE_STEP 单源（app-state 读后覆写）
  var SAMPLES = [];    // 采样档位（百分数，升序，含 MIN/MAX）
  // v0.31.4（P1）LAYOUT_RE 补词：user/text/invite/version/footnote/label/value/hint/desc/name/role——
  // 左下用户卡（.sidebar-user 族）、设置页文本容器（.settings-label/.settings-value/.settings-hint）此前
  // 类名不命中 + 无直接文本 → 不成独立单元，缩放与父块脱节。补词后这些块单设分区。
  var LAYOUT_RE = /(^|[-_\s])(card|row|grid|list|form|seg|tab|pill|tag|slot|pane|panel|notice|notif|msg|filter|toolbar|item|block|header|foot|page|search|chip|badge|profile|filter|tool|user|text|invite|version|footnote|label|value|hint|desc|name|role)([-_\s]|$)/i;
  // v0.31.4（P1 断线根因）：SHELL_SELECTORS 曾写 '.sidebar'——真实 DOM 是 .client-sidebar（aside）！
  // 整条侧栏（除 .sidebar-nav）从未被遍历：左下用户卡/邀请卡/栏底脚注零单元。改对类名后侧栏主体成
  // 单元（P5 分界随之移动），其内块经 LAYOUT_RE 补词 + 文本叶子各自成单元。
  var SHELL_SELECTORS = ['.navbar', '.client-sidebar', '.client-main'];
  var EXCLUDE_SELECTORS = ['.ui-scale-row', '.ui-scale-control', '.ui-scale-slider', '.toast', '#toast-container', '.modal', '.modal-overlay', '#modal-container'];
  // v0.31.4（P3）横向分隔线识别：类名 divider/separator/hr 的细条、或高度 <6px 的宽横条（如主题选项
  // 下的行分隔）。收为「分隔单元」：只随布局位移（ty/tx 跟 target），sy=1/ancSy 恒保持 1px 不放大
  // （真实 reflow 中 1px border 不受 --ui-scale 影响）；用户方案「按钮预览位置与上方分割线高度关联」——
  // 分割线参与垂直跟随即不再与按钮错位。
  var DIVIDER_RE = /(^|[-_\s])(divider|separator|hr)([-_\s]|$)/i;

  var units = [];       // [{el, base:{x,y,w,h}, targets:{80:{...},...}, parentIdx, tx,ty,sx,sy, _ancX,_ancY,_ancSx,_ancSy}]
  var unitByEl = new WeakMap();
  var styleEl = null;
  var sampledPage = null; // 采样的可见 .client-page 引用（变了要重采）
  var active = false;
  var baseScale = 1;    // v0.31.5（P1）：collectUnits 时记录的当前 --ui-scale——文本单元字号比例必须
                        // 相对此基数（scalePct/currentScale），绝对档位（scalePct/100）在非 100 基数下
                        // 预览偏大（用户实证：105 基数预览 110 时按钮 55.6×32.4 vs 实际 58.2×34.4）

  function cssVars(cfg) {
    if (cfg && cfg.UI_SCALE_REFLOW_SAMPLE_STEP) SAMPLE_STEP = cfg.UI_SCALE_REFLOW_SAMPLE_STEP;
    var min = (cfg && cfg.UI_SCALE_MIN) || 80, max = (cfg && cfg.UI_SCALE_MAX) || 120;
    SAMPLES = [];
    for (var s = min; s <= max + 0.5; s += SAMPLE_STEP) SAMPLES.push(Math.round(s));
  }
  var _cfg = (window.__APP_CONSTANTS && window.__APP_CONSTANTS.CONFIG) || (window.APP_CONSTANTS && window.APP_CONSTANTS.CONFIG);
  cssVars(_cfg);

  function visiblePage() {
    for (var i = 0; i < document.querySelectorAll('.client-page').length; i++) {
      var p = document.querySelectorAll('.client-page')[i];
      if (p && !p.classList.contains('hidden')) return p;
    }
    return null;
  }

  function isExcluded(el) {
    for (var i = 0; i < EXCLUDE_SELECTORS.length; i++) {
      if (el.matches && el.matches(EXCLUDE_SELECTORS[i])) return true;
    }
    return false;
  }

  // v0.31.4（P3）：横向分隔线识别——类名命中 DIVIDER_RE（divider/separator/hr）或「宽横条」
  // （width>60 且 height<6，非 inline）。分隔线是 1px 级别，普通 isLayoutBlock 的 h>=8 阈值会把它
  // 排除 → 预览中原地不动、与移动的按钮错位（用户实证「分割线跑按钮底下」）。
  function isDivider(el) {
    if (el.nodeType !== 1 || isExcluded(el)) return false;
    var cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.position === 'fixed') return false;
    var disp = cs.display;
    if (disp === 'inline' || disp === 'contents') return false;
    var r = el.getBoundingClientRect();
    if (r.width < 60) return false; // 太窄不构成横向分隔线
    var cls = String(el.className && el.className.toString ? el.className : '');
    if (cls && DIVIDER_RE.test(cls)) return true; // 类名命中（form-divider/hr 等）即分隔线
    return r.height < 6; // 类名未命中但高 <6px 的宽横条视为视觉分隔线（border 级）
  }

  function isLayoutBlock(el) {
    if (el.nodeType !== 1 || isExcluded(el)) return false;
    var cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.position === 'fixed') return false;
    // 只收有几何的块（inline 文本/纯 span 不收）
    var disp = cs.display;
    if (disp === 'inline' || disp === 'contents') return false;
    var r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return false;
    // 布局显著：壳 / 类名命中 / 直接含非空文本（叶子块）
    var cls = String(el.className && el.className.toString ? el.className : '');
    if (cls && LAYOUT_RE.test(cls)) return true;
    if (el.childNodes && Array.prototype.some.call(el.childNodes, function (n) { return n.nodeType === 3 && /\S/.test(n.nodeValue || ''); })) return true;
    return false;
  }

  // v0.31.4（P2）：文本承载单元 = 直接含非空白文本节点。这类块的视觉主体是文字——真实 reflow 中
  // 文字大小只随 --ui-scale 根字号（等比），而 rect 宽度会因 flex/行内布局变化——若按 target rect
  // 拉伸（sx=target.w/base.w）会把文字压扁/拉长（用户实证「有的变扁有的等比，不统一」）。
  // 统一规则：文本单元 sx=sy=字号比例（等比，永不变形），位置仍跟 target（tx/ty 祖先补偿不变）。
  function isTextUnit(el) {
    return !!(el.childNodes && Array.prototype.some.call(el.childNodes, function (n) { return n.nodeType === 3 && /\S/.test(n.nodeValue || ''); }));
  }

  function collectUnits() {
    units = [];
    unitByEl = new WeakMap();
    var page = visiblePage();
    sampledPage = page;
    // v0.31.5（P1）：记录当前基数的 --ui-scale（默认未设 = 1/100%）——base rect 是此基数下的几何，
    // 文本单元的相对字号比例以此为准（targetScale/currentScale），见 renderAt。
    baseScale = parseFloat(document.documentElement.style.getPropertyValue('--ui-scale')) || 1;
    var roots = [];
    for (var i = 0; i < SHELL_SELECTORS.length; i++) {
      var list = document.querySelectorAll(SHELL_SELECTORS[i]);
      for (var j = 0; j < list.length; j++) roots.push(list[j]);
    }
    // 可见页根 + 侧栏导航根
    if (page) roots.push(page);
    var nav = document.querySelector('.sidebar-nav');
    if (nav) roots.push(nav);

    // 遍历收集（shell 无条件，其余按 isLayoutBlock）
    var seen = new Set();
    var stack = [];
    for (var r = 0; r < roots.length; r++) {
      if (!roots[r] || seen.has(roots[r])) continue;
      seen.add(roots[r]);
      stack.push(roots[r]);
    }
    var order = [];
    while (stack.length) {
      var el = stack.pop();
      var isShell = false;
      for (var s = 0; s < SHELL_SELECTORS.length; s++) {
        if (el.matches && el.matches(SHELL_SELECTORS[s])) { isShell = true; break; }
      }
      // 隐藏页内的子元素跳过
      var hiddenAncestor = false;
      var p = el.parentElement;
      while (p) { if (p.classList && p.classList.contains('client-page') && p.classList.contains('hidden')) { hiddenAncestor = true; break; } p = p.parentElement; }
      if (hiddenAncestor) continue;
      // display:none 根（如 client 视图 .navbar 是 hidden 的 0×0 壳）不收集——0×0 单元浪费 slot 且 base.w=0 恒等
      if (isShell && getComputedStyle(el).display === 'none') continue;
      if (isShell || isLayoutBlock(el) || isDivider(el)) {
        order.push(el);
        unitByEl.set(el, true);
      }
      var kids = Array.prototype.slice.call(el.children).reverse();
      for (var k = 0; k < kids.length; k++) stack.push(kids[k]);
    }

    // 测 base rect（当前 scale 下即 live）
    for (var u = 0; u < order.length; u++) {
      var r2 = order[u].getBoundingClientRect();
      units.push({ el: order[u], base: { x: r2.x, y: r2.y, w: r2.width, h: r2.height }, targets: {}, parentIdx: -1, tx: 0, ty: 0, sx: 1, sy: 1, _ancX: 0, _ancY: 0, _ancSx: 1, _ancSy: 1, isDivider: isDivider(order[u]), isText: isTextUnit(order[u]) });
    }
    // 建 parent 链（最近 unit 祖先）
    for (var a = 0; a < units.length; a++) {
      var anc = units[a].el.parentElement;
      while (anc) {
        var ai = unitByEl.has(anc) ? units.findIndex(function (x) { return x.el === anc; }) : -1;
        if (ai >= 0) { units[a].parentIdx = ai; break; }
        anc = anc.parentElement;
      }
    }
    // 拓扑排序：父单元必须先于子单元（显式根是 LIFO 弹出的，嵌套根如 .sidebar→.sidebar-nav、
    // .client-main→.client-page 的父索引可能 > 子索引，renderAt 自顶向下累积祖先变换依赖父先子后）。
    // 若父在子后，子读到的父 _ancX/_ancScale 是默认值 → NaN transform（生产事故级）。
    var N = units.length, done = new Array(N).fill(false), sorted = [];
    function visit(i) { if (done[i]) return; var p = units[i].parentIdx; if (p >= 0) visit(p); done[i] = true; sorted.push(i); }
    for (var i = 0; i < N; i++) visit(i);
    var newPos = new Array(N), remapped = [];
    for (var i = 0; i < N; i++) newPos[sorted[i]] = i;
    for (var i = 0; i < N; i++) {
      var o = units[sorted[i]];
      remapped.push({
        el: o.el, base: o.base, targets: o.targets,
        parentIdx: o.parentIdx >= 0 ? newPos[o.parentIdx] : -1,
        tx: 0, ty: 0, sx: 1, sy: 1, _ancX: 0, _ancY: 0, _ancSx: 1, _ancSy: 1,
        isDivider: o.isDivider, isText: o.isText,
      });
    }
    units = remapped;
    return units;
  }

  function sampleTargets() {
    var docEl = document.documentElement;
    var prev = docEl.style.getPropertyValue('--ui-scale');
    var prevX = window.scrollX, prevY = window.scrollY;
    var i, s;
    for (i = 0; i < SAMPLES.length; i++) {
      s = SAMPLES[i];
      var sc = (s / 100).toFixed(3);
      docEl.style.setProperty('--ui-scale', sc);
      // 强制整树 layout + 逐单元测 rect（读 getBoundingClientRect 本身同步强制 layout，无需额外
      // offsetHeight 结算——同一 task 内不 paint 中间态；v0.31.4 P4 去冗余，每档省一次全树 layout）
      for (var u = 0; u < units.length; u++) {
        var r = units[u].el.getBoundingClientRect();
        units[u].targets[s] = { x: r.x, y: r.y, w: r.width, h: r.height };
      }
      docEl.style.setProperty('--ui-scale', prev);
      window.scrollTo(prevX, prevY); // 每档还原滚动：rect 用视口坐标，防档间 scroll 漂移污染采样
    }
  }

  function lerp(a, b, t) { return a + (b - a) * t; }

  function rectAt(u, scalePct) {
    var ts = SAMPLES;
    if (scalePct <= ts[0]) return u.targets[ts[0]] || u.base;
    var last = ts[ts.length - 1];
    if (scalePct >= last) return u.targets[last] || u.base;
    var lo = ts[0], hi = ts[1];
    for (var i = 0; i < ts.length - 1; i++) { if (scalePct >= ts[i] && scalePct <= ts[i + 1]) { lo = ts[i]; hi = ts[i + 1]; break; } }
    var t = (scalePct - lo) / (hi - lo);
    var a = u.targets[lo], b = u.targets[hi];
    if (!a || !b) return u.targets[Math.round(scalePct)] || u.base;
    return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t) };
  }

  function renderAt(scalePct) {
    if (!units.length) return;
    // 自顶向下（拓扑序父先子后）：累积祖先变换。单元 transform = translate(tx,ty) scale(sx,sy) origin 0 0。
    //   _ancX/_ancY = 本单元局部原点在视口的位置（仅祖先变换作用）；_ancSx/_ancSy = 祖先累计缩放（含父自身 sx，不含自己）。
    //   tx = (target.x - _ancX)/_ancSx ；sx = target.w/(base.w·_ancSx)。
    //   —— 祖先已缩放的尺寸不再倍乘（父 scale(1.2) 时子单元同目标收敛到恒等 transform，杜绝双重缩放 1.44×）。
    //   子单元 _anc 由父的 tx/sx 递推：子局部原点在父局部系 = (子base - 父base)，经父 transform 再经父祖先映射。
    for (var i = 0; i < units.length; i++) {
      var u = units[i];
      var target = rectAt(u, scalePct);
      var par = u.parentIdx >= 0 ? units[u.parentIdx] : null;
      if (par) {
        u._ancX = par._ancX + par._ancSx * (par.tx + (u.base.x - par.base.x) * par.sx);
        u._ancY = par._ancY + par._ancSy * (par.ty + (u.base.y - par.base.y) * par.sy);
        u._ancSx = par._ancSx * par.sx;
        u._ancSy = par._ancSy * par.sy;
      } else {
        u._ancX = u.base.x; u._ancY = u.base.y; u._ancSx = 1; u._ancSy = 1;
      }
      u.tx = u._ancSx ? (target.x - u._ancX) / u._ancSx : 0;
      u.ty = u._ancSy ? (target.y - u._ancY) / u._ancSy : 0;
      if (u.isText) {
        // v0.31.4（P2）文本单元统一等比：文字永不变形（用户「有的变扁有的等比，不统一」根治）。
        // v0.31.5（P1）基数修正：字号比例 = 目标 scale/当前 base scale（相对），非绝对档位——base
        // 是 currentScale 下的 rect，绝对 fs=scalePct/100 在非 100 基数下预览偏大（按钮实证）。
        var fs = (scalePct / 100) / baseScale;
        u.sx = u._ancSx ? fs / u._ancSx : fs;
        u.sy = u._ancSy ? fs / u._ancSy : fs;
      } else if (u.isDivider) {
        // v0.31.4（P3）分隔单元：宽度跟随 target（水平拉伸无碍），高度恒 1px（除以祖先 sy 抵消放大）。
        u.sx = (u.base.w > 0 && u._ancSx) ? target.w / (u.base.w * u._ancSx) : 1;
        u.sy = u._ancSy ? 1 / u._ancSy : 1;
      } else {
        u.sx = (u.base.w > 0 && u._ancSx) ? target.w / (u.base.w * u._ancSx) : 1;
        u.sy = (u.base.h > 0 && u._ancSy) ? target.h / (u.base.h * u._ancSy) : 1;
      }
    }
    // 写样式表（只写非恒等变换，减体积）
    var lines = [];
    for (var k = 0; k < units.length; k++) {
      var un = units[k];
      if (Math.abs(un.tx) < 0.5 && Math.abs(un.ty) < 0.5 && Math.abs(un.sx - 1) < 0.002 && Math.abs(un.sy - 1) < 0.002) continue;
      lines.push('[data-ui-reflow-unit="' + k + '"]{transform:translate(' + un.tx.toFixed(2) + 'px,' + un.ty.toFixed(2) + 'px) scale(' + un.sx.toFixed(4) + ',' + un.sy.toFixed(4) + ')}');
    }
    if (!styleEl) { styleEl = document.createElement('style'); styleEl.id = '__ui-reflow-transforms'; document.head.appendChild(styleEl); }
    // 不用 will-change：会提升数百个合成层（内存/GPU 代价）；有 transform 的单元本就提升，无 transform 的无需提升。
    styleEl.textContent = '[data-ui-reflow-unit]{transform-origin:0 0}\n' + lines.join('\n');
    // 挂属性（只挂一次：同名属性重复 set 可能触发样式失效，拖动期零冗余 set）
    for (var m = 0; m < units.length; m++) {
      if (!units[m].el.hasAttribute('data-ui-reflow-unit')) units[m].el.setAttribute('data-ui-reflow-unit', String(m));
    }
  }

  function teardown() {
    if (styleEl) { styleEl.textContent = ''; }
    for (var i = 0; i < units.length; i++) units[i].el.removeAttribute('data-ui-reflow-unit');
    // 全量清扫：跨页循环中「上次是单元、本次不是」的残留属性（旧元素仍在 DOM）一并撤，零残留
    var stale = document.querySelectorAll('[data-ui-reflow-unit]');
    for (var s = 0; s < stale.length; s++) stale[s].removeAttribute('data-ui-reflow-unit');
    units = [];
    unitByEl = new WeakMap();
    active = false;
  }

  // 惰性准备：可见页变化 / 未采样 / 缓存单元元素被重渲染摘除 → 重建单元 + 采样；返回是否就绪。
  // 陈旧守卫（生产实证）：设置页异步填充（设备列表/凭证值/用户名冷却）在预热采样后 innerHTML 重渲染，
  // 会把采样的元素摘离 DOM——缓存单元引用旧元素，renderAt 给死元素挂 transform，新渲染内容零预览
  // （拖动期「行没动」）。isConnected 检查 144 单元 <0.1ms，检测到任何脱树即整批重建重采样（一次 ~150-400ms
  // 后台预热成本，拖动中只发生一次，之后缓存有效）。注意：只对「采样过的页」做陈旧检测，页面变化走既有分支。
  function prepare() {
    var page = visiblePage();
    if (page && page === sampledPage && units.length) {
      for (var i = 0; i < units.length; i++) {
        if (!units[i].el.isConnected) { units = []; unitByEl = new WeakMap(); break; } // 陈旧 → 强制重建（走下方收集）
      }
      if (units.length) return true;
    }
    try {
      collectUnits();
      if (units.length) sampleTargets();
    } catch (e) { teardown(); return false; }
    return units.length > 0;
  }

  function begin() { active = true; }
  function isActive() { return active; }

  window.__uiScaleReflow = {
    prepare: prepare, renderAt: renderAt, teardown: teardown,
    begin: begin, isActive: isActive, collectUnits: collectUnits, sampleTargets: sampleTargets,
    _units: function () { return units; }, _samples: function () { return SAMPLES; },
  };
})();
