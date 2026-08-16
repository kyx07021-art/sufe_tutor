/**
 * 新手引导层（用户指定：明确依赖登录状态的一整层，为后续扩充预留）
 *
 * 设计：登录态上下文（onboardContext）驱动首访策略弹窗；多步走引导为独立可交互层。
 *   - onboardContext()：从 state + 本地标记解析当前引导上下文 { loggedIn, role, firstVisit }。
 *   - openOnboarding()：首访策略弹窗（主页简化版，聚焦核心特点 + 最基本流程）。
 *   - openUsageGuide()：详细用法浮窗（关于页与首访弹窗均可呼出；文案单源 constants）。
 *   - showOnboardingIfNeeded()：由 app-shell 初始化调用，按上下文决定是否弹首访。
 *   - runTour(nameOrSteps)：多步引导引擎（需求三）。全屏灰化 + 亮区 + 文字气泡；
 *     进入下一步信号 = 用户在亮区点一下（点击同时透传给元素本体，真实交互照常发生）。
 *   - startOnboardingTour()：「重温新手引导」入口，按 onboardContext 选脚本；不重置首访标记。
 *
 * 引擎要点：
 *   - target 四形态：{ page } 侧边栏 tab / { sel } 页面内任意选择器 /
 *     { closeModal } 当前弹窗（onAdvance 自动 closeModal）/ { self } 个人信息栏去登录。
 *   - 目标未挂载（上一亮区点击后页面异步加载）：rAF 轮询等待元素出现并「不在 .hidden 祖先内」
 *     （.hidden = display:none），超时（CONFIG.TOUR_TARGET_TIMEOUT_MS）自动跳过该步。
 *   - 亮区跟随：window resize / scroll（capture + passive）时重新定位。
 *   - 层高：.tour-overlay z-index 高于 modal / profile-panel / 侧栏遮罩；蒙层压暗由亮区洞的
 *     box-shadow 承担（真孔透视，目标可点）。气泡是玻璃（backdrop-filter）子树，入场用纯
 *     transform animation（复刻 modal-in），禁 transition（Chromium 983252 冻结首帧）。
 *   - 类名独立前缀 .tour-：防被表单/弹窗作用域后代选择器命中。
 * 依赖：state（登录态）、UI/CONFIG（constants）、openModal/closeModal（app-ui）、ensureAuth（运行时）。
 */

/** 解析引导上下文：登录态（state.user/role）+ 首访（sufe_returning 标记） */
function onboardContext() {
  return {
    loggedIn: !!state.user,
    role: state.user ? state.user.role : (state.guestRole || null),
    firstVisit: !isReturning(),
  };
}

/** 首访策略弹窗（内测政策小浮窗；确认按钮关掉，本机首开弹一次，也可在「关于平台」重温） */
function openOnboarding() {
  const ctx = onboardContext();
  const policyItems = UI.ONBOARD_POLICY.map(p => `<div class="onboard-policy-item"><span class="about-sec-mark glass" aria-hidden="true"></span><p>${escHtml(p)}</p></div>`).join('');
  // 登录态依赖：已登录主按钮关闭进入平台；访客主按钮「进客户端逛逛」——直接带新客进游客客户端
  // 自动跑对应角色逛一圈 tour（新手引导一分流程）；登录入口落地页常驻，随时可去
  const primary = ctx.loggedIn
    ? `<button type="button" class="btn glass glass--pressable" onclick="closeModal()">${UI.ONBOARD_CONFIRM}</button>`
    : `<button type="button" class="btn glass glass--pressable" onclick="browseAsGuest('student')">${UI.ONBOARD_CONFIRM_BROWSE}</button>`;
  openModal({
    title: UI.ONBOARD_TITLE,
    closable: false,
    body: `<p class="onboard-intro">${escHtml(UI.ONBOARD_INTRO)}</p><div class="onboard-policy">${policyItems}</div><p class="funds-note onboard-funds">${escHtml(UI.FUNDS_NOTE_SHORT)}</p>`, // 需求四：首访即明示平台不走资金（不并入 policy 保精简）
    footer: `<button type="button" class="btn btn-outline glass glass--pressable" onclick="openUsageGuide()">${UI.USAGE_GUIDE_BTN}</button>
      ${primary}`,
  });
}

/** 首访「进客户端逛逛」：关弹窗 → 进游客客户端（await 渲染完成）→ 自动跑对应角色逛一圈 tour。
 *  不能同步跟在 enterRolePreview 后跑 tour——enterClient 内部 await loadDomainScripts，
 *  客户端渲染（state.view='client'）在 await 之后，tour 引擎检测到不在客户端视图会立即收尾。 */
async function browseAsGuest(role) {
  try {
    closeModal();
    await enterRolePreview(role);
    startOnboardingTour();
  } catch (err) {
    console.warn('browseAsGuest', err); // 进客户端失败（断网/脚本 404）不弹引导：静默降级，落地页入口仍可用
  }
}

/** 详细用法介绍：分区标题 + 段落（文案单源 constants；关于页「平台基本用法」底部呼出） */
function openUsageGuide() {
  const sections = UI.USAGE_GUIDE_SECTIONS.map(s => `
      <div class="usage-guide-section">
        <h4 class="usage-guide-title">${escHtml(s.t)}</h4>
        ${s.p.map(p => `<p class="usage-guide-text">${escHtml(p)}</p>`).join('')}
      </div>`).join('');
  openModal({
    title: UI.USAGE_GUIDE_TITLE,
    cls: 'modal--wide', // 需求三十一：文本浮窗拓宽（长文介绍更舒适）
    body: `<div class="usage-guide">${sections}</div>`,
    footer: `<button type="button" class="btn glass glass--pressable" onclick="closeModal()">${UI.ONBOARD_CONFIRM}</button>`,
  });
}

/** 初始化入口：首访才弹；本设备标记常驻（登录/注册也写），访客落地也按标记不弹 */
function showOnboardingIfNeeded() {
  if (isReturning()) return;
  setReturning();
  openOnboarding();
}

// ============================================================
// 多步引导引擎（需求三：独立可交互层）
// 运行态：_tourActive 常驻开关；_tourSteps/_tourIdx 当前脚本步；_tourEls 缓存 DOM 引用。
// DOM：.tour-overlay（全屏灰化 + 点击拦截）> .tour-hole（亮区洞，box-shadow 压暗外围）+
//      .tour-bubble-pos > .tour-bubble（文字气泡 + 跳过按钮）
// ============================================================
let _tourActive = false;
let _tourSteps = [];
let _tourIdx = 0;
let _tourEls = null; // { overlay, hole, pos, bubble }

