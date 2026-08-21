/**
 * v2 state store: parity migration of app-state.js.
 * Session persistence, cache invalidation, prefs, UI-scale preview and
 * logout reset registry.
 */
import { CONFIG } from '../../shared/config.js';
import { STATUS, ROLES } from '../../shared/enums.js';
import { uiScaleReflow } from './ui-scale-reflow.js';

export const state = {
  user: null, authToken: null, view: 'landing', page: null,
  allTeachers: [], adminTeachers: [], intentTeachers: [],
  myDemands: [], editingDemandId: null, adminPosts: [], adminContracts: [], myContracts: [],
  validatedInviteCode: null, // read/written only by logout reset
  guestRole: null, guestAuthMode: false,
};

export const loadSeqs = {};

// Role source of truth is shared/enums ROLES (Z-16-F5: local array removed, consumers iterate Object.values)
const sessionKey = role => `sufe_session_${role || ''}`;
const CACHE_KEYS = { teachers: 'allTeachers', contracts: 'myContracts', demands: 'myDemands', intentTeachers: 'intentTeachers', posts: 'adminPosts' };
const CACHE_DOMAINS = {
  teachers: 'teachers', contracts: 'contracts', demands: 'demands', intentTeachers: 'teachers',
  posts: 'posts', notifications: 'notifications', admin: 'admin', chat: 'chat', account: 'account',
};

let datahubInvalidator = null;
export function setDatahubInvalidator(fn) { datahubInvalidator = typeof fn === 'function' ? fn : null; }
export function invalidate(key) {
  const k = CACHE_KEYS[key];
  if (k) state[k] = [];
  const d = CACHE_DOMAINS[key];
  if (d && datahubInvalidator) datahubInvalidator(d);
}

function safeGet(storage, key) { try { return storage.getItem(key); } catch { return null; } }
function safeSet(storage, key, value) { try { storage.setItem(key, value); } catch { /* storage disabled */ } }
function safeRemove(storage, key) { try { storage.removeItem(key); } catch { /* storage disabled */ } }

export function saveSession(remember) {
  const role = state.user ? state.user.role : '';
  const payload = { user: state.user, authToken: state.authToken };
  if (typeof sessionStorage !== 'undefined') safeSet(sessionStorage, sessionKey(role), JSON.stringify(payload));
  if (remember) {
    if (typeof localStorage !== 'undefined') safeSet(localStorage, sessionKey(role), JSON.stringify({ ...payload, expires: Date.now() + CONFIG.TOKEN_TTL_MS }));
  } else if (typeof localStorage !== 'undefined') {
    safeRemove(localStorage, sessionKey(role));
  }
  if (role && typeof localStorage !== 'undefined') safeSet(localStorage, 'sufe_last_role', role);
}

export function loadLegacyAndMigrate(role) {
  const migrate = (storage, isLocal) => {
    try {
      const raw = safeGet(storage, 'sufe_session');
      if (!raw) return null;
      const saved = JSON.parse(raw);
      if (!(saved && saved.authToken && saved.user && saved.user.role)) { safeRemove(storage, 'sufe_session'); return null; }
      if (role && saved.user.role !== role) return null;
      if (isLocal && !(saved.expires > Date.now())) { safeRemove(storage, 'sufe_session'); return null; }
      safeSet(storage, sessionKey(saved.user.role), JSON.stringify(saved));
      safeRemove(storage, 'sufe_session');
      if (!role) safeSet(storage, 'sufe_last_role', saved.user.role);
      return { ...saved, source: isLocal ? 'local' : 'session' };
    } catch { return null; }
  };
  return migrate(localStorage, true) || migrate(sessionStorage, false);
}

function loadSessionForRole(role) {
  const k = sessionKey(role);
  try {
    const saved = JSON.parse(safeGet(localStorage, k));
    if (saved && saved.authToken && saved.expires > Date.now()) return { ...saved, source: 'local' };
    if (saved) safeRemove(localStorage, k);
  } catch { /* ignore */ }
  try {
    const s = JSON.parse(safeGet(sessionStorage, k));
    if (s && s.authToken) return { ...s, source: 'session' };
  } catch { /* ignore */ }
  return loadLegacyAndMigrate(role);
}

