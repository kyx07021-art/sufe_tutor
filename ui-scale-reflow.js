/**
 * ui-scale-reflow.js — 元素级模拟重排预览
 *
 * 架构补丁注释：本模块是从「--ui-scale 走布局属性通路」主干上生出来的补丁。
 *   折射的架构缺陷：--ui-scale 全站 calc() 扩散（根字号 + 69 处 calc + 305 处 rem），任何缩放都要
 *   整树 reflow——生产实测完整每帧 ~36-42ms（25fps，paint 是大头），拖动期真实重排 60fps 不可达
 *   （全页重绘是返工红线）。补丁把"真实重排的结果"采样成离散档位目标位（flash-free，
 *   同帧 set+测+还原不闪屏），拖动期用 per-element transform 把每个布局单元插值移动到真实重排后的
 *   位置（合成器只读零 reflow 零 repaint）——即用户要求的「切到元素级分区、按真实重排表现驱动移动、
 *   实现模拟重排」。
 *   真实页拖动期只写 transform/属性；commit 仍走 --ui-scale 一次真重排（成本与今天相同）。
 *
 * 机制：
 *   1. collectUnits：壳（.navbar/.sidebar/.client-main）+ 可见页内"布局显著块"（类名命中 LAYOUT_RE
 *      + 有几何尺寸的叶子块）→ 单元表，每个单元记录 当前 rect（base）。
 *   2. sampleTargets：对每个采样档位（CONFIG.UI_SCALE_REFLOW_SAMPLE_STEP，MIN~MAX；定为 20，
 *      [80,100,120] 3 档——每档一次整树 reflow 是成本大头，档间 --ui-scale 乘性变换目标位近线性插值足够），
 *      同帧 set --ui-scale → 强制 layout 测各单元 rect → 还原（浏览器只在任务结束 paint，不闪屏）。
 *   3. renderAt(scale)：插值目标 rect → 自顶向下算 per-element transform（translate+scale，origin 0 0，
 *      translate 含祖先 transform 补偿）→ 写进单张 <style>（合成器只读）。
 *   4. teardown：撤 data 属性 + 清样式表，成对零残留。
 *
 * 变更记录：
 *   - R4-7：sampleTargets 挂 html[data-ui-sampling]（style.css 禁全站 transition）——.sidebar-item 等
 *     padding var(--t-slow) 过渡让采样读到动画起点旧高度（实测 h=50 vs 实际 60），box target 全错。
 *   - R4-2/R4-6：固定尺寸装饰单元（FIXED_RE：红点 dot/滑块 thumb 等）isFixed 分支 sx=sy=1/_ancS
 *     只位移不缩放（红点/滑块交互点等固定尺寸装饰，缩放会变椭圆）。
 *   - R4-4：LAYOUT_RE 补 btn|select|sort|toggle 让工具条按钮成单元（筛选/排序/收藏/发布/点赞预览
 *     零缩放）；CONTROL_RE 排除按钮类走 block rect 拉伸（采样真实宽——filter-toggle 定宽 90 的
 *     target 恒 90，fs 等比会错误预测 108）。
 *   - R4-1/R4-5：删 isDivider 渲染特例，横线统一 block rect 拉伸（采样真实
 *     rect，恒 1px 横线 target.h=base.h 数学等价）；isDivider 退化为收集标签。
 *
 * 铁律相容：JS 只写 CSS 变量/属性（data-ui-reflow-unit 由本模块管理，transform 全在 CSS 呈现层经
 *   动态样式表消费）；无内联样式；无 transition/逐帧动画（静态 transform）；真实页零 reflow。
 */