/** 解析步骤目标元素：未挂载 / 在 .hidden 祖先内（display:none）→ null（引擎等待或跳过）。
 *  closeModal 步指向弹窗本体 .modal（而非全屏 .modal-overlay）：若指向全屏 overlay，
 *  亮区 = 整个视口 → box-shadow 的压暗被推到屏幕外，背景灰化全消失（需求三·2 bug 根因）。
 *  自定义下拉：原生 select 被 initCustomSelects 包进 .custom-select 并加 .hidden——
 *  亮区改指可见的 .custom-select-trigger（点击即开下拉，真实交互照常发生）。 */
function _tourResolve(step) {
  const t = step.target || {};
  let el = null;
  if (t.page) el = document.querySelector(`#sidebar-nav .sidebar-item[data-page="${t.page}"]`);
  else if (t.sel) el = document.querySelector(t.sel);
  else if (t.closeModal) el = document.querySelector('#modal-container .modal-overlay .modal');
  else if (t.self) el = document.querySelector('#sidebar-user .sidebar-user-top');
  if (el && el.classList.contains('hidden') && el.matches('select') && el.closest('.custom-select')) {
    const trig = el.closest('.custom-select').querySelector('.custom-select-trigger');
    if (trig) el = trig;
  }
  return el && !el.closest('.hidden') ? el : null;
}

/** 挂载引导层 DOM：overlay 常驻（点击拦截），hole/bubble 每步重建定位。
 *  右上角全局「跳过引导」按钮随层挂载、随层拆除（需求三·6）：固定定位、z 高于一切，
 *  引导全程常亮；文案单源 constants UI.TOUR_SKIP_GLOBAL。 */
function _tourMount() {
  const overlay = document.createElement('div');
  overlay.className = 'tour-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', UI.TOUR_ARIA_LABEL || '新手引导');
  overlay.innerHTML = '<div class="tour-hole"></div><div class="tour-bubble-pos"></div>'
    + `<button type="button" class="tour-global-skip" onclick="event.stopPropagation();skipTour()">${escHtml(UI.TOUR_SKIP_GLOBAL)}</button>`;
  document.body.appendChild(overlay);
  _tourEls = {
    overlay,
    hole: overlay.querySelector('.tour-hole'),
    pos: overlay.querySelector('.tour-bubble-pos'),
    bubble: null,
  };
  // 整层任意点击推进——点击监听挂 overlay（覆盖全屏含亮区），
  // 不再要求「点在亮区」、不再有亮区几何判定（_tourHoleClick 连根删）
  overlay.addEventListener('click', _tourOverlayClick);
  // 网安 M2：引导期间对 AT 隐藏底层内容（aria-hidden；不用 inert——inert 会连程序化 .click() 一起禁掉，破坏亮区透传）
  const appRoot = document.getElementById('app');
  if (appRoot) appRoot.setAttribute('aria-hidden', 'true');
}

/** 渲染当前步文字气泡（重建 innerHTML 让 .tour-bubble 的入场 animation 每步重放）。
 *  不用 .glass 基类：基类带 transform transition + hover 抬升，对 bdf 子树有 983252 冻结风险；
 *  玻璃观感由 .tour-bubble 自身用 CSS 变量承担（同 .modal 预设配方）。 */
function _tourShowBubble(text) {
  const pos = _tourEls.pos;
  // 气泡内不再有「跳过」按钮（需求三·4 连根删：推进只靠点亮区/白区，跳过统一走右上角全局按钮）
  pos.innerHTML = `<div class="tour-bubble">
    <p class="tour-bubble-text">${escHtml(text)}</p>
  </div>`;
  _tourEls.bubble = pos.querySelector('.tour-bubble');
}

/** 定位亮区：JS 只切类 + transform 定位（零内联外观样式；宽高为几何量随目标变） */
function _tourPlace(el) {
  const rect = el.getBoundingClientRect();
  const hole = _tourEls.hole;
  _tourEls.overlay.classList.remove('tour-overlay--dim'); // v1.4.7：洞显示时撤占位（洞内干净——overlay 无常驻背景）
  hole.classList.add('tour-hole--show');
  hole.style.width = `${rect.width}px`;
  hole.style.height = `${rect.height}px`;
  hole.style.transform = `translate(${rect.left}px, ${rect.top}px)`; // fixed 元素 translate 定位
  _tourPlaceBubble(rect);
}

/** 亮区隐藏（等待目标出现期间） */
function _tourHideHole() {
  _tourEls.hole.classList.remove('tour-hole--show');
  _tourEls.overlay.classList.add('tour-overlay--dim'); // v1.4.7：洞隐藏时弱压暗占位（防闪回亮屏——需求五十三初衷，遮罩只此一层）
}

// ---- 就位稳定化：对滚动/动画不做特例，统一「先滚出目标 → 等入场动画结束 → 再定位亮区」----
// 每个步骤统一走「先滚出目标 → 等入场动画结束 → 再定位亮区」：
//   滚动：目标在默认展示范围之外时（报价区间/保存/设置页后半/反馈通道等），先通知页面层滚进来再打洞——
//   支持 step.scrollTo 选填绑定页面元素（缺省滚目标本身）；已完全在视口内的目标不滚（侧栏等天然命中）。
//   动画：资料栏/modal 滑入中的 getBoundingClientRect 是中间帧几何，亮区/气泡会卡屏幕外——
//   _tourAnimating 等祖先链动画结束（含 transition，getAnimations 一并返回）再定位，最长 2s 防永动动画卡死。

/** 最近可滚动祖先 = 该目标的滚动视口（主内容区 .client-main 内滚、侧栏 .sidebar-scroll 内滚，非窗口）。
 *  带宽判据须用容器自身高度，不能用 window.innerHeight（容器在视口内有偏移/不等高）。 */
function _tourScrollViewport(el) {
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    if (n === document.documentElement || n === document.scrollingElement || n === document.body) break;
    try {
      const st = getComputedStyle(n);
      if (/(auto|scroll|overlay)/.test(st.overflowY) && n.clientHeight > 0) return n;
    } catch (err) { /* 忽略 */ }
  }
  return document.scrollingElement || document.documentElement;
}

/** 目标滚入滚动容器中带：滚动须让目标中心落在容器可视区 30%~70% 竖带。
 *  判据从「完全可见即跳过」收紧为「中心在 30%~70% 且完全可见才跳过」——贴边可见（顶部/底部边缘）
 *  也要滚入中带，亮区不压在容器边缘；block:'center' 居中落点（容器边缘不可居中时尽力即可）。
 *  instant 滚动防平滑动画与亮区几何竞态。 */
