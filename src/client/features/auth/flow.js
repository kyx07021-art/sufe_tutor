/**
 * auth feature flow: the single login gateway (ensureAuth), auth return page,
 * post-auth entry, role preview/switch and identity teardown. Shared by
 * actions.js and actions-register.js to avoid circular imports.
 */
import { TEXT } from '../../constants/text.js';
import { ROLES } from '../../../shared/enums.js';
import { state, saveSession, loadSession, clearSession, setReturning, setLastGuestRole, runLogoutResets } from '../../core/state.js';
import { api, setSessionBootValidating } from '../../core/api.js';
import { dhInvalidateAll } from '../../core/datahub.js';
import { showView, enterClient, pagesForRole, renderSidebar, stopBadgePoll } from '../../core/router.js';
import { startOnboardingTour } from '../onboard/actions.js';

let authReturnPage = null;

export function setAuthReturnPage(page) { authReturnPage = page; }

export function ensureAuth() {
  if (state.user) return true;
  authReturnPage = state.view === 'client' ? state.page : null;
  state.guestAuthMode = true;
  showView('login');
  return false;
}

export function authGoBack() {
  if (state.guestAuthMode) {
    state.guestAuthMode = false;
    const back = authReturnPage;
    authReturnPage = null;
    const cfg = back && pagesForRole().find(p => p.id === back);
    enterClient(cfg && cfg.auth === false ? back : undefined);
    return;
  }
  showView('landing');
}

export async function afterAuthSuccess(isNew = false) {
  state.guestAuthMode = false;
  state.guestRole = null;
  setReturning();
  if (typeof dhInvalidateAll === 'function') dhInvalidateAll();
  const back = authReturnPage;
  authReturnPage = null;
  await enterClient(back || undefined);
  // v1 parity: brand-new registered users get the onboarding tour entry
  // (v1 called the global; the ESM migration wires the onboard module directly)
  if (isNew) startOnboardingTour();
}

export function handleFeatureClick(role) {
  const saved = loadSession(role);
  if (saved && saved.authToken) { switchToRole(role, saved); return; }
  enterRolePreview(role);
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
    enterRolePreview(role);
  });
  return p;
}

export function enterRolePreview(role) {
  exitCurrentIdentity();
  state.guestRole = role;
  state.guestAuthMode = false;
  setLastGuestRole(role);
  return enterClient();
}

export function exitCurrentIdentity() {
  stopBadgePoll();
  // chat cleanup is covered by the registered logout resets (chatTeardown) —
  // the v1 globalThis.stopChatPolling probe died with the ESM migration
  runLogoutResets();
  setLastGuestRole(null);
  state.user = null;
  state.authToken = null;
  state.guestRole = null;
  state.guestAuthMode = false;
}

export function roleHint(role) {
  return role === ROLES.TEACHER ? TEXT.HINT_ROLE_TEACHER
    : role === ROLES.STUDENT ? TEXT.HINT_ROLE_STUDENT : TEXT.HINT_ROLE_ADMIN;
}