export function loadSession(role) {
  if (role) return loadSessionForRole(role);
  try {
    const last = safeGet(localStorage, 'sufe_last_role');
    if (last && Object.values(ROLES).includes(last)) {
      const s = loadSessionForRole(last);
      if (s) return s;
    }
  } catch { /* ignore */ }
  for (const r of Object.values(ROLES)) {
    const s = loadSessionForRole(r);
    if (s) return s;
  }
  return loadLegacyAndMigrate();
}

export function clearSession(role) {
  if (!role) return;
  if (typeof localStorage !== 'undefined') safeRemove(localStorage, sessionKey(role));
  if (typeof sessionStorage !== 'undefined') safeRemove(sessionStorage, sessionKey(role));
}

const PAGE_STATE_KEY = 'sufe_last_page';
const GUEST_ROLE_KEY = 'sufe_last_guest_role';
export function savePageState(pageId) { if (!pageId) return; safeSet(localStorage, PAGE_STATE_KEY, pageId); }
export function getLastPage() { return safeGet(localStorage, PAGE_STATE_KEY); }
export function setLastGuestRole(role) { role ? safeSet(localStorage, GUEST_ROLE_KEY, role) : safeRemove(localStorage, GUEST_ROLE_KEY); }
export function getLastGuestRole() { const r = safeGet(localStorage, GUEST_ROLE_KEY); return Object.values(ROLES).includes(r) ? r : null; }

export function getDeviceId() {
  try {
    let id = safeGet(localStorage, CONFIG.DEVICE_ID_KEY);
    if (!id || !/^[0-9a-f]{32}$/.test(id)) {
      const b = new Uint8Array(16);
      if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
        globalThis.crypto.getRandomValues(b);
      } else {
        for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
      }
      id = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
      safeSet(localStorage, CONFIG.DEVICE_ID_KEY, id);
    }
    return id;
  } catch { return ''; }
}

export function getThemePref() { try { return safeGet(localStorage, CONFIG.THEME_KEY) || 'system'; } catch { return 'system'; } }
export function storeThemePref(pref) { try { safeSet(localStorage, CONFIG.THEME_KEY, pref); } catch { /* ignore */ } }
export function getOrbPref() { try { const v = safeGet(localStorage, CONFIG.ORB_KEY || 'sufe_orb'); return (v === 'elegant' || v === 'hidden') ? v : 'vivid'; } catch { return 'vivid'; } }
export function setOrbPref(pref) { try { safeSet(localStorage, CONFIG.ORB_KEY || 'sufe_orb', pref); } catch { /* ignore */ } }
export function isReturning() { try { return !!safeGet(localStorage, 'sufe_returning'); } catch { return false; } }
export function setReturning() { try { safeSet(localStorage, 'sufe_returning', '1'); } catch { /* ignore */ } }

export function uiScaleClamp(v) {
  const n = Number(v);
  if (!isFinite(n)) return CONFIG.UI_SCALE_DEFAULT;
  return Math.min(CONFIG.UI_SCALE_MAX, Math.max(CONFIG.UI_SCALE_MIN, Math.round(n)));
}
export function getUiScale() {
  let v = CONFIG.UI_SCALE_DEFAULT;
  try {
    const raw = parseInt(safeGet(localStorage, CONFIG.UI_SCALE_KEY), 10);
    if (!isNaN(raw)) v = raw;
  } catch { /* storage disabled */ }
  return uiScaleClamp(v);
}
export function applyUiScale(v) {
  const c = uiScaleClamp(v);
  if (typeof document !== 'undefined') document.documentElement.style.setProperty('--ui-scale', (c / 100).toFixed(3));
  return c;
}

let _uiScalePending = null;
let _uiScaleRaf = 0;
let _uiScaleReflowLive = false;
let _uiScaleReflowRetry = 0;
let _uiScaleReflowSession = 0;