function _tourScrollToEl(el) {
  if (!el || typeof el.scrollIntoView !== 'function') return; // jsdom 无 scrollIntoView（测试零开销）
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return; // 未布局，跳过
  const vw = window.innerWidth || document.documentElement.clientWidth || 1024;
  const vp = _tourScrollViewport(el);
  const vr = vp.getBoundingClientRect();
  const vh = vp.clientHeight || window.innerHeight || 768;
  const top = r.top - vr.top; // 目标在滚动容器内的相对位置
  const center = top + (r.bottom - r.top) / 2;
  const bandLo = CONFIG.TOUR_SCROLL_BAND_LO || 0.3;
  const bandHi = CONFIG.TOUR_SCROLL_BAND_HI || 0.7;
  const inBand = center >= vh * bandLo && center <= vh * bandHi;
  const visible = r.top >= vr.top && r.left >= 0 && r.bottom <= vr.top + vh && r.right <= vw;
  if (inBand && visible) return;
  try { el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' }); } catch (err) { /* 不阻断步进 */ }
}

/** 目标或其祖先链是否有运行中的动画/过渡（入场动画竞态根因） */
function _tourAnimating(el) {
  if (!el || typeof el.getAnimations !== 'function') return false;
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    try { if (n.getAnimations().some(a => a.playState === 'running')) return true; } catch (err) { /* 忽略 */ }
  }
  return false;
}

/** R27：亮区动态绑定——定位后持续跟随目标几何变化（rAF 逐帧对比 rect，位置变了即重定位）。
 *  根治「先亮后浮入」「筛选后卡片被顶跑」「关于平台浮入错位」类错位（反馈：每个带卡片模块第一条介绍都有）：
 *  一次性定位只能覆盖定位时静止的目标；异步渲染/延迟入场/布局挤压在定位后仍会位移。
 *  跟随循环以 _tourIdx 快照判定归属步骤——步骤推进（_tourNext 自增）或收尾（_tourActive=false）即停。
 *  目标消失（页面重建间隙）隐藏亮区，下一帧出现即恢复。开销 = 每帧一次 getBoundingClientRect，位置不变零写入。 */
