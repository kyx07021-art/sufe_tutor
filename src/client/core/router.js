/**
 * v2 client router (plan 3.2). Declarative page registry; feature registry starts
 * empty and features call registerPage in later batches. Migrated from app-shell.js.
 */
import { CONFIG, APP_VERSION } from '../../shared/config.js';
import { TEXT } from '../constants/text.js';
import { state, loadSeqs, savePageState, getLastPage } from './state.js';
import { escHtml, renderAvatarHtml, loaderHtml } from './dom.js';
import { roleLabel } from './display.js';
import { closeAllModals } from './ui-modal.js';
import { initReveals } from './anim.js';
import { applyTabBindings } from './ui.js';
import { bindSegmentInputs, bindTimeSlotTree } from './ui-form.js';
import { applyBarWidths } from './match.js';
import { dhGet, dhPrefetch, startVersionProbe, stopVersionProbe } from './datahub.js';
import { enterAbout } from './about.js';

const VIEWS = ['landing', 'login', 'register', 'client'];
const featurePages = [];
const builtinPages = [
  { id: 'about', roles: ['student', 'teacher', 'admin'], label: TEXT.PAGE_ABOUT, desc: TEXT.PAGE_ABOUT_DESC, enter: () => enterAbout(), auth: false },
];
let authGuard = null;
export function setRouterAuthGuard(fn) { authGuard = typeof fn === 'function' ? fn : null; }
export function registerPage(page) {
  if (!page || !page.id || typeof page.enter !== 'function') return;
  const idx = featurePages.findIndex(p => p.id === page.id);
  const rec = { id: page.id, label: page.label || page.id, desc: page.desc || '', enter: page.enter, auth: page.auth, roles: page.roles || [], leave: typeof page.leave === 'function' ? page.leave : null };
  if (idx >= 0) featurePages[idx] = rec; else featurePages.push(rec);
}
export function unregisterPage(id) {
  const i = featurePages.findIndex(p => p.id === id);
  if (i >= 0) featurePages.splice(i, 1);
}

export function pagesForRole() {
  const role = state.user ? state.user.role : state.guestRole;
  return [...builtinPages, ...featurePages].filter(p => !p.roles || !p.roles.length || p.roles.includes(role));
}
// Logged-in default page equals old ROLE_PAGES[role][0]: first role-visible feature page
// in registration order. B2 features call registerPage; while the registry is empty the
// builtin about page must NOT become the login home page. Fallback keeps the old v1
// role-first ids (student=my-demands / teacher=browse-demands / admin=admin-stats).
const ROLE_FIRST_PAGE = { student: 'my-demands', teacher: 'browse-demands', admin: 'admin-stats' };
export function defaultPageFor() {
  if (!state.user) return state.guestRole === 'teacher' ? 'browse-demands' : 'browse-teachers';
  const role = state.user.role;
  const roleFeatures = featurePages.filter(p => !p.roles || !p.roles.length || p.roles.includes(role));
  const first = roleFeatures[0];
  return first ? first.id : (ROLE_FIRST_PAGE[role] || 'my-demands');
}

export function showView(name) {
  VIEWS.forEach(v => { const el = document.getElementById(`view-${v}`); if (el) el.classList.add('hidden'); });
  const target = document.getElementById(`view-${name}`);
  if (target) target.classList.remove('hidden');
  state.view = name;
  updateNavbar();
}

export function goHome() { state.user ? enterClient() : showView('landing'); }

export function updateNavbar() {
  const el = document.getElementById('navbar-actions');
  if (!el) return;
  if (state.user) {
    const u = state.user;
    const rl = roleLabel(u.role);
    el.innerHTML = `<div class="navbar-user"><span>${escHtml(u.username)}</span><span class="user-badge glass${u.role === 'admin' ? ' admin-badge glass' : ''}">${rl}</span></div>`;
  } else {
    el.innerHTML = `<button type="button" class="btn glass glass--pressable" data-action="view-login">${TEXT.NAV_LOGIN}</button>
      <button type="button" class="btn glass glass--pressable" data-action="view-register">${TEXT.NAV_REGISTER}</button>`;
    el.querySelector('[data-action="view-login"]')?.addEventListener('click', () => showView('login'));
    el.querySelector('[data-action="view-register"]')?.addEventListener('click', () => showView('register'));
  }
}

