/**
 * auth feature flow: the single login gateway (ensureAuth), role entry, post-auth
 * entry and identity teardown. Shared by actions.js and actions-register.js to
 * avoid circular imports.
 *
 * 路由模型：客户端只在登录后进入。首页角色入口（我要找家教 / 我要做家教）先到登录页，
 * 登录成功再进客户端——不存在「未登录先到客户端」的中间层；登录页「返回」一律回首页。
 */
import { TEXT } from '../../constants/text.js';
import { ROLES } from '../../../shared/enums.js';
import { state, saveSession, loadSession, clearSession, setReturning, runLogoutResets } from '../../core/state.js';
import { api, setSessionBootValidating } from '../../core/api.js';
import { dhInvalidateAll } from '../../core/datahub.js';
import { showView, enterClient, renderSidebar, stopBadgePoll } from '../../core/router.js';
import { startOnboardingTour } from '../onboard/actions.js';

// 登录页来路：被拦截（登录后回原页面）/ 角色入口（按角色给文案）。
let authReturnPage = null;
let loginRole = null;
let loginShownHook = null;

/**
 * 登录表单状态在 auth/actions.js（模块变量 + DOM），flow 不能 import 它（成环），
 * 由 features/auth/index.js 装配时把 refreshAuthHeader 挂进来——任何进入登录页的
 * 路径都经 showLogin，表单刷新只此一处。
 */
export function setLoginShownHook(fn) { loginShownHook = typeof fn === 'function' ? fn : null; }

/** 登录页文案上下文：role=角色入口的目标角色，returnToPage=被拦截前所在页面。 */
export function getLoginContext() { return { role: loginRole, returnToPage: !!authReturnPage }; }

function showLogin(role) {
  loginRole = role || null;
  showView('login');
  if (loginShownHook) loginShownHook();
}

export function resetAuthFlow() {
  loginRole = null;
  authReturnPage = null;
}

/** 被拦截进入登录页（页面鉴权 / 401 失效）：登录成功后回原页面。 */
export function ensureAuth() {
  if (state.user) return true;
  authReturnPage = state.view === 'client' ? state.page : null;
  showLogin(null);
  return false;
}

/** 首页角色入口：该角色存有会话直接进客户端（校验后切换），否则先登录。 */
export function enterRole(role) {
  const saved = loadSession(role);
  if (saved && saved.authToken) { switchToRole(role, saved); return true; }
  authReturnPage = null;
  showLogin(role);
  return false;
}

/** 登录页「返回」：回首页。 */
export function authGoBack() {
  resetAuthFlow();
  showView('landing');
}

/** 通用登录入口（导航栏 / 注册页互跳）：无角色文案、无返回页。 */
export function openLogin() {
  resetAuthFlow();
  showLogin(null);
}

export async function afterAuthSuccess(isNew = false) {
  const back = authReturnPage;
  resetAuthFlow();
  setReturning();
  if (typeof dhInvalidateAll === 'function') dhInvalidateAll();
  await enterClient(back || undefined);
  // v1 parity: brand-new registered users get the onboarding tour entry
  // (v1 called the global; the ESM migration wires the onboard module directly)
  if (isNew) startOnboardingTour();
}

export function switchToRole(role, saved) {
  exitCurrentIdentity();
  state.authToken = saved.authToken;
  const sentToken = saved.authToken;
  state.user = saved.user;
  saveSession(saved.source === 'local');
  const p = enterClient();
  setSessionBootValidating(true);
  api('/api/auth/me').then(data => {
    setSessionBootValidating(false);
    if (data.user && state.user && data.user.role === state.user.role) {
      state.user = data.user;
      saveSession(saved.source === 'local');
      renderSidebar();
    }
  }).catch(err => {
    setSessionBootValidating(false);
    if (state.authToken !== sentToken) return;
    state.authToken = null;
    state.user = null;
    if (err && err.code !== 'NETWORK_ERROR') clearSession(role);
    authReturnPage = null; // 会话已失效：登录后进角色首页，不回这个入口
    showLogin(role);
  });
  return p;
}

export function exitCurrentIdentity() {
  stopBadgePoll();
  // chat cleanup is covered by the registered logout resets (chatTeardown) —
  // the v1 globalThis.stopChatPolling probe died with the ESM migration
  runLogoutResets();
  state.user = null;
  state.authToken = null;
  resetAuthFlow();
}

export function roleHint(role) {
  return role === ROLES.TEACHER ? TEXT.HINT_ROLE_TEACHER
    : role === ROLES.STUDENT ? TEXT.HINT_ROLE_STUDENT : TEXT.HINT_ROLE_ADMIN;
}