function _tourStartFollow(step) {
  const followIdx = _tourIdx;
  let lastKey = '';
  const loop = () => {
    if (!_tourActive || _tourIdx !== followIdx) return; // 已步进/已收尾 → 停止跟随
    if (!_tourInClientView()) { _tourCleanup(); return; } // 视图切走 → 收尾（同等待轮询口径）
    const el = _tourResolve(step);
    if (!el) { _tourHideHole(); requestAnimationFrame(loop); return; }
    const r = el.getBoundingClientRect();
    const key = Math.round(r.left) + 'x' + Math.round(r.top) + 'x' + Math.round(r.width) + 'x' + Math.round(r.height);
    if (key !== lastKey) { lastKey = key; _tourPlace(el); }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

/** 就位定位（稳定化）：滚入视口 → 等入场动画结束 → 定位亮区 → 启动动态跟随。
 *  常见路径（目标已稳定、无动画）同步定位——零额外帧，测试与交互即时；
 *  仅当目标祖先链有运行中的动画/过渡（资料栏/modal 滑入中）才进入 rAF 等待（最长 2s 防永动动画卡死）。
 *  scrollIntoView 同步触发布局，滚后立即 getBoundingClientRect 即最终几何，无需等 scroll 事件。 */
function _tourPlaceStable(step) {
  const el = _tourResolve(step);
  if (!el) { _tourHideHole(); return; }
  const scrollEl = (step.scrollTo ? document.querySelector(step.scrollTo) : null) || el;
  _tourScrollToEl(scrollEl);
  if (!_tourAnimating(el) && !_tourAnimating(scrollEl)) { _tourPlace(el); _tourStartFollow(step); return; }
  const deadline = Date.now() + 2000; // 动画最长等 2s，防永动动画卡死亮区
  const tick = () => {
    if (!_tourActive) return;
    const cur = _tourResolve(step);
    if (!cur) { _tourHideHole(); return; }
    if (Date.now() < deadline && (_tourAnimating(cur) || _tourAnimating(scrollEl))) { requestAnimationFrame(tick); return; }
    _tourPlace(cur);
    _tourStartFollow(step); // R27：动画结束定位后启动动态跟随
  };
  requestAnimationFrame(tick);
}

/** 气泡落位：目标旁（右→左→下→上），**永不与亮区重叠**（架构审计 H1：此前兜底钳制会把气泡压到亮区正上方，
 *  移动端贴边目标点「亮区」实际点到气泡 → 步进失效）。最后兜底贴视口底（亮区通常在上方）；
 *  另 .tour-bubble-pos z 高于 .tour-hole 但 pointer-events:none——即使极小视口重叠，点击仍穿透到洞。 */
function _tourPlaceBubble(rect) {
  const pos = _tourEls.pos;
  const gap = CONFIG.TOUR_GAP_PX || 16;
  const vw = window.innerWidth || document.documentElement.clientWidth || 1024;
  const vh = window.innerHeight || document.documentElement.clientHeight || 768;
  pos.style.transform = 'translate(-9999px,-9999px)'; // 先移出屏幕测真实尺寸
  const bw = _tourEls.bubble.offsetWidth || 300;
  const bh = _tourEls.bubble.offsetHeight || 90;
  let x, y;
  if (rect.right + gap + bw <= vw) {            // 右侧优先（上下对齐目标顶）
    x = rect.right + gap;
    y = Math.max(8, Math.min(rect.top, vh - bh - 8));
  } else if (rect.left - gap - bw >= 0) {        // 其次左侧
    x = rect.left - gap - bw;
    y = Math.max(8, Math.min(rect.top, vh - bh - 8));
  } else if (rect.bottom + gap + bh <= vh) {     // 左右放不下 → 下方（水平对齐目标左，钳制视口）
    x = Math.max(8, Math.min(rect.left, vw - bw - 8));
    y = rect.bottom + gap;
  } else if (rect.top - gap - bh >= 0) {         // 再上方
    x = Math.max(8, Math.min(rect.left, vw - bw - 8));
    y = rect.top - gap - bh;
  } else {                                       // 极小视口兜底：贴底（亮区在上方不重叠），仍可点跳过
    x = 8;
    y = vh - bh - 8;
  }
  pos.style.transform = `translate(${x}px, ${y}px)`;
}

/** 引导是否仍在客户端壳视图（侧栏/页面都在 view-client 内；登出/切走即失位 → 立即收尾，防蒙层滞留） */
function _tourInClientView() {
  return !!state && state.view === 'client';
}

/** 进入当前步：渲染气泡 → 解析目标（就位即定位；否则 rAF 轮询等待，超时自动跳步） */
function _tourStartStep() {
  if (!_tourActive) return;
  if (!_tourInClientView()) { _tourCleanup(); return; } // 网安 M2：视图切走（登出落 landing）→ 立即收尾，不等 3s 逐步超时
  try {
    // v1.4.4：函数式步骤（到达时才求值——页面已切换可读 DOM 判状态：学信网门控/示例会话注入）。
    // v1.4.5（审计修复）：求值结果不写回 _tourSteps（保留原始函数）——retry 时重新求值；
    // tick 轮询同样重新求值（目标 DOM 异步渲染完成后函数式步骤才能给出正确分支）
    const stepOf = () => { let s = _tourSteps[_tourIdx]; while (typeof s === 'function') s = s(); return s; };
    const step = stepOf();
    if (step && step.retry) { // v1.4.5：停留重试（目标异步渲染未完成——学信网门控判断需等 applyChsiGate 落定）
      _tourShowBubble(step.text || '');
      _tourHideHole();
      const waitIdx = _tourIdx;
      setTimeout(() => { if (_tourActive && _tourIdx === waitIdx) _tourStartStep(); }, CONFIG.TOUR_RETRY_MS || 350);
      return;
    }
    if (step && step.skip) { _tourNext(); return; } // v1.4.4：skip 步骤（条件不成立时直接推进，如未验证学信网时跳过表单介绍）
    if (!step) { _tourCleanup(); return; }
    _tourShowBubble(step.text);
    const el = _tourResolve(step);
    if (el) { _tourPlaceStable(step); return; } // 滚入视口 + 等入场动画后才定位（架构修复）
    _tourHideHole();
    const waitStep = _tourIdx;
    const start = Date.now();
    const tick = () => {
      if (!_tourActive || _tourIdx !== waitStep) return; // 已跳走/已结束
      if (!_tourInClientView()) { _tourCleanup(); return; } // 等待中视图切走 → 收尾
      if (Date.now() - start > CONFIG.TOUR_TARGET_TIMEOUT_MS) { _tourNext(); return; }
      const cur = stepOf(); // v1.4.5：重求值（函数式步骤可能已随异步渲染改变分支）
      if (cur && cur.retry) { _tourHideHole(); requestAnimationFrame(tick); return; } // 仍未就绪：继续等
      const found = cur ? _tourResolve(cur) : null;
      if (found) { _tourPlaceStable(cur); return; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  } catch (err) {
    // 网安 L5：步渲染意外异常不留下永久蒙层——清理收尾（控制台留痕，不静默吞）
    console.error('onboarding tour step error', err);
    _tourCleanup();
  }
}

/** 前进到下一步（末步则收尾） */
function _tourNext() {
  if (!_tourActive) return;
  if (_tourIdx >= _tourSteps.length - 1) { _tourCleanup(); return; }
  _tourIdx++;
  _tourStartStep();
}

/** 整层任意点击推进——不再要求「点在亮区」。
 *  卡死根治：目标不存在（空大厅/需求全签/异步未加载）时点任意处照样进入下一步；
 *  原「点在亮区的几何判定」与 M1 漂移守卫逻辑连根删（布局错位不再拦截步进，简化交互模型）。
 *  每次推进仍执行步动作（onAdvance + 目标存在则透传真实点击），引导中的真实交互照常发生。 */
function _tourOverlayClick(e) {
  e.preventDefault();
  e.stopPropagation();
  if (e.target.closest && e.target.closest('.tour-global-skip')) return; // 跳过按钮自身处理（inline stopPropagation 双保险）
  let step = _tourSteps[_tourIdx];
  while (typeof step === 'function') step = step(); // v1.4.8：函数式步骤求值后再 advance（透传 el.click 需要真实 target——生产验证 F2 抓出：demo conv 点击从未触发）
  if (!step) return;
  if (_tourIdx >= _tourSteps.length - 1) {
    // 末步：先收尾再执行动作——登录/资料栏步会跳走，不能留蒙层挡新视图
    _tourCleanup();
    _tourAdvanceAction(step);
    return;
  }
  _tourAdvanceAction(step);
  _tourIdx++;
  _tourStartStep();
}

/** 执行当前步的副作用：onAdvance + 透传真实点击（closeModal 步不透传，onAdvance 已关）。
 *  点击拦截：step.pass===false 不透传真实点击——
 *  有些穿透是为了打开/切换页面（保留），提交/开关类真实请求（试课意向/屏蔽系统通知/保存等）该拦的拦。 */
function _tourAdvanceAction(step) {
  const t = step.target || {};
  if (t.closeModal) {
    if (typeof step.onAdvance === 'function') step.onAdvance();
    else closeModal();
    return;
  }
  if (typeof step.onAdvance === 'function') step.onAdvance();
  if (step.pass === false) return; // 点击拦截：只讲解推进，不发真实请求
  const el = _tourResolve(step);
  if (el) { try { el.click(); } catch (err) { /* 目标不可点不阻断步进 */ } }
}

/** 亮区跟随：窗口尺寸 / 滚动（capture 捕获内部滚动容器）时重新定位 */
function _tourReposition() {
  if (!_tourActive) return;
  let step = _tourSteps[_tourIdx];
  while (typeof step === 'function') step = step(); // v1.4.8：函数式步骤求值（否则 target undefined → 亮区被 hide）
  if (!step) return;
  const el = _tourResolve(step);
  if (el) _tourPlace(el); else _tourHideHole();
}

/** 收尾：拆除引导层 DOM + 监听 + aria-hidden 还原，复位运行态 */
function _tourCleanup() {
  _tourActive = false;
  _tourSteps = [];
  _tourIdx = 0;
  if (_tourEls) {
    _tourEls.overlay.remove();
    _tourEls = null;
    const appRoot = document.getElementById('app');
    if (appRoot) appRoot.removeAttribute('aria-hidden'); // 网安 M2：还原 AT 可见性
  }
  window.removeEventListener('resize', _tourReposition);
  window.removeEventListener('scroll', _tourReposition, { capture: true });
  window.removeEventListener('keydown', _tourKeydown); // 网安 M3：Esc 退出
  _tourDemoChatCleanup(); // v1.4.4：引导结束移除示例会话（完成/跳过/视图切走统一收尾）
}

/** 键盘 Esc 退出引导（网安 M3：主交互对键盘可达——Esc 等效「跳过」） */
function _tourKeydown(e) {
  if (e.key === 'Escape') skipTour();
}

/** 运行引导：name 为脚本名（TOUR_SCRIPTS 键），或直接传 steps 数组（测试用）。
 *  runTour 是内部引导入口，生产调用只传硬编码脚本名；target 的 page 均来自 ROLE_PAGES 常量、
 *  sel 为常量选择器——信任边界注释：不对外部输入开放任意选择器 */
function runTour(nameOrSteps) {
  _tourCleanup();
  const steps = Array.isArray(nameOrSteps)
    ? nameOrSteps
    : (TOUR_SCRIPTS[nameOrSteps] ? TOUR_SCRIPTS[nameOrSteps]() : null);
  if (!steps || !steps.length) return;
  _tourActive = true;
  _tourSteps = steps;
  _tourIdx = 0;
  _tourMount();
  window.addEventListener('resize', _tourReposition);
  window.addEventListener('scroll', _tourReposition, { passive: true, capture: true });
  window.addEventListener('keydown', _tourKeydown);
  _tourStartStep();
}

/** 跳过引导：右上角全局按钮 + Esc 统一收尾（需求三·6：跳过入口全局常亮，这才是跳过按钮的正确用法） */
function skipTour() { _tourCleanup(); }

// 登出复位（app-state registerLogoutReset 协议）：引导停在「等待点击」态时登出 → 立即收尾，
// 不残留全屏拦截层盖住落地页（审计修复：此前只在步骤推进/等待轮询时 _tourInClientView 检查，
// 等待用户点击的纯等待态会滞留覆盖层，直到用户再点任意处才触发清理）
if (typeof registerLogoutReset === 'function') {
  registerLogoutReset(() => { if (_tourActive) skipTour(); });
}

/**
 * 「重温新手引导」入口：按登录态 + 角色选脚本（管理员走审核工作台脚本）；
 * 不重置 sufe_returning 首访标记（仅首次访问自动弹窗用）。
 */
function startOnboardingTour() {
  const ctx = onboardContext();
  const script = ctx.loggedIn
    ? (ctx.role === 'admin' ? 'admin' : ctx.role === 'teacher' ? 'teacherUser' : 'studentUser')
    : (ctx.role === 'teacher' ? 'teacherGuest' : 'studentGuest'); // 访客 role = guestRole
  runTour(script);
}

// ============================================================
// 五份引导脚本（需求三：主页老浮窗 / 教师·学生·登录前·登录后）
// 每个模块的步骤拆成独立组件函数（每模块 ≥3 次交互，真实探进页面转一圈），
// 按脚本顺序拼接 → 追加新功能 = 加一个函数并插入对应脚本。
// 访客脚本只引导可见模块（不点会走登录通路的按钮）；登录后脚本引导角色全部模块。
// ============================================================

// ---- 需求大厅（教师）----
function tourStepBrowseDemands()    { return { module: 'browse-demands', target: { page: 'browse-demands' }, text: UI.TOUR_STEP_BROWSE_DEMANDS }; }
function tourStepDemandList()       { return { module: 'browse-demands', target: { sel: '#demands-list' },   text: UI.TOUR_STEP_DEMAND_LIST }; }
function tourStepDemandCard(module = 'browse-demands') { return { module, target: { sel: module === 'my-demands' ? '#my-demands-list .list-card--demand' : '#demands-list .list-card--demand' }, text: UI.TOUR_STEP_DEMAND_CARD }; }
// v1.4.4（用户反馈）：卡面介绍点击会打开详情浮窗——加详情介绍步 + 关闭步，不再让详情页晾在灰化区
function tourStepDemandDetail(module = 'browse-demands')     { return { module, target: { sel: '.modal .demand-detail' }, text: UI.TOUR_STEP_DEMAND_DETAIL }; }
function tourStepDemandDetailClose(module = 'browse-demands'){ return { module, target: { closeModal: true }, text: UI.TOUR_STEP_DEMAND_DETAIL_CLOSE }; }
// 「提交试课意向」= 真实提交请求，点击拦截不透传（只讲解推进）
function tourStepDemandIntentBtn()  { return { module: 'browse-demands', target: { sel: '#demands-list .btn-intent-cta' },   text: UI.TOUR_STEP_DEMAND_INTENT_BTN, pass: false }; }
function tourStepDemandIdTag()      { return { module: 'browse-demands', target: { sel: '#demands-list .demand-id-tag' },     text: UI.TOUR_STEP_DEMAND_ID_TAG }; }

// ---- 浏览教师（教师广场 / 教师同行）----
function tourStepBrowseTeachers()     { return { module: 'browse-teachers', target: { page: 'browse-teachers' }, text: UI.TOUR_STEP_BROWSE_TEACHERS }; }
function tourStepBrowseTeachersPeer() { return { module: 'browse-teachers', target: { page: 'browse-teachers' }, text: UI.TOUR_STEP_BROWSE_TEACHERS_PEER }; }
function tourStepTeachersList()       { return { module: 'browse-teachers', target: { sel: '#teachers-list' },   text: UI.TOUR_STEP_TEACHERS_LIST }; }
function tourStepFilterToggle()       { return { module: 'browse-teachers', target: { sel: '#filter-toggle-btn' }, text: UI.TOUR_STEP_FILTER_TOGGLE, pass: false }; } // v1.4.7：打开筛选面板没人关（用户反馈）——点击拦截只讲解
function tourStepFilterSubject()      { return { module: 'browse-teachers', target: { sel: '#filter-subject' },  text: UI.TOUR_STEP_FILTER_SUBJECT, pass: false }; } // v1.4.7：打开科目下拉没人关——点击拦截只讲解
// 可点性在整卡（.list-card--teacher 承载点击），亮区改指整卡而非用户名文本
function tourStepTeacherUsername()    { return { module: 'browse-teachers', target: { sel: '#teachers-list .list-card--teacher' }, text: UI.TOUR_STEP_TEACHER_USERNAME }; }
function tourStepProfileClose()       { return { module: 'browse-teachers', target: { sel: '#profile-panel-close' }, text: UI.TOUR_STEP_PROFILE_CLOSE }; }
function tourStepTeacherPushBtn()     { return { module: 'browse-teachers', target: { sel: '#teachers-list .tc-push-btn' }, text: UI.TOUR_STEP_TEACHER_PUSH_BTN }; }
function tourStepPushModal()          { return { module: 'browse-teachers', target: { closeModal: true }, text: UI.TOUR_STEP_PUSH_MODAL }; }

// ---- 资料共享（教师）----
function tourStepResourceShare()  { return { module: 'resource-share', target: { page: 'resource-share' }, text: UI.TOUR_STEP_RESOURCE_SHARE }; }
function tourStepPostsList()      { return { module: 'resource-share', target: { sel: '#posts-list' },     text: UI.TOUR_STEP_POSTS_LIST }; }
function tourStepPostsSearch()    { return { module: 'resource-share', target: { sel: '#posts-search' },   text: UI.TOUR_STEP_POSTS_SEARCH }; }
function tourStepPostsSort()      { return { module: 'resource-share', target: { sel: '#posts-sort' },     text: UI.TOUR_STEP_POSTS_SORT }; }
function tourStepPostsCreate()    { return { module: 'resource-share', target: { sel: '#posts-content .posts-create-btn' }, text: UI.TOUR_STEP_POSTS_CREATE }; }
function tourStepPostsModal()     { return { module: 'resource-share', target: { closeModal: true }, text: UI.TOUR_STEP_POSTS_MODAL }; }

// ---- 我的会话 ----
// v1.4.4（用户反馈）：新用户无会话，会话组件介绍无从谈起——引导期间注入「示例教师/示例学生」会话
//（空白会话记录，仅展示会话窗口组件；引导外自动隐藏——_tourDemoChatCleanup 在 _tourCleanup 统一移除）。
function tourStepMyChats() { _tourDemoChatEnsure(); return { module: 'my-chats', target: { page: 'my-chats' }, text: UI.TOUR_STEP_MY_CHATS }; } // 注入轮询自续（_tourDemoChatEnsure 内 setTimeout 幂等重试——页面切到 my-chats、conv-list 渲染完成后注入），无需函数式
// 注入示例会话：对侧角色命名（教师用户看到「示例学生」，学生用户看到「示例教师」）
function _tourDemoChatEnsure() {
  const list = document.getElementById('conv-list');
  if (!list || list.querySelector('.tour-demo-conv')) return;
  // v1.4.5（审计修复）：renderConvList 是异步——注入过早会被其 innerHTML 重建冲掉；
  // 轮询等 loader 移除（渲染完成——含空态，新用户无会话正是要注入的场景）再注入（幂等）
  if (list.querySelector('.loader')) {
    setTimeout(_tourDemoChatEnsure, 200);
    return;
  }
  const empty = list.querySelector('.empty-state');
  if (empty) empty.remove(); // 注入示例会话后空态不再成立
  const teacherView = state.user && state.user.role === 'teacher';
  const demoName = teacherView ? UI.TOUR_DEMO_CHAT_NAME_TEACHER : UI.TOUR_DEMO_CHAT_NAME_STUDENT;
  const demoRole = teacherView ? UI.CHAT_ROLE_STUDENT : UI.CHAT_ROLE_TEACHER;
  list.insertAdjacentHTML('afterbegin', `<button type="button" class="conv-item tour-demo-conv" data-conv-id="demo" onclick="demoOpenConversation()">
    <span class="conv-item-top">
      <span class="conv-item-name">${escHtml(demoName)}</span>
      <span class="conv-item-role glass glass--solid">${escHtml(demoRole)}</span>
    </span>
    <span class="conv-item-preview">${escHtml(UI.TOUR_DEMO_CHAT_PREVIEW)}</span>
  </button>`);
}
// 打开示例会话：不走真实请求（空白会话记录），仅渲染会话窗口组件供引导介绍
function demoOpenConversation() {
  closeChatPlus();
  stopChatPolling();
  document.querySelectorAll('#conv-list .conv-item').forEach(b =>
    b.classList.toggle('active', b.dataset.convId === 'demo'));
  const shell = document.getElementById('chats-shell');
  if (shell) shell.classList.add('chats-show-chat');
  const pane = document.getElementById('chat-pane');
  if (!pane) return;
  const teacherView = state.user && state.user.role === 'teacher';
  const demoName = teacherView ? UI.TOUR_DEMO_CHAT_NAME_TEACHER : UI.TOUR_DEMO_CHAT_NAME_STUDENT;
  const demoRole = teacherView ? UI.CHAT_ROLE_STUDENT : UI.CHAT_ROLE_TEACHER;
  pane.innerHTML = renderChatFrame({ id: 'demo', peer: { name: demoName, role: demoRole }, status: 'active' });
  const box = document.getElementById('chat-messages');
  if (box) box.innerHTML = `<div class="empty-state empty-state--small"><p>${escHtml(UI.TOUR_DEMO_CHAT_EMPTY)}</p></div>`;
}
// 引导收尾移除示例会话；若示例会话打开中还原聊天窗占位（引导外自动隐藏）
function _tourDemoChatCleanup() {
  const list = document.getElementById('conv-list');
  if (list) list.querySelectorAll('.tour-demo-conv').forEach(el => el.remove());
  const pane = document.getElementById('chat-pane');
  if (pane && pane.querySelector('.chat-messages') && !chatConvId) pane.innerHTML = renderChatPlaceholder();
}
// v1.4.8 修复（生产验证 F2 失败：示例会话未注入）：tourStepMyChats 是 page 目标（点击才切页，
// 数组生成时 conv-list 不存在——_tourDemoChatEnsure 在生成时执行永远 return）。注入移到切页后的
// 本步（函数式——到达时页面已切 my-chats、conv-list 已渲染）——轮询等 renderConvList 完成再注入。
function tourStepConvItem()      { return () => { _tourDemoChatEnsure(); return { module: 'my-chats', target: { sel: '#conv-list .conv-item' }, text: UI.TOUR_STEP_CONV_ITEM }; }; }
function tourStepChatMessages()  { return { module: 'my-chats', target: { sel: '#chat-messages' }, text: UI.TOUR_STEP_CHAT_MESSAGES }; }
function tourStepChatSend()      { return { module: 'my-chats', target: { sel: '#chat-send-btn' }, text: UI.TOUR_STEP_CHAT_SEND }; }
function tourStepChatPlus()      { return { module: 'my-chats', target: { sel: '.chat-plus-btn' }, text: UI.TOUR_STEP_CHAT_PLUS }; }
// + 号唤出功能栏后逐个介绍项目——真实点击会发请求/开弹窗/文件选择器，一律拦截不透传
function tourStepChatPlusItem(i, text) { return { module: 'my-chats', target: { sel: `.chat-plus-pop .chat-pop-item:nth-child(${i})` }, text, pass: false }; }
const tourStepChatPlusImage   = () => tourStepChatPlusItem(1, UI.TOUR_STEP_CHAT_PLUS_IMAGE);
const tourStepChatPlusFile    = () => tourStepChatPlusItem(2, UI.TOUR_STEP_CHAT_PLUS_FILE);
const tourStepChatPlusSigning = () => tourStepChatPlusItem(3, UI.TOUR_STEP_CHAT_PLUS_SIGNING);
const tourStepChatPlusDraft   = () => tourStepChatPlusItem(4, UI.TOUR_STEP_CHAT_PLUS_DRAFT);

// ---- 我的合同 ----
function tourStepMyContracts()     { return { module: 'my-contracts', target: { page: 'my-contracts' }, text: UI.TOUR_STEP_MY_CONTRACTS }; }
function tourStepContractsList()   { return { module: 'my-contracts', target: { sel: '#my-contracts-list' }, text: UI.TOUR_STEP_CONTRACTS_LIST }; }
function tourStepContractCard()    { return { module: 'my-contracts', target: { sel: '#my-contracts-list .list-card' }, text: UI.TOUR_STEP_CONTRACT_CARD }; }
function tourStepContractActions() { return { module: 'my-contracts', target: { sel: '#my-contracts-list .contract-actions' }, text: UI.TOUR_STEP_CONTRACT_ACTIONS }; }

// ---- 个人资料（教师编辑档案）----
// v1.4.4（用户反馈）：教师信息页已学信网门控——默认引导引导尽快上传学信网证明；
// 已验证用户走模块引导（介绍表单组件），信息项介绍保留供重温（状态判断自动切换）。
function tourStepEditProfile() { return { module: 'edit-profile', target: { page: 'edit-profile' }, text: UI.TOUR_STEP_EDIT_PROFILE }; }
// v1.4.5 修正：验证门步（切页后、表单步骤前）——applyChsiGate（async，dhGet profile 后落定）落定前
// gate/info 骨架 hidden，无法区分未验证/已验证 → retry 停留重试；落定后：未验证 → 验证门引导、
// 已验证 → skip（表单步骤照常）。注意：等待必须在此步（页面已切、initProfileForm 已触发），
// 不能放在 edit-profile 入口步（页面未切时 applyChsiGate 不会跑——retry 死循环，生产实证）。
function tourStepChsiGate() { return () => {
  const gate = document.getElementById('chsi-gate');
  const info = document.getElementById('chsi-info');
  const gateReady = gate && !gate.classList.contains('hidden');
  const verifiedReady = info && !info.classList.contains('hidden');
  if (!gateReady && !verifiedReady) return { retry: true, text: UI.TOUR_STEP_CHSI_GATE };
  return gateReady
    ? { module: 'edit-profile', target: { sel: '#chsi-gate' }, text: UI.TOUR_STEP_CHSI_GATE }
    : { skip: true };
}; }
// 表单介绍步骤：未验证学信网时表单不存在 → skip（验证门引导已覆盖，无需逐项介绍）
function _tourProfileFormStep(stepFn) { return () => {
  const gate = document.getElementById('chsi-gate');
  const info = document.getElementById('chsi-info');
  const gateReady = gate && !gate.classList.contains('hidden');
  const verifiedReady = info && !info.classList.contains('hidden');
  if (!gateReady && !verifiedReady) return { retry: true, text: stepFn().text }; // 门控未落定：停留重试（防御——验证门步已等过）
  return gateReady ? { skip: true } : stepFn(); // 未验证：表单隐藏跳过；已验证：正常介绍
}; }
function tourStepProfileForm()      { return _tourProfileFormStep(() => ({ module: 'edit-profile', target: { sel: '.profile-form' }, text: UI.TOUR_STEP_PROFILE_FORM })); }
function tourStepProfileSubjects()  { return _tourProfileFormStep(() => ({ module: 'edit-profile', target: { sel: '#profile-subjects' }, text: UI.TOUR_STEP_PROFILE_SUBJECTS })); }
function tourStepProfilePrice()     { return _tourProfileFormStep(() => ({ module: 'edit-profile', target: { sel: '#profile-price-min' }, text: UI.TOUR_STEP_PROFILE_PRICE })); }
function tourStepProfileAwards()    { return _tourProfileFormStep(() => ({ module: 'edit-profile', target: { sel: '#profile-awards-list' }, text: UI.TOUR_STEP_PROFILE_AWARDS })); }
// 「保存」= 真实提交请求，点击拦截不透传；默认滚动架构自动把按钮滚进视口（反馈 #131）
function tourStepProfileSubmit()    { return _tourProfileFormStep(() => ({ module: 'edit-profile', target: { sel: '#profile-submit' }, text: UI.TOUR_STEP_PROFILE_SUBMIT, pass: false })); }

// ---- 通知 ----
function tourStepNotifications() { return { module: 'notifications', target: { page: 'notifications' }, text: UI.TOUR_STEP_NOTIFICATIONS }; }
function tourStepNotifList()     { return { module: 'notifications', target: { sel: '#notifications-content' }, text: UI.TOUR_STEP_NOTIF_LIST }; }
function tourStepNotifItem()     { return { module: 'notifications', target: { sel: '.notif-item' }, text: UI.TOUR_STEP_NOTIF_ITEM }; }
// 「屏蔽系统通知」= 真实偏好开关 + 请求，点击拦截不透传
function tourStepNotifBlock()    { return { module: 'notifications', target: { sel: '#btn-notif-block' }, text: UI.TOUR_STEP_NOTIF_BLOCK, pass: false }; }

// ---- 设置 ----
function tourStepAccountSettings()     { return { module: 'account-settings', target: { page: 'account-settings' }, text: UI.TOUR_STEP_ACCOUNT_SETTINGS }; }
function tourStepSettingsAccount()     { return { module: 'account-settings', target: { sel: '.settings-row--avatar' }, text: UI.TOUR_STEP_SETTINGS_ACCOUNT }; }
function tourStepSettingsTheme()       { return { module: 'account-settings', target: { sel: '.theme-opt' }, text: UI.TOUR_STEP_SETTINGS_THEME }; }
function tourStepSettingsUiScale()     { return { module: 'account-settings', target: { sel: '.ui-scale-slider' }, text: UI.TOUR_STEP_SETTINGS_UI_SCALE }; }
function tourStepSettingsLogout()      { return { module: 'account-settings', target: { sel: '.settings-logout' }, text: UI.TOUR_STEP_SETTINGS_LOGOUT }; }
function tourStepSettingsLogoutModal() { return { module: 'account-settings', target: { closeModal: true }, text: UI.TOUR_STEP_SETTINGS_LOGOUT_MODAL }; }

// ---- 关于平台 ----
function tourStepAbout()          { return { module: 'about', target: { page: 'about' }, text: UI.TOUR_STEP_ABOUT }; }
function tourStepAboutWho()       { return { module: 'about', target: { sel: '.about-card' }, text: UI.TOUR_STEP_ABOUT_WHO }; }
function tourStepAboutFlow()      { return { module: 'about', target: { sel: '.about-flow' }, text: UI.TOUR_STEP_ABOUT_FLOW }; }
function tourStepAboutSecurity()  { return { module: 'about', target: { sel: '.about-security-list' }, text: UI.TOUR_STEP_ABOUT_SECURITY }; }
function tourStepAboutFeedback()  { return { module: 'about', target: { sel: '.about-feedback-btns' }, text: UI.TOUR_STEP_ABOUT_FEEDBACK }; }

// ---- 我的需求（学生）----
function tourStepMyDemands()      { return { module: 'my-demands', target: { page: 'my-demands' }, text: UI.TOUR_STEP_MY_DEMANDS }; }
function tourStepMyDemandsList()  { return { module: 'my-demands', target: { sel: '#my-demands-list' }, text: UI.TOUR_STEP_MY_DEMANDS_LIST }; }
function tourStepIntentToggle()   { return { module: 'my-demands', target: { sel: '#my-demands-list .btn-intent-toggle' }, text: UI.TOUR_STEP_INTENT_TOGGLE }; }
function tourStepNewDemandBtn()   { return { module: 'my-demands', target: { sel: '#btn-new-demand' }, text: UI.TOUR_STEP_NEW_DEMAND_BTN }; }
function tourStepDemandWizard()    { return { module: 'my-demands', target: { sel: '#demand-form .dw-step' }, text: UI.TOUR_STEP_DEMAND_WIZARD }; }
function tourStepNewDemandModal() { return { module: 'my-demands', target: { closeModal: true }, text: UI.TOUR_STEP_NEW_DEMAND_MODAL }; }

// ---- 末步（不计入模块统计）----
function tourStepGuestLogin()     { return { module: 'end', target: { self: true }, text: UI.TOUR_STEP_GUEST_LOGIN }; }
function tourStepUserBar()        { return { module: 'end', target: { self: true }, text: UI.TOUR_STEP_USER_BAR }; }

// ---- 管理员（运营角色：审核工作台全览）----
function tourStepAdminStats()    { return { module: 'admin-stats', target: { page: 'admin-stats' }, text: UI.TOUR_STEP_ADMIN_STATS }; }
function tourStepAdminTodo()     { return { module: 'admin-stats', target: { sel: '.todo-panel' }, text: UI.TOUR_STEP_ADMIN_TODO }; }
function tourStepAdminAwards()   { return { module: 'admin-awards', target: { page: 'admin-awards' }, text: UI.TOUR_STEP_ADMIN_AWARDS }; }
function tourStepAdminContent()  { return { module: 'admin-content', target: { page: 'admin-content' }, text: UI.TOUR_STEP_ADMIN_CONTENT }; }
function tourStepAdminEnd()      { return { module: 'end', target: { self: true }, text: UI.TOUR_STEP_ADMIN_END }; }

const TOUR_SCRIPTS = {
  // 管理员：审核工作台（统计待办 → 奖项审核 → 内容审核）
  admin: () => [
    tourStepAdminStats(),
    tourStepAdminTodo(),
    tourStepAdminAwards(),
    tourStepAdminContent(),
    tourStepAdminEnd(),
  ],
  // 教师登录前：可访问区域（需求大厅 / 教师同行 / 资料共享 / 关于）+ 末步引导登录
  teacherGuest: () => [
    tourStepBrowseDemands(),
    tourStepDemandList(),
    tourStepDemandCard(),
    tourStepDemandDetail(),
    tourStepDemandDetailClose(),
    tourStepDemandIdTag(),
    tourStepBrowseTeachersPeer(),
    tourStepTeachersList(),
    tourStepFilterToggle(),
    tourStepTeacherUsername(),
    tourStepProfileClose(),
    tourStepResourceShare(),
    tourStepPostsList(),
    tourStepPostsSearch(),
    tourStepPostsSort(),
    tourStepAbout(),
    tourStepAboutWho(),
    tourStepAboutFlow(),
    tourStepAboutSecurity(),
    tourStepAboutFeedback(),
    tourStepGuestLogin(),
  ],
  // 学生登录前：教师广场 / 关于 + 末步引导登录
  studentGuest: () => [
    tourStepBrowseTeachers(),
    tourStepTeachersList(),
    tourStepFilterToggle(),
    tourStepFilterSubject(),
    tourStepTeacherUsername(),
    tourStepProfileClose(),
    tourStepAbout(),
    tourStepAboutWho(),
    tourStepAboutFlow(),
    tourStepAboutSecurity(),
    tourStepAboutFeedback(),
    tourStepGuestLogin(),
  ],
  // 教师登录后：全部模块逐个深入 + 末步个人信息栏
  teacherUser: () => [
    tourStepBrowseDemands(),
    tourStepDemandList(),
    tourStepDemandCard(),
    tourStepDemandDetail(),
    tourStepDemandDetailClose(),
    tourStepDemandIntentBtn(),
    tourStepDemandIdTag(),
    tourStepBrowseTeachersPeer(),
    tourStepTeachersList(),
    tourStepFilterToggle(),
    tourStepTeacherUsername(),
    tourStepProfileClose(),
    tourStepResourceShare(),
    tourStepPostsList(),
    tourStepPostsSearch(),
    tourStepPostsSort(),
    tourStepPostsCreate(),
    tourStepPostsModal(),
    tourStepMyChats(),
    tourStepConvItem(),
    tourStepChatMessages(),
    tourStepChatSend(),
    tourStepChatPlus(),
    tourStepChatPlusImage(),
    tourStepChatPlusFile(),
    tourStepChatPlusSigning(),
    tourStepChatPlusDraft(),
    tourStepMyContracts(),
    tourStepContractsList(),
    tourStepContractCard(),
    tourStepContractActions(),
    tourStepEditProfile(),
    tourStepChsiGate(),
    tourStepProfileForm(),
    tourStepProfileSubjects(),
    tourStepProfilePrice(),
    tourStepProfileAwards(),
    tourStepProfileSubmit(),
    tourStepNotifications(),
    tourStepNotifList(),
    tourStepNotifItem(),
    tourStepNotifBlock(),
    tourStepAccountSettings(),
    tourStepSettingsAccount(),
    tourStepSettingsTheme(),
    tourStepSettingsUiScale(),
    tourStepSettingsLogout(),
    tourStepSettingsLogoutModal(),
    tourStepAbout(),
    tourStepAboutWho(),
    tourStepAboutFlow(),
    tourStepAboutSecurity(),
    tourStepAboutFeedback(),
    tourStepUserBar(),
  ],
  // 学生登录后：我的需求（深入新建表单）→ 教师广场（深入发需求）→ 其余模块 + 末步个人信息栏
  studentUser: () => [
    tourStepMyDemands(),
    tourStepMyDemandsList(),
    tourStepDemandCard('my-demands'),
    tourStepDemandDetail('my-demands'),
    tourStepDemandDetailClose('my-demands'),
    tourStepIntentToggle(),
    tourStepNewDemandBtn(),
    tourStepDemandWizard(),
    tourStepNewDemandModal(),
    tourStepBrowseTeachers(),
    tourStepTeachersList(),
    tourStepFilterToggle(),
    tourStepFilterSubject(),
    tourStepTeacherUsername(),
    tourStepProfileClose(),
    tourStepTeacherPushBtn(),
    tourStepPushModal(),
    tourStepMyChats(),
    tourStepConvItem(),
    tourStepChatMessages(),
    tourStepChatSend(),
    tourStepChatPlus(),
    tourStepChatPlusImage(),
    tourStepChatPlusFile(),
    tourStepChatPlusSigning(),
    tourStepChatPlusDraft(),
    tourStepMyContracts(),
    tourStepContractsList(),
    tourStepContractCard(),
    tourStepContractActions(),
    tourStepNotifications(),
    tourStepNotifList(),
    tourStepNotifItem(),
    tourStepNotifBlock(),
    tourStepAccountSettings(),
    tourStepSettingsAccount(),
    tourStepSettingsTheme(),
    tourStepSettingsUiScale(),
    tourStepSettingsLogout(),
    tourStepSettingsLogoutModal(),
    tourStepAbout(),
    tourStepAboutWho(),
    tourStepAboutFlow(),
    tourStepAboutSecurity(),
    tourStepAboutFeedback(),
    tourStepUserBar(),
  ],
};