export async function enterClient(pageId) {
  renderSidebar();
  showView('client');
  const stored = getLastPage();
  const storedOk = stored && pagesForRole().some(p => p.id === stored && (state.user || p.auth === false));
  const valid = pageId && pagesForRole().some(p => p.id === pageId) ? pageId
    : (storedOk ? stored : defaultPageFor());
  selectPage(valid);
  if (state.user) {
    dhPrefetch(state.user.role);
    startBadgePoll();
    startVersionProbe();
  } else if (state.guestRole) {
    startVersionProbe();
    dhPrefetch(state.guestRole === 'teacher' ? 'teacher-guest' : 'student-guest');
  }
  closeSidebar();
  const main = document.getElementById('client-main');
  if (main) main.scrollTop = 0;
}

export function renderSidebar() {
  const u = state.user;
  const isAdmin = u && u.role === 'admin';
  const userTarget = document.getElementById('sidebar-user');
  if (userTarget) {
    const userBlock = u ? `<button type="button" class="sidebar-user-top sidebar-user-btn" data-action="open-profile" data-profile-user-id="${u.id}" title="${TEXT.PROFILE_PANEL_TITLE}">
      ${renderAvatarHtml(u.avatar, u.username, 'sidebar-user-avatar')}
      <div class="sidebar-user-text"><div class="sidebar-user-name">${escHtml(u.username)}</div><div class="sidebar-user-role">${roleLabel(u.role)}</div></div>
    </button>` : `<button type="button" class="sidebar-user-top sidebar-user-btn" data-action="auth-required">
      <span class="avatar sidebar-user-avatar avatar--guest glass" aria-hidden="true">?</span>
      <div class="sidebar-user-text"><div class="sidebar-user-name sidebar-user-name--guest">${TEXT.GUEST_NOT_LOGGED_IN}</div><div class="sidebar-user-role">${TEXT.GUEST_TAP_TO_LOGIN}</div></div>
    </button>`;
    userTarget.innerHTML = `${userBlock}
      <button type="button" class="sidebar-footnote" data-action="select-page" data-page="about">${escHtml(TEXT.ABOUT_FOOTNOTE.replace('{feedback}', TEXT.BTN_FEEDBACK))}</button>
      <div class="sidebar-version">v${APP_VERSION}</div>`;
    userTarget.querySelectorAll('[data-action="select-page"]').forEach(b => b.addEventListener('click', () => selectPage(b.dataset.page)));
  }
  const nav = document.getElementById('sidebar-nav');
  if (nav) {
    nav.innerHTML = pagesForRole().map((p, i) => `<button type="button" class="sidebar-item${p.id === state.page ? ' active' : ''}" data-page="${p.id}">
      <span class="sidebar-item-index" aria-hidden="true">${String(i + 1).padStart(CONFIG.SIDEBAR_INDEX_PAD, '0')}</span>
      <span class="sidebar-item-body"><span class="sidebar-item-label"><span>${escHtml(p.label)}</span></span>
      <span class="sidebar-item-descwrap"><span class="sidebar-item-desc">${escHtml(p.desc || '')}</span></span></span>
      ${BADGE_PAGES.includes(p.id) ? `<span class="sidebar-dot hidden" id="sidebar-${p.id}-dot"></span>` : ''}</button>`).join('');
    nav.querySelectorAll('.sidebar-item').forEach(b => b.addEventListener('click', () => selectPage(b.dataset.page)));
  }
  const invite = document.getElementById('sidebar-invite');
  if (invite) invite.classList.toggle('hidden', !isAdmin);
}

export function selectPage(pageId) {
  const prevPage = state.page;
  closeAllModals();
  document.querySelectorAll('#client-main .client-page').forEach(s => s.classList.toggle('hidden', s.dataset.page !== pageId));
  document.querySelectorAll('#sidebar-nav .sidebar-item').forEach(b => b.classList.toggle('active', b.dataset.page === pageId));
  // leave hook: v1 parity — modules tear down page-local resources on switch
  // (chat stops polling, aborts staged uploads, marks the open conversation read)
  const prev = pagesForRole().find(p => p.id === prevPage);
  if (prev && typeof prev.leave === 'function' && prevPage !== pageId) prev.leave();
  state.page = pageId;
  savePageState(pageId);
  const cfg = pagesForRole().find(p => p.id === pageId);
  if (cfg && cfg.auth !== false && authGuard) {
    if (!authGuard()) return;
  }
  if (cfg && cfg.enter) cfg.enter();
  closeSidebar();
  const main = document.getElementById('client-main');
  if (main) main.scrollTop = 0;
}

