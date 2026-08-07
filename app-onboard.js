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
 *   - 类名独立前缀 .tour-：防被表单/弹窗作用域后代选择器命中（v0.25.1 复合组件隔离教训）。
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
  // 登录态依赖：访客主按钮导向登录通路，已登录主按钮关闭进入平台
  const primary = ctx.loggedIn
    ? `<button type="button" class="btn glass glass--pressable" onclick="closeModal()">${UI.ONBOARD_CONFIRM}</button>`
    : `<button type="button" class="btn glass glass--pressable" onclick="closeModal();ensureAuth()">${UI.ONBOARD_CONFIRM_LOGIN}</button>`;
  openModal({
    title: UI.ONBOARD_TITLE,
    closable: false,
    body: `<p class="onboard-intro">${escHtml(UI.ONBOARD_INTRO)}</p><div class="onboard-policy">${policyItems}</div>`,
    footer: `<button type="button" class="btn btn-outline glass glass--pressable" onclick="openUsageGuide()">${UI.USAGE_GUIDE_BTN}</button>
      ${primary}`,
  });
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
    body: `<div class="usage-guide">${sections}</div>`,
    footer: `<button type="button" class="btn glass glass--pressable" onclick="closeModal()">${UI.ONBOARD_CONFIRM}</button>`,
  });
}

/** 初始化入口：首访才弹；本设备标记常驻（登录/注册也写），访客落地也按标记不弹（v0.24.1 已无自动登录） */
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

/** 解析步骤目标元素：未挂载 / 在 .hidden 祖先内（display:none）→ null（引擎等待或跳过） */
function _tourResolve(step) {
  const t = step.target || {};
  let el = null;
  if (t.page) el = document.querySelector(`#sidebar-nav .sidebar-item[data-page="${t.page}"]`);
  else if (t.sel) el = document.querySelector(t.sel);
  else if (t.closeModal) el = document.querySelector('#modal-container .modal-overlay');
  else if (t.self) el = document.querySelector('#sidebar-user .sidebar-user-top');
  return el && !el.closest('.hidden') ? el : null;
}

/** 挂载引导层 DOM：overlay 常驻（点击拦截），hole/bubble 每步重建定位 */
function _tourMount() {
  const overlay = document.createElement('div');
  overlay.className = 'tour-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', UI.TOUR_ARIA_LABEL || '新手引导');
  overlay.innerHTML = '<div class="tour-hole"></div><div class="tour-bubble-pos"></div>';
  document.body.appendChild(overlay);
  _tourEls = {
    overlay,
    hole: overlay.querySelector('.tour-hole'),
    pos: overlay.querySelector('.tour-bubble-pos'),
    bubble: null,
  };
  _tourEls.hole.addEventListener('click', _tourHoleClick);
  // 网安 M2：引导期间对 AT 隐藏底层内容（aria-hidden；不用 inert——inert 会连程序化 .click() 一起禁掉，破坏亮区透传）
  const appRoot = document.getElementById('app');
  if (appRoot) appRoot.setAttribute('aria-hidden', 'true');
}

/** 渲染当前步文字气泡（重建 innerHTML 让 .tour-bubble 的入场 animation 每步重放）。
 *  不用 .glass 基类：基类带 transform transition + hover 抬升，对 bdf 子树有 983252 冻结风险；
 *  玻璃观感由 .tour-bubble 自身用 CSS 变量承担（同 .modal 预设配方）。 */
function _tourShowBubble(text) {
  const pos = _tourEls.pos;
  pos.innerHTML = `<div class="tour-bubble">
    <p class="tour-bubble-text">${escHtml(text)}</p>
    <button type="button" class="btn btn-ghost btn-xs tour-skip-btn" onclick="skipTour()">${escHtml(UI.TOUR_SKIP)}</button>
  </div>`;
  _tourEls.bubble = pos.querySelector('.tour-bubble');
}

/** 定位亮区：JS 只切类 + transform 定位（零内联外观样式；宽高为几何量随目标变） */
function _tourPlace(el) {
  const rect = el.getBoundingClientRect();
  const hole = _tourEls.hole;
  hole.classList.add('tour-hole--show');
  hole.style.width = `${rect.width}px`;
  hole.style.height = `${rect.height}px`;
  hole.style.transform = `translate(${rect.left}px, ${rect.top}px)`; // fixed 元素 translate 定位
  _tourPlaceBubble(rect);
}

