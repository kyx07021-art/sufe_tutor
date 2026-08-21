/**
 * auth feature actions entry: login-page account probe, five-in-one submit,
 * logout cleanup, and re-exports of the auth flow / register / OTP modules so
 * callers can `import * as auth from './actions.js'`.
 */
import { CONFIG } from '../../../shared/config.js';
import { TEXT } from '../../constants/text.js';
import { ROLES } from '../../../shared/enums.js';
import { state, saveSession, loadSession, clearSession, getDeviceId, runLogoutResets } from '../../core/state.js';
import { api } from '../../core/api.js';
import { showToast, btnLoading, btnDone, closeAllModals, withCaptcha } from '../../core/ui.js';
import { showView, stopBadgePoll, closeSidebar } from '../../core/router.js';
import { afterAuthSuccess, setAuthReturnPage, roleHint } from './flow.js';
import { classifyIdentifier, otpExhaustedReset } from './actions-otp.js';
import { closeProfilePanel } from '../teacher/actions.js';

export * from './flow.js';
export * from './actions-register.js';
export * from './actions-otp.js';

let loginCheckTimer = null;
let loginCheckSeq = 0;
let loginMode = 'password';
let loginAccountValid = false;

const $ = id => typeof document !== 'undefined' ? document.getElementById(id) : null;

export function refreshAuthHeader() {
  const h = $('login-title');
  const p = $('login-subtitle');
  if (!h || !p) return;
  const u = $('login-identifier');
  if (u) {
    const saved = state.guestRole ? loadSession(state.guestRole) : loadSession();
    const name = saved && saved.user ? saved.user.username : '';
    u.value = name;
    if (name) checkLoginUsernameDebounced();
  }
  loginMode = 'password';
  loginAccountValid = false;
  const pw = $('login-password-group');
  const cd = $('login-code-group');
  const hint = $('login-username-hint');
  const link = $('login-switch-mode');
  const btn = $('login-submit');
  if (pw) pw.classList.add('hidden');
  if (cd) cd.classList.add('hidden');
  if (hint) { hint.textContent = ''; hint.classList.remove('login-hint--missing'); }
  if (link) link.textContent = TEXT.LOGIN_SWITCH_CODE;
  if (btn) { btn.disabled = true; btn.classList.add('disabled'); }
  if (state.guestAuthMode && state.guestRole === ROLES.TEACHER) {
    h.textContent = TEXT.AUTH_LOGIN_TITLE_TEACHER;
    p.textContent = TEXT.AUTH_LOGIN_SUB_TEACHER;
  } else if (state.guestAuthMode && state.guestRole === ROLES.STUDENT) {
    h.textContent = TEXT.AUTH_LOGIN_TITLE_STUDENT;
    p.textContent = TEXT.AUTH_LOGIN_SUB_STUDENT;
  } else {
    h.textContent = state.guestAuthMode ? TEXT.AUTH_LOGIN_TITLE_GUEST : TEXT.AUTH_LOGIN_TITLE;
    p.textContent = state.guestAuthMode ? TEXT.AUTH_LOGIN_SUB_GUEST : TEXT.AUTH_LOGIN_SUB;
  }
}

export function checkLoginUsernameDebounced() {
  clearTimeout(loginCheckTimer);
  loginCheckTimer = setTimeout(checkLoginUsername, CONFIG.LOGIN_CHECK_DEBOUNCE_MS);
}

export async function checkLoginUsername() {
  const hint = $('login-username-hint');
  const identifier = $('login-identifier').value.trim();
  const seq = ++loginCheckSeq;
  if (!identifier || !hint) {
    if (hint) hint.textContent = '';
    loginAccountValid = false;
    syncLoginCredGroups();
    return;
  }
  try {
    const data = await api(`/api/auth/check?identifier=${encodeURIComponent(identifier)}`);
    if (seq !== loginCheckSeq) return;
    const exists = !!data.exists;
    loginAccountValid = exists;
    hint.textContent = !exists ? TEXT.LOGIN_ACCOUNT_MISSING : roleHint(data.role);
    hint.classList.toggle('login-hint--missing', !exists);
    syncLoginCredGroups();
  } catch { /* transient network: stay silent */ }
}