export async function loadInto(elId, fetcher, renderer, opts = {}) {
  const el = document.getElementById(elId);
  if (!el) return false;
  const seq = opts.seqKey ? (loadSeqs[opts.seqKey] = (loadSeqs[opts.seqKey] || 0) + 1) : null;
  const cachedHit = typeof opts.peek === 'function' && opts.peek() != null;
  if (!cachedHit) el.innerHTML = `<div class="empty-state">${loaderHtml()}</div>`;
  try {
    const data = await fetcher();
    if (seq != null && seq !== loadSeqs[opts.seqKey]) return false;
    const rows = opts.pick ? opts.pick(data) : data;
    const target = document.getElementById(elId);
    if (!target) return false;
    if (!rows || !rows.length) { target.innerHTML = `<div class="empty-state"><p>${opts.empty || ''}</p></div>`; return true; }
    target.innerHTML = renderer(rows);
    applyTabBindings(target);   // equivalent binding for segTabsHtml data-tab-action
    applyBarWidths(target);     // matchRowsHtml data-bar-w -> --bar-w
    bindSegmentInputs(target);  // dynamic form segments rendered via loadInto
    target.querySelectorAll('.time-slots').forEach(c => bindTimeSlotTree(c));
    if (opts.reveal !== false) initReveals(target);
    return true;
  } catch (err) {
    if (seq != null && seq !== loadSeqs[opts.seqKey]) return false;
    const target = document.getElementById(elId);
    if (target) target.innerHTML = `<div class="empty-state"><p>${TEXT.ERROR_LOAD_PREFIX}${escHtml(err.message)}</p></div>`;
    return false;
  }
}
const BADGE_PAGES = ['my-chats', 'browse-demands', 'my-demands', 'notifications', 'my-contracts', 'admin-feedback'];
let badgePollTimer = null;
export function setBadge(pageId, n) {
  const dot = document.getElementById(`sidebar-${pageId}-dot`);
  if (dot) dot.classList.toggle('hidden', !n);
}
export function startBadgePoll() { stopBadgePoll(); refreshBadges(); badgePollTimer = setInterval(refreshBadges, CONFIG.BADGE_POLL_MS); }
export function stopBadgePoll() {
  if (badgePollTimer) { clearInterval(badgePollTimer); badgePollTimer = null; }
  BADGE_PAGES.forEach(p => setBadge(p, 0));
}
export async function refreshBadges() {
  if (!state.user) return;
  try {
    const [convData, notifData] = await Promise.all([
      dhGet('/api/conversations', { domain: 'chat' }),
      dhGet('/api/notifications', { domain: 'notifications' }),
    ]);
    const chatUnread = (convData.conversations || []).reduce((s, c) => s + (c.unread_count || 0), 0);
    const notifUnread = (notifData.notifications || []).filter(n => !n.is_read).length;
    if (state.page !== 'my-chats') setBadge('my-chats', chatUnread);
    if (state.page !== 'notifications') setBadge('notifications', notifUnread);
    if (state.user.role === 'teacher') {
      const pushData = await dhGet('/api/demand-pushes', { domain: 'demands' });
      if (state.page !== 'browse-demands') setBadge('browse-demands', (pushData.pushes || []).length);
      setBadge('my-demands', 0);
    } else if (state.user.role === 'student') {
      const demandData = await dhGet('/api/student/demands?scope=mine', { domain: 'demands' });
      setBadge('my-demands', (demandData.demands || []).filter(d => d.pending_intents > 0).length);
      setBadge('browse-demands', 0);
    } else {
      setBadge('browse-demands', 0); setBadge('my-demands', 0);
      try {
        const fbData = await dhGet('/api/feedbacks', { domain: 'admin' });
        if (state.page !== 'admin-feedback') setBadge('admin-feedback', (fbData.feedbacks || []).filter(f => f.status !== 'resolved').length);
      } catch { /* silent */ }
    }
  } catch { /* badge polling is silent */ }
}
export function closeSidebar() { document.body.classList.remove('sidebar-open'); }
export function toggleSidebar() { document.body.classList.toggle('sidebar-open'); }
export function stopRouter() { stopBadgePoll(); stopVersionProbe(); }