/** 亮区隐藏（等待目标出现期间） */
function _tourHideHole() {
  _tourEls.hole.classList.remove('tour-hole--show');
}

/** 气泡落位：目标旁（右→左→下→上），**永不与亮区重叠**（架构审计 H1：此前兜底钳制会把气泡压到亮区正上方，
 *  移动端贴边目标点「亮区」实际点到气泡 → 步进失效）。最后兜底贴视口底（亮区通常在上方）；
 *  另 style.css 中 .tour-hole z 高于 .tour-bubble-pos，即使极小视口重叠，点亮的仍是洞。 */
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
    const step = _tourSteps[_tourIdx];
    if (!step) { _tourCleanup(); return; }
    _tourShowBubble(step.text);
    const el = _tourResolve(step);
    if (el) { _tourPlace(el); return; }
    _tourHideHole();
    const waitStep = _tourIdx;
    const start = Date.now();
    const tick = () => {
      if (!_tourActive || _tourIdx !== waitStep) return; // 已跳走/已结束
      if (!_tourInClientView()) { _tourCleanup(); return; } // 等待中视图切走 → 收尾
      if (Date.now() - start > CONFIG.TOUR_TARGET_TIMEOUT_MS) { _tourNext(); return; }
      const found = _tourResolve(_tourSteps[_tourIdx]);
      if (found) { _tourPlace(found); return; }
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

/** 亮区点击：执行 onAdvance（closeModal 等）→ 透传点击给元素本体 → next() */
function _tourHoleClick(e) {
  e.preventDefault();
  e.stopPropagation();
  const step = _tourSteps[_tourIdx];
  if (!step) return;
  // 网安 M1：布局漂移守卫——异步内容加载（图片/表单重渲）会使亮区视觉位置与目标实际位置错位。
  // 点击坐标落在目标当前边框盒外 = 漂移 → 重定位亮区且本次不推进（防把用户点击转发给错位后的目标本体）
  const targetEl = _tourResolve(step);
  if (targetEl) {
    const r = targetEl.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) {
      _tourPlace(targetEl);
      return;
    }
  }
  if (_tourIdx >= _tourSteps.length - 1) {
    // 末步：先收尾再透传——登录/资料栏步会跳走，不能留蒙层挡新视图
    _tourCleanup();
    _tourAdvanceAction(step);
    return;
  }
  _tourAdvanceAction(step);
  _tourIdx++;
  _tourStartStep();
}

/** 执行当前步的副作用：onAdvance + 透传真实点击（closeModal 步不透传，onAdvance 已关） */
function _tourAdvanceAction(step) {
  const t = step.target || {};
  if (t.closeModal) {
    if (typeof step.onAdvance === 'function') step.onAdvance();
    else closeModal();
    return;
  }
  if (typeof step.onAdvance === 'function') step.onAdvance();
  const el = _tourResolve(step);
  if (el) { try { el.click(); } catch (err) { /* 目标不可点不阻断步进 */ } }
}

