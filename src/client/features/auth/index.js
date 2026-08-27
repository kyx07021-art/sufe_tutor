/**
 * auth feature registry: mounts the login/register views, wires the auth
 * gateway (router guard + api 401 fallback) and installs root data-action
 * delegation for click / keydown / input / submit (no inline handlers).
 */
import { TEXT } from '../../constants/text.js';
import * as actions from './actions.js';
import { handleFeatureClick } from './flow.js';
import { loginViewHtml, registerViewHtml } from './render.js';
import { state } from '../../core/state.js';
import { setEnsureAuth } from '../../core/api.js';
import { showView, setRouterAuthGuard } from '../../core/router.js';
import { closeModal, openPolicyModal } from '../../core/ui.js';

const ACTION_MAP = {
  'auth.back': actions.authGoBack,
  'auth.backLanding': () => showView('landing'),
  'auth.viewLogin': () => { showView('login'); actions.refreshAuthHeader(); },
  'auth.viewRegister': () => showView('register'),
  'auth.enterGuest': (el) => handleFeatureClick(el.dataset.role), // landing entry: student/teacher guest preview
  'auth-required': () => showView('login'), // audit fix (2026-08-19): router sidebar guest bar data-action=auth-required had zero handler (v1 inline ensureAuth binding lost in ESM migration)
  'auth.toggleLoginMode': actions.toggleLoginMode,
  'auth.checkLoginUsername': actions.checkLoginUsernameDebounced,
  'auth.checkRegisterContact': actions.checkRegisterContact,
  'auth.sendCode': (el) => actions.requestOtpCode(el.dataset.prefix, el.dataset.channel || 'auto'),
  'auth.switchRegisterRole': (el) => actions.switchRegisterRole(el.dataset.role),
  'auth.wizardNext': actions.regWizardNext,
  'auth.wizardBack': actions.regWizardBack,
  'auth.handleLogin': actions.handleLogin,
  'auth.handleRegister': actions.handleRegister,
  'auth.openPhoneBind': actions.openPhoneBindModal,
  'auth.openEmailBind': actions.openEmailBindModal,
  'auth.submitPhoneBind': () => actions.submitBind('phone'),
  'auth.submitEmailBind': () => actions.submitBind('email'),
  'auth.closeModal': closeModal,
  'auth.openAgreement': () => openPolicyModal(TEXT.POLICY_KEY_AGREEMENT),
  'auth.openPrivacy': () => openPolicyModal(TEXT.POLICY_KEY_PRIVACY),
};

let installed = false;

function mountView(id, html) {
  if (typeof document === 'undefined') return;
  const old = document.getElementById(id);
  if (old) old.remove();
  const host = document.createElement('div');
  host.innerHTML = html;
  const node = host.firstElementChild;
  if (node) {
    node.classList.toggle('hidden', state.view !== id);
    document.body.appendChild(node);
  }
}

function bindDelegation() {
  if (typeof document === 'undefined') return [];
  const actionTarget = (el) => el && el.closest ? el.closest('[data-action]') : null;
  const invoke = (el, e) => {
    const fn = ACTION_MAP[el.dataset.action];
    if (!fn) return;
    e.preventDefault();
    fn(el, e);
  };
  const onClick = e => {
    const el = actionTarget(e.target);
    if (el) invoke(el, e);
  };
  const onKeydown = e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = actionTarget(e.target);
    if (el && el.getAttribute('role') === 'button') invoke(el, e);
  };
  const onInput = e => {
    const el = e.target && e.target.closest ? e.target.closest('[data-input-action]') : null;
    const fn = el && ACTION_MAP[el.dataset.inputAction];
    if (fn) fn(el, e);
  };
  const onSubmit = e => {
    const form = e.target && e.target.closest ? e.target.closest('form[data-submit]') : null;
    const fn = form && ACTION_MAP[form.dataset.submit];
    if (!fn) return;
    e.preventDefault();
    fn(form, e);
  };
  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKeydown);
  document.addEventListener('input', onInput);
  document.addEventListener('submit', onSubmit);
  return [
    () => document.removeEventListener('click', onClick),
    () => document.removeEventListener('keydown', onKeydown),
    () => document.removeEventListener('input', onInput),
    () => document.removeEventListener('submit', onSubmit),
  ];
}

function installEntryGlow() {
  if (typeof document === 'undefined') return () => {};
  const onMove = e => {
    const entry = e.target && e.target.closest ? e.target.closest('.entry') : null;
    if (!entry) return;
    const r = entry.getBoundingClientRect();
    entry.style.setProperty('--mx', (e.clientX - r.left) + 'px');
    entry.style.setProperty('--my', (e.clientY - r.top) + 'px');
  };
  document.addEventListener('mousemove', onMove);
  return () => document.removeEventListener('mousemove', onMove);
}

function onLoad() {
  if (installed) return () => {};
  installed = true;
  mountView('view-login', loginViewHtml());
  mountView('view-register', registerViewHtml());
  actions.refreshAuthHeader();
  actions.syncLoginCredGroups();
  // A3 (v1→v2 migration regression, 2026-08-20): v1 showView('login') always called
  // refreshAuthHeader() — login title switches by arrival path (guest redirected via
  // ensureAuth shows guest-mode copy + form reset). v2 core/router.js showView is shared
  // and must not depend on auth (circular-import ban), so the auth mount point wraps
  // ensureAuth (still converging on the flow.js single gateway; "unique login path"
  // contract preserved) — all three entry paths (selectPage auth marker / write-button
  // guard / api 401 fallback) refresh the header through the wrapper.
  const ensureAuth = () => {
    const ok = actions.ensureAuth();
    // Only refresh when the guard actually redirected to login (ok===false); an
    // authenticated call must not touch the login form (it may not be mounted and
    // refreshAuthHeader has async debounce tails that outlive the call).
    if (!ok) actions.refreshAuthHeader();
    return ok;
  };
  setRouterAuthGuard(ensureAuth);
  setEnsureAuth(ensureAuth);
  const offs = [...bindDelegation(), installEntryGlow()];
  return () => { offs.forEach(off => off()); installed = false; };
}

export default {
  id: 'auth',
  text: TEXT,
  pages: [],
  actions: ACTION_MAP,
  onLoad,
};

export { ACTION_MAP };