export function syncLoginCredGroups() {
  const pw = $('login-password-group');
  const cd = $('login-code-group');
  const btn = $('login-submit');
  if (!loginAccountValid) {
    if (pw) pw.classList.add('hidden');
    if (cd) cd.classList.add('hidden');
    if (btn) { btn.disabled = true; btn.classList.add('disabled'); }
    return;
  }
  if (btn) { btn.disabled = false; btn.classList.remove('disabled'); }
  const codeMode = loginMode === 'code';
  if (pw) pw.classList.toggle('hidden', codeMode);
  if (cd) cd.classList.toggle('hidden', !codeMode);
}

export function toggleLoginMode(e) {
  if (e && e.preventDefault) e.preventDefault();
  if (!loginAccountValid) return;
  const next = loginMode === 'code' ? 'password' : 'code';
  if (next === 'code') {
    const ident = ($('login-identifier') || {}).value || '';
    const kind = classifyIdentifier(ident);
    if (kind !== 'phone' && kind !== 'email') {
      showToast(TEXT.USERNAME_USE_PASSWORD, 'error');
      return;
    }
  }
  loginMode = next;
  const link = $('login-switch-mode');
  if (link) link.textContent = next === 'code' ? TEXT.LOGIN_SWITCH_PASSWORD : TEXT.LOGIN_SWITCH_CODE;
  syncLoginCredGroups();
}

export async function handleLogin(e) {
  if (e && e.preventDefault) e.preventDefault();
  const identifier = $('login-identifier').value.trim();
  if (!identifier) { showToast(TEXT.LOGIN_IDENTIFIER_PLACEHOLDER, 'error'); return; }
  if (!loginAccountValid) {
    await checkLoginUsername();
    if (!loginAccountValid) { showToast(TEXT.LOGIN_ACCOUNT_MISSING, 'error'); return; }
  }
  if (loginMode === 'code' && !($('login-code') || {}).value) {
    showToast(TEXT.CODE_PLACEHOLDER, 'error');
    return;
  }
  if (loginMode !== 'code' && !($('login-password') || {}).value) {
    showToast(TEXT.LOGIN_PASSWORD_REQUIRED, 'error');
    return;
  }
  withCaptcha(() => doLogin(identifier));
}

export async function doLogin(identifier) {
  const btn = $('login-submit');
  const remember = !!($('login-remember') && $('login-remember').checked);
  try {
    btnLoading(btn, TEXT.LOADING_LOGIN);
    let data;
    if (loginMode === 'code') {
      const code = $('login-code').value.trim();
      data = await api('/api/auth/login/code', { method: 'POST', body: { identifier, code, deviceId: getDeviceId() } });
    } else {
      const password = $('login-password').value;
      data = await api('/api/auth/login', { method: 'POST', body: { identifier, password, deviceId: getDeviceId() } });
    }
    state.user = data.user;
    state.authToken = data.authToken || null;
    saveSession(remember);
    afterAuthSuccess();
  } catch (err) {
    if (err && err.code === 'OTP_EXHAUSTED') otpExhaustedReset('login');
    showToast(err.message, 'error');
  } finally {
    btnDone(btn, TEXT.BTN_LOGIN);
  }
}

export function handleLogout() {
  const role = state.user ? state.user.role : '';
  if (state.authToken) api('/api/auth/logout', { method: 'POST', body: {} }).catch(() => {});
  stopBadgePoll();
  // chat teardown (stop polling / abort staged uploads) is registered via
  // registerLogoutReset — the v1 globalThis.stopChatPolling probe died with the
  // ESM migration and has been removed (rule 18: delete upstream references).
  runLogoutResets();
  if (typeof globalThis !== 'undefined') globalThis._contractDraftDemands = null;
  state.user = null;
  state.authToken = null;
  state.page = null;
  state.guestRole = null;
  state.guestAuthMode = false;
  setAuthReturnPage(null);
  closeProfilePanel();
  state.allTeachers = [];
  state.adminTeachers = [];
  state.intentTeachers = [];
  state.myDemands = [];
  state.editingDemandId = null;
  state.adminPosts = [];
  state.adminContracts = [];
  state.myContracts = [];
  state.validatedInviteCode = null;
  clearSession(role);
  closeSidebar();
  closeAllModals();
  showView('landing');
}