/** 亮区跟随：窗口尺寸 / 滚动（capture 捕获内部滚动容器）时重新定位 */
function _tourReposition() {
  if (!_tourActive) return;
  const step = _tourSteps[_tourIdx];
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

/** 气泡「跳过」按钮：整个引导收尾 */
function skipTour() { _tourCleanup(); }

/**
 * 「重温新手引导」入口：按登录态 + 角色选脚本。管理员为运营角色不引导；
 * 不重置 sufe_returning 首访标记（仅首次访问自动弹窗用）。
 */
function startOnboardingTour() {
  const ctx = onboardContext();
  if (ctx.loggedIn && ctx.role === 'admin') return;
  const script = ctx.loggedIn
    ? (ctx.role === 'teacher' ? 'teacherUser' : 'studentUser')
    : (ctx.role === 'teacher' ? 'teacherGuest' : 'studentGuest'); // 访客 role = guestRole
  runTour(script);
}

// ============================================================
// 五份引导脚本（需求三：主页老浮窗 / 教师·学生·登录前·登录后）
// 每个选项卡介绍拆成独立组件函数，按脚本顺序拼接 → 追加新功能 = 加一个函数并插入对应脚本
// ============================================================

/** 需求大厅（教师） */
function tourStepBrowseDemands()      { return { target: { page: 'browse-demands' },   text: UI.TOUR_STEP_BROWSE_DEMANDS }; }
/** 教师同行（教师浏览教师） */
function tourStepBrowseTeachersPeer() { return { target: { page: 'browse-teachers' },  text: UI.TOUR_STEP_BROWSE_TEACHERS_PEER }; }
/** 教师广场（学生浏览教师） */
function tourStepBrowseTeachers()     { return { target: { page: 'browse-teachers' },  text: UI.TOUR_STEP_BROWSE_TEACHERS }; }
/** 资料共享（教师） */
function tourStepResourceShare()      { return { target: { page: 'resource-share' },   text: UI.TOUR_STEP_RESOURCE_SHARE }; }
/** 我的会话 */
function tourStepMyChats()            { return { target: { page: 'my-chats' },         text: UI.TOUR_STEP_MY_CHATS }; }
/** 我的合同 */
function tourStepMyContracts()        { return { target: { page: 'my-contracts' },     text: UI.TOUR_STEP_MY_CONTRACTS }; }
/** 个人资料（教师编辑档案页签） */
function tourStepEditProfile()        { return { target: { page: 'edit-profile' },     text: UI.TOUR_STEP_EDIT_PROFILE }; }
/** 教师资料表单（页面内元素） */
function tourStepProfileForm()        { return { target: { sel: '.profile-form' },     text: UI.TOUR_STEP_PROFILE_FORM }; }
/** 通知信息 */
function tourStepNotifications()      { return { target: { page: 'notifications' },    text: UI.TOUR_STEP_NOTIFICATIONS }; }
/** 设置 */
function tourStepAccountSettings()    { return { target: { page: 'account-settings' }, text: UI.TOUR_STEP_ACCOUNT_SETTINGS }; }
/** 关于平台 */
function tourStepAbout()              { return { target: { page: 'about' },            text: UI.TOUR_STEP_ABOUT }; }
/** 我的需求（学生） */
function tourStepMyDemands()          { return { target: { page: 'my-demands' },       text: UI.TOUR_STEP_MY_DEMANDS }; }
/** 新建需求按钮（页面内元素） */
function tourStepNewDemandBtn()       { return { target: { sel: '#btn-new-demand' },   text: UI.TOUR_STEP_NEW_DEMAND_BTN }; }
/** 需求发布表单弹窗（点后自动关闭） */
function tourStepNewDemandModal()     { return { target: { closeModal: true },         text: UI.TOUR_STEP_NEW_DEMAND_MODAL }; }
/** 访客末步：个人信息栏去登录/注册 */
function tourStepGuestLogin()         { return { target: { self: true },               text: UI.TOUR_STEP_GUEST_LOGIN }; }
/** 登录用户末步：个人信息栏 */
function tourStepUserBar()            { return { target: { self: true },               text: UI.TOUR_STEP_USER_BAR }; }

const TOUR_SCRIPTS = {
  // 教师登录前：可访问区域 + 末步引导登录
  teacherGuest: () => [
    tourStepBrowseDemands(),
    tourStepBrowseTeachersPeer(),
    tourStepResourceShare(),
    tourStepAbout(),
    tourStepGuestLogin(),
  ],
  // 学生登录前
  studentGuest: () => [
    tourStepBrowseTeachers(),
    tourStepAbout(),
    tourStepGuestLogin(),
  ],
  // 教师登录后：逐个栏目 + 资料表单 + 末步个人信息栏
  teacherUser: () => [
    tourStepBrowseDemands(),
    tourStepBrowseTeachersPeer(),
    tourStepResourceShare(),
    tourStepMyChats(),
    tourStepMyContracts(),
    tourStepEditProfile(),
    tourStepProfileForm(),
    tourStepNotifications(),
    tourStepAccountSettings(),
    tourStepAbout(),
    tourStepUserBar(),
  ],
  // 学生登录后：我的需求 → 新建需求 → 弹窗收尾，再逐个栏目 + 末步个人信息栏
  studentUser: () => [
    tourStepMyDemands(),
    tourStepNewDemandBtn(),
    tourStepNewDemandModal(),
    tourStepBrowseTeachers(),
    tourStepMyChats(),
    tourStepMyContracts(),
    tourStepNotifications(),
    tourStepAccountSettings(),
    tourStepAbout(),
    tourStepUserBar(),
  ],
};
