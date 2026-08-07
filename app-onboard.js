/**
 * 新手引导层（用户指定：明确依赖登录状态的一整层，为后续扩充预留）
 *
 * 设计：引导内容 = 步骤注册表（ONBOARD_STEPS）+ 登录态上下文（onboardContext）。
 *   - onboardContext()：从 state + 本地标记解析当前引导上下文 { loggedIn, role, firstVisit }——
 *     本层与登录状态显式耦合（后续可按角色/登录态展示不同引导步骤）。
 *   - openOnboarding()：首访策略弹窗。footer 随登录态变化（访客 → 「去登录」；已登录 → 「进入平台」）。
 *   - openUsageGuide()：详细用法浮窗（关于页与首访弹窗均可呼出）。
 *   - showOnboardingIfNeeded()：由 app-shell 初始化调用，按上下文决定是否弹首访。
 *
 * 扩充方式：向 ONBOARD_STEPS 加步骤（含 when 谓词），openOnboarding 未来改为多步串行。
 * 依赖：state（登录态）、UI/CONFIG（constants）、openModal/closeModal（app-ui）、ensureAuth/enterClient（运行时）。
 */

// 引导步骤注册表：当前仅首访策略弹窗一步；扩充即在此加 { id, when, render }。
// when 接收 onboardContext 结果，谓词决定该步是否展示（后续按角色/登录态分流）
const ONBOARD_STEPS = [
  {
    id: 'first-visit-policy',
    when: ctx => ctx.firstVisit,
    // render(ctx) 返回 { title, body, footer }；当前复用 openOnboarding 的既有结构
  },
];

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
    ? `<button type="button" class="btn btn-primary glass glass--pressable" onclick="closeModal()">${UI.ONBOARD_CONFIRM}</button>`
    : `<button type="button" class="btn btn-primary glass glass--pressable" onclick="closeModal();ensureAuth()">${UI.ONBOARD_CONFIRM_LOGIN}</button>`;
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
    footer: `<button type="button" class="btn btn-primary glass glass--pressable" onclick="closeModal()">${UI.ONBOARD_CONFIRM}</button>`,
  });
}

/** 初始化入口：首访才弹；本设备标记常驻（登录/注册也写），会话过期/自动登录失败不再重弹 */
function showOnboardingIfNeeded() {
  if (isReturning()) return;
  setReturning();
  openOnboarding();
}
