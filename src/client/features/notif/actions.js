/**
 * notif actions: notification page lifecycle + read/block semantics (v1 app-shell parity).
 *   - enterNotifications: badge zero + block-btn sync + loadInto with broadcast filter
 *   - markNotifRead: single-item POST with optimistic flip + rollback on failure
 *   - markAllNotifsRead: leave-page batch read (seen-removed), optimistic + rollback
 *   - toggleNotifBlock: client preference (localStorage) + instant list re-render
 * _notifList mirrors the datahub cache array (same reference via dhOnDomainRefresh re-hang)
 * so badge counts / block filtering / read flips stay consistent without refetch.
 */
import { registerLogoutReset } from '../../core/state.js';
import { api } from '../../core/api.js';
import { escHtml } from '../../core/dom.js';
import { dhGet, dhPeek, dhReady, dhOnDomainRefresh } from '../../core/datahub.js';
import { loadInto, setBadge } from '../../core/router.js';
import { notifBlockOn, setNotifBlock, isBroadcastNotif } from '../../core/notif-pref.js';
import { renderNotifItem } from './render.js';
import { TEXT } from './text.js';

let _notifList = [];

// Probe refresh replaces the cache array -- re-hang so block filtering and read flips
// keep working on the same reference (audit M1).
dhOnDomainRefresh('notifications', () => {
  const c = dhPeek('/api/notifications');
  if (c && c.notifications) _notifList = c.notifications;
});

// Re-render from _notifList by preference, no refetch.
function renderNotifList() {
  const el = document.getElementById('notifications-content');
  if (!el || !_notifList.length) return;
  const shown = notifBlockOn() ? _notifList.filter(n => !isBroadcastNotif(n)) : _notifList;
  el.innerHTML = shown.length ? shown.map(renderNotifItem).join('')
    : `<div class="empty-state"><p>${escHtml(TEXT.NOTIF_FILTER_EMPTY)}</p></div>`;
}

// Button text + selected state from persisted preference.
export function syncNotifBlockBtn() {
  const btn = document.getElementById('btn-notif-block');
  if (!btn) return;
  const on = notifBlockOn();
  btn.classList.toggle('notif-block-btn--on', on);
  btn.textContent = on ? TEXT.NOTIF_BLOCK_ON : TEXT.NOTIF_BLOCK_OFF;
}

export function toggleNotifBlock() {
  setNotifBlock(!notifBlockOn());
  syncNotifBlockBtn();
  renderNotifList();
}

export async function enterNotifications() {
  setBadge('notifications', 0); // badge clears the instant the page opens (poll skips current page)
  syncNotifBlockBtn();
  await loadInto('notifications-content', async () => {
    const data = await dhGet('/api/notifications', { domain: 'notifications' });
    _notifList = data.notifications || [];
    return _notifList;
  }, rows => {
    const shown = notifBlockOn() ? rows.filter(n => !isBroadcastNotif(n)) : rows;
    if (!shown.length) return `<div class="empty-state"><p>${escHtml(TEXT.NOTIF_FILTER_EMPTY)}</p></div>`;
    return shown.map(renderNotifItem).join('');
  }, { empty: TEXT.EMPTY_NO_NOTIFICATIONS, peek: () => dhReady('/api/notifications') });
  // Unread persists until tapped (markNotifRead); the badge reflects the remainder via polling.
}

// Single read: optimistic local flip, POST to persist, rollback on failure.
export async function markNotifRead(id) {
  if (!/^\d+$/.test(String(id || ''))) return;
  const item = _notifList.find(n => String(n.id) === String(id));
  if (!item || item.is_read) return;
  const el = document.querySelector(`.notif-item[data-id="${id}"]`);
  item.is_read = 1;
  if (el) applyNotifReadVisual(el, true);
  try {
    await api(`/api/notifications/${id}/read`, { method: 'POST', body: {} });
  } catch {
    item.is_read = 0;
    if (el) applyNotifReadVisual(el, false);
  }
}

// Seen-removed: batch-read everything displayed when leaving the page. No-op if never entered.
export async function markAllNotifsRead() {
  const unread = _notifList.filter(n => !n.is_read);
  if (!unread.length) return;
  const ids = unread.map(n => String(n.id));
  unread.forEach(n => { n.is_read = 1; });
  ids.forEach(id => { const el = document.querySelector(`.notif-item[data-id="${id}"]`); if (el) applyNotifReadVisual(el, true); });
  try {
    await api('/api/notifications/read-all', { method: 'POST', body: {} });
  } catch {
    unread.forEach(n => { n.is_read = 0; });
    ids.forEach(id => { const el = document.querySelector(`.notif-item[data-id="${id}"]`); if (el) applyNotifReadVisual(el, false); });
  }
}

// Unread <-> read visual + interaction state swap (data-action delegation, no inline attrs).
export function applyNotifReadVisual(el, read) {
  el.classList.toggle('unread', !read);
  const dot = el.querySelector('.notif-dot');
  if (dot) dot.classList.toggle('read', read);
  const id = el.getAttribute('data-id') || '';
  if (read) {
    el.removeAttribute('role'); el.removeAttribute('tabindex');
    el.removeAttribute('aria-label'); el.removeAttribute('data-action');
  } else if (id) { // rollback: restore unread interaction so the item can be re-tapped
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', TEXT.NOTIF_READ_ARIA);
    el.setAttribute('data-action', 'notif.markRead');
  }
}

// Account switch / logout: drop the previous account's notification mirror.
registerLogoutReset(() => { _notifList = []; });

export { _notifList };