export function _uiScaleFlush() {
  _uiScaleRaf = 0;
  const c = _uiScalePending;
  if (c == null) return;
  _uiScalePending = null;
  _uiScalePreviewApply(c);
}
export function _uiScaleReflowStartAsync() {
  const R = uiScaleReflow;
  if (!R || _uiScaleReflowRetry > 2) return;
  _uiScaleReflowRetry++;
  const session = _uiScaleReflowSession;
  setTimeout(() => {
    try {
      if (session !== _uiScaleReflowSession) return;
      if (R.collectUnits() && R.sampleTargets() && R._units().length) {
        _uiScaleReflowLive = true;
        _uiScaleReflowRetry = 0;
        document.documentElement.dataset.uiReflowing = '1';
        delete document.documentElement.dataset.uiPreviewing;
        document.documentElement.style.removeProperty('--ui-preview-scale');
        R.begin();
      } else {
        _uiScaleReflowStartAsync();
      }
    } catch { /* sampling failure keeps block preview */ }
  }, 60);
}
export function _uiScalePreviewApply(c) {
  const R = uiScaleReflow;
  if (R) {
    if (_uiScaleReflowLive) { R.renderAt(c); return; }
    if (R.prepare()) {
      _uiScaleReflowLive = true;
      _uiScaleReflowRetry = 0;
      document.documentElement.dataset.uiReflowing = '1';
      R.begin();
      R.renderAt(c);
      return;
    }
    R.teardown();
    delete document.documentElement.dataset.uiReflowing;
    _uiScaleReflowStartAsync();
  }
  document.documentElement.style.setProperty('--ui-preview-scale', (c / 100).toFixed(3));
  document.documentElement.dataset.uiPreviewing = '1';
}
export function _uiScalePreviewReset() {
  if (uiScaleReflow) uiScaleReflow.teardown();
  _uiScaleReflowLive = false;
  _uiScaleReflowRetry = 0;
  _uiScaleReflowSession++;
  if (typeof document !== 'undefined') {
    delete document.documentElement.dataset.uiReflowing;
    document.documentElement.style.removeProperty('--ui-preview-scale');
    delete document.documentElement.dataset.uiPreviewing;
  }
}
export function setUiScale(v) {
  const c = uiScaleClamp(v);
  _uiScalePreviewReset();
  const r = applyUiScale(c);
  try { safeSet(localStorage, CONFIG.UI_SCALE_KEY, String(c)); } catch { /* ignore */ }
  if (typeof window !== 'undefined' && typeof window.Event === 'function') {
    try { window.dispatchEvent(new window.Event('sufe:ui-scale')); } catch { /* ignore */ }
  }
  return r;
}
export function setUiScaleLive(v) {
  const c = uiScaleClamp(v);
  _uiScalePending = c;
  if (!_uiScaleRaf && typeof requestAnimationFrame === 'function') _uiScaleRaf = requestAnimationFrame(_uiScaleFlush);
  return c;
}
export function commitUiScale(v) {
  const c = uiScaleClamp(v);
  if (_uiScaleRaf) { cancelAnimationFrame(_uiScaleRaf); _uiScaleRaf = 0; }
  _uiScalePending = null;
  _uiScalePreviewReset();
  const r = applyUiScale(c);
  try { safeSet(localStorage, CONFIG.UI_SCALE_KEY, String(c)); } catch { /* ignore */ }
  if (typeof window !== 'undefined' && typeof window.Event === 'function') {
    try { window.dispatchEvent(new window.Event('sufe:ui-scale')); } catch { /* ignore */ }
  }
  return r;
}
export function uiScaleFillPct(v) {
  const c = uiScaleClamp(v);
  const span = CONFIG.UI_SCALE_MAX - CONFIG.UI_SCALE_MIN;
  if (span <= 0) return '100.0';
  return ((c - CONFIG.UI_SCALE_MIN) / span * 100).toFixed(1);
}

export function bindUiScaleWheel() {
  if (typeof document === 'undefined') return;
  let pending = 0;
  let raf = 0;
  document.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    pending += e.deltaY < 0 ? CONFIG.UI_SCALE_WHEEL_STEP : -CONFIG.UI_SCALE_WHEEL_STEP;
    if (!raf) raf = requestAnimationFrame(() => {
      raf = 0;
      if (!pending) return;
      setUiScale(getUiScale() + pending);
      pending = 0;
    });
  }, { passive: false });
}

const logoutResets = [];
export function registerLogoutReset(fn) { if (typeof fn === 'function' && !logoutResets.includes(fn)) logoutResets.push(fn); }
export function runLogoutResets() { for (const fn of logoutResets) { try { fn(); } catch { /* continue */ } } }

export { STATUS };