(function () {
  var SAMPLE_STEP = 5; // CONFIG.UI_SCALE_REFLOW_SAMPLE_STEP 单源（app-state 读后覆写）
  var SAMPLES = [];    // 采样档位（百分数，升序，含 MIN/MAX）
  // LAYOUT_RE 补词：user/text/invite/version/footnote/label/value/hint/desc/name/role——
  // 左下用户卡（.sidebar-user 族）、设置页文本容器（.settings-label/.settings-value/.settings-hint）此前
  // 类名不命中 + 无直接文本 → 不成独立单元，缩放与父块脱节。补词后这些块单设分区。
  var LAYOUT_RE = /(^|[-_\s])(card|row|grid|list|form|seg|tab|pill|tag|slot|pane|panel|notice|notif|msg|filter|toolbar|item|block|header|foot|page|search|chip|badge|profile|filter|tool|user|text|invite|version|footnote|label|value|hint|desc|name|role|btn|select|sort|toggle|devices|section)([-_\s]|$)/i;
  // 设置页「登录设备」区（.settings-devices）承载 border-top 横线，
  // 但类名 devices 不命中 LAYOUT_RE → 非单元 → 横线只随最近单元祖先（.client-main 壳）粗略缩放，与下方
  // .device-row（独立单元）预览位移不同步（用户实证「组件底层混乱」的残留）。补 devices/section 词——
  // 横线承载容器成单元后，横线与区内内容同一 transform（统一视觉组件必须先全站盘点归属）。
  // 每个实例的「承载元素是否进单元体系」，不能只统一 token 和渲染分支。
  // 固定尺寸装饰单元：红点/徽章/计数/滑块交互点（thumb 宿主）等类名命中的小块，
  // 真实 reflow 中尺寸恒定（固定 px，不随 --ui-scale），只随父容器位移。若走普通 block 拉伸会被祖先
  // 非等比缩放连带（用户实证红点 8.4×7 椭圆、滑块 thumb 非等比）。收为「固定尺寸单元」：
  // 只位移（tx/ty 跟 target）、sx=sy=1/_ancScale 抵消祖先缩放（视觉恒定像素）。
  // 定稿收窄：只收纯装饰（无文本内容）固定点——红点 .sidebar-dot / 通知点 / 滑块交互点宿主。
  // 徽章/计数/状态含数字文本，字号随 --ui-scale（走 isText 等比 + 祖先抵消更接近真实），不收死。
  var FIXED_RE = /(^|[-_\s])(dot|point|pulse|thumb)([-_\s]|$)/i;
  // .ui-scale-slider 是预览控件自身——其 thumb（交互点）必须恒定像素，但滑块轨道在 EXCLUDE 里
  // （预览控件不参与预览单元），这里单独放行收为固定尺寸单元。
  var FIXED_SELECTORS = ['.ui-scale-slider'];
  // SHELL_SELECTORS 必须与真实 DOM 类名一致（.client-sidebar 而非 .sidebar）！
  // 整条侧栏（除 .sidebar-nav）从未被遍历：左下用户卡/邀请卡/栏底脚注零单元。改对类名后侧栏主体成
  // 单元（P5 分界随之移动），其内块经 LAYOUT_RE 补词 + 文本叶子各自成单元。
  var SHELL_SELECTORS = ['.navbar', '.client-sidebar', '.client-main'];
  var EXCLUDE_SELECTORS = ['.ui-scale-row', '.ui-scale-control', '.ui-scale-slider', '.toast', '#toast-container', '.modal', '.modal-overlay', '#modal-container'];
  // v0.31.7（R4-1/R4-5 横线统一）：横向分隔线识别退化为「收集标签」——类名 divider/separator/hr 的
  // 细条、或高度 <6px 的宽横条，此前被 isLayoutBlock 的 h<8 阈值过滤（预览原地不动、与移动的按钮错位）。
  // 收集保证它们成单元（参与位移/缩放），渲染不再特例（统一 block rect 拉伸，见 renderAt 注释）。
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

  // v0.31.7（R4-2/R4-6）固定尺寸装饰单元识别：FIXED_RE 类名命中（红点/徽章/计数/状态点）且 ≥3px 的块，
  // 或预览滑块自身（.ui-scale-slider，thumb 固定尺寸，绕过 EXCLUDE）。h<8 的普通块被 isLayoutBlock 排除，
  // 但固定装饰本来就是小尺寸——按 FIXED_RE 单独放行（同 v0.31.4 P3 divider 放宽思路）。
  function isFixedDeco(el) {
    if (el.nodeType !== 1) return false;
    if (el.matches && el.matches(FIXED_SELECTORS.join(','))) return true;
    if (isExcluded(el)) return false;
    var cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.position === 'fixed') return false;
    if (cs.display === 'inline' || cs.display === 'contents') return false;
    var r = el.getBoundingClientRect();
    if (r.width < 3 || r.height < 3) return false;
    var cls = String(el.className && el.className.toString ? el.className : '');
    return !!(cls && FIXED_RE.test(cls));
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
  // v0.31.7（R4-4 按钮宽度）按钮类排除文本等比：按钮/下拉触发器/开关等是「控件」不是「文本容器」——
  // 真实 reflow 中控件宽高随布局/内容变化（采样 rect 才是真值），fs 等比（base.w×字号比例）会超缩或欠缩
  // （filter-toggle 实测固定 90，fs 会预测 108）。控件一律走 block rect 拉伸分支（sx=target.w/base.w 采样真值），
  // 文字变形只在 sx≠sy 时轻微发生且与真实重排一致；纯文本容器（.settings-value/.sidebar-user 等）保持 fs 等比。
  // 注意：控件内部直接文本节点无法单独补偿（无内层 span），已入单元体系待后续需要时再包层。
  var CONTROL_RE = /(^|[-_\s])(btn|select|toggle|switch|thumb)([-_\s]|$)/i;
  function isTextUnit(el) {
    if (el.matches && el.matches('button, input, select, textarea')) return false;
    var cls = String(el.className && el.className.toString ? el.className : '');
    if (cls && CONTROL_RE.test(cls)) return false;
    // 用户验收抓出（横线戳出 184px）：带横线（border）的块不算纯文本容器。
    //   大标题 .settings-section-title（border-bottom + 直接文本）曾被 isText 判定 → fs 等比 sx=fs=1.2
    //   → 视觉宽 920→1104，横线戳出右缘；真实 reflow 容器定宽标题宽不变（sx 应为 1）。
    //   语义：isText fs 等比只适合「宽度由文字内容决定」的纯文本块；有 border（横线承载）的块宽度
    //   由布局定 → 走 block rect 拉伸（sx=采样真实宽）。这也是「横线缩放逻辑一份」的收敛——横线承载
    //   元素统一 block。
    var cs = getComputedStyle(el);
    // 有横线（border）的块不算纯文本容器——宽度由布局定 → block rect 拉伸。判定须 style 非 none + width>0：
    // 浏览器无边框元素 borderTopStyle='none'（width 计算 0）；jsdom 对未设边框返回默认 width（非 0）但
    // style 为空串/undefined——只查 width 会把 jsdom 元素全判有边框（文本单元全走 block，测试假 FAIL）。
    function hasLine(w, s) { return cs[s] && cs[s] !== 'none' && parseFloat(cs[w] || '0') > 0; }
    if (hasLine('borderTopWidth', 'borderTopStyle') || hasLine('borderBottomWidth', 'borderBottomStyle')) return false;
    return !!(el.childNodes && Array.prototype.some.call(el.childNodes, function (n) { return n.nodeType === 3 && /\S/.test(n.nodeValue || ''); }));
  }

  // v0.31.10（T1/T2，用户「治标不治本，重做」定案）：block 单元（isTextUnit=false）且直接含非空白文本
  //   → 预览期把直接文本节点包 <span class="ui-reflow-text">，拆两层单元：
  //     容器走 block（sx 采样定宽——横线/宽度正确），span 走 isText（fs 等比 × 祖先缩放补偿除净）。
  //   单元素单 transform 表达不了「容器定宽 + 内容等比」——fix4 用 isText 排除 border 块换横线正确，
  //   代价是标题被 block 拉伸 sx=1/sy≈1.142、文字拉扁（用户实测）。拆两层后 span 视觉 =
  //   容器(1,sy) × span(fs/sy, fs/ancSx) = (fs,fs) 等比。标题/按钮内文字共用，teardown 还原零残留。
  //   restoreTextSpans 全量清扫（不依赖记录列表）：跨页/重建先还原上次包裹，防残留。
  function restoreTextSpans() {
    var all = document.querySelectorAll('.ui-reflow-text');
    for (var i = all.length - 1; i >= 0; i--) {
      var span = all[i];
      var el = span.parentElement;
      if (!el) continue;
      while (span.firstChild) el.insertBefore(span.firstChild, span);
      el.removeChild(span);
    }
  }

  // 对 block 单元直接含非空白文本节点 → 原位包成 span（保序：insertBefore 到文本前再移入）。
  // 幂等：el 已含 .ui-reflow-text 子则跳过（缓存重建/重复 collectUnits 不重包）。
  function wrapTextSpan(el) {
    if (el.nodeType !== 1 || isExcluded(el) || isTextUnit(el)) return null; // isText 单元已等比，无需包
    var ch = el.children;
    for (var k = 0; k < ch.length; k++) {
      if (ch[k].classList && ch[k].classList.contains('ui-reflow-text')) return null; // 已包
    }
    var wrapped = null;
    var kids = Array.prototype.slice.call(el.childNodes);
    for (var i = 0; i < kids.length; i++) {
      var n = kids[i];
      if (n.nodeType !== 3 || !/\S/.test(n.nodeValue || '')) continue;
      var span = document.createElement('span');
      span.className = 'ui-reflow-text';
      el.insertBefore(span, n); // span 插到文本前（保序，不破坏 drop-caret 等兄弟元素位置）
      span.appendChild(n);      // 文本移入 span（原位替换）
      if (!wrapped) wrapped = span;
    }
    return wrapped;
  }

  function collectUnits() {
    units = [];
    unitByEl = new WeakMap();
    restoreTextSpans(); // 跨页/重建先还原上次包裹（幂等前提）
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
      if (isShell || isLayoutBlock(el) || isDivider(el) || isFixedDeco(el)) {
        order.push(el);
        unitByEl.set(el, true);
      }
      var kids = Array.prototype.slice.call(el.children).reverse();
      for (var k = 0; k < kids.length; k++) stack.push(kids[k]);
    }

    // T1：block 单元直接含文本 → 包文本 span 成 isText 子单元（容器定宽 + 文字等比两层）。
    //   span 紧跟父 push 进 order（拓扑序父先子后），unitByEl 标记使其进单元表。
    var extra = [];
    for (var w0 = 0; w0 < order.length; w0++) {
      var sp = wrapTextSpan(order[w0]);
      if (sp) extra.push(sp);
    }
    for (var w1 = 0; w1 < extra.length; w1++) { order.push(extra[w1]); unitByEl.set(extra[w1], true); }

    // 测 base rect（当前 scale 下即 live）
    for (var u = 0; u < order.length; u++) {
      var r2 = order[u].getBoundingClientRect();
      units.push({ el: order[u], base: { x: r2.x, y: r2.y, w: r2.width, h: r2.height }, targets: {}, parentIdx: -1, tx: 0, ty: 0, sx: 1, sy: 1, _ancX: 0, _ancY: 0, _ancSx: 1, _ancSy: 1, isDivider: isDivider(order[u]), isText: isTextUnit(order[u]), isFixed: isFixedDeco(order[u]) });
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
        isDivider: o.isDivider, isText: o.isText, isFixed: o.isFixed,
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
    // v0.31.7（用户返工实测：「侧边栏各个选项卡之间的高度并没有被缩放」）：采样必须禁用全站
    // transition——.sidebar-item 等有 padding var(--t-slow) 过渡，设 --ui-scale 后 padding 停在
    // 动画起点，同帧读 rect = 旧高度（生产实测采样 h=50 vs 实际 60），box target 全错。
    // html[data-ui-sampling] 由 style.css 规则禁全站 transition，采样后移除。
    docEl.dataset.uiSampling = '1';
    try {
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
    } finally {
      // v0.31.8（外部审查）：try/finally 保证异常也摘门控——残留 data-ui-sampling 会全站禁 transition 直至下次采样
      delete docEl.dataset.uiSampling;
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
      if (u.isFixed) {
        // v0.31.7（R4-2/R4-6）固定尺寸装饰：红点/徽章/计数/滑块 thumb 视觉恒定像素——除以祖先缩放
        // 抵消放大（sx=sy=1/_ancS），只位移跟 target。真实 reflow 中这些是固定 px 不随 --ui-scale。
        u.sx = u._ancSx ? 1 / u._ancSx : 1;
        u.sy = u._ancSy ? 1 / u._ancSy : 1;
      } else if (u.isText) {
        // v0.31.4（P2）文本单元统一等比：文字永不变形（用户「有的变扁有的等比，不统一」根治）。
        // v0.31.5（P1）基数修正：字号比例 = 目标 scale/当前 base scale（相对），非绝对档位——base
        // 是 currentScale 下的 rect，绝对 fs=scalePct/100 在非 100 基数下预览偏大（按钮实证）。
        var fs = (scalePct / 100) / baseScale;
        u.sx = u._ancSx ? fs / u._ancSx : fs;
        u.sy = u._ancSy ? fs / u._ancSy : fs;
      } else {
        // v0.31.7（R4-1/R4-5 横线统一）：分隔线不再特例——
        // 横线统一走 block rect 拉伸（采样真实 reflow rect）。真实 reflow 中 1px 横线高度恒定，
        // 采样 target.h=base.h → sy≈1/ancSy，与旧特例数学等价；而旧特例在"横线高度随布局变化"
        // （flex 拉伸等）时无视采样真值，block 分支始终以采样为准。isDivider 退化为收集标签
        // （保证宽横条/独立分隔元素成单元，不被 h<8 过滤），渲染逻辑与普通块一份。
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
    // v0.31.5（P1 根因之二）：预览期禁用引擎 transform 过渡——.glass 引擎 transition: transform .18s
    //   会让刚写入的 per-element transform 从恒等动画起点开始（getBoundingClientRect 立即读 = 起点，
    //   拖动中预览持续滞后/偏小；生产实测同帧 55.6×31.7 vs 500ms 后 58.2×33.2）。transition:none
    //   !important 覆盖引擎；html[data-ui-reflowing] 门控只在预览期命中，teardown 清样式表即恢复。
    // 不用 will-change：会提升数百个合成层（内存/GPU 代价）；有 transform 的单元本就提升，无 transform 的无需提升。
    styleEl.textContent = 'html[data-ui-reflowing] [data-ui-reflow-unit]{transition:none !important}\n[data-ui-reflow-unit]{transform-origin:0 0}\n' + lines.join('\n');
    // 挂属性（只挂一次：同名属性重复 set 可能触发样式失效，拖动期零冗余 set）
    for (var m = 0; m < units.length; m++) {
      if (!units[m].el.hasAttribute('data-ui-reflow-unit')) units[m].el.setAttribute('data-ui-reflow-unit', String(m));
    }
  }

  function teardown() {
    if (styleEl) { styleEl.textContent = ''; }
    restoreTextSpans(); // T1：还原预览期文本包裹（span 文本移回容器原位，零残留）
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
