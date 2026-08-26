/**
 * v2 modal core: parity migration of app-ui.js modal/confirm/reauth primitives.
 * No inline handlers; buttons are bound as DOM nodes.
 */
import { CONFIG } from '../../shared/config.js';
import { TEXT } from '../constants/text.js';
import { escHtml, mdRender } from './dom.js';
import { api } from './api.js';
import { closeHostOverlays } from './anim.js';
import { registerLogoutReset } from './state.js';

let _modalStack = [];
let pendingConfirmAction = null;
let reAuthAction = null;
// ZK: full-screen image lightbox state — single instance (F3), Esc handler, body scroll lock counter.
let _imageViewerOpen = false;
let _imageViewerKey = null;
let _bodyLockCount = 0;

export function openModal({ title, titleId = '', body = '', footer = '', closable = true, cls = '', style = '', bodyCls = '', replace = false } = {}) {
  const host = typeof document !== 'undefined' ? document.getElementById('modal-container') : null;
  if (!host) return null;
  closeHostOverlays(host);
  const cur = host.firstElementChild;
  if (cur && !replace) _modalStack.push(cur);
  const root = document.createElement('div');
  root.className = 'modal-overlay';
  if (closable) root.addEventListener('click', e => { if (e.target === root) closeModal(); });
  const modal = document.createElement('div');
  modal.className = `modal glass glass--float${cls ? ` ${cls}` : ''}`;
  if (style) modal.style.cssText = style;
  const header = title != null
    ? `<div class="modal-header"><h2${titleId ? ` id="${titleId}"` : ''}>${escHtml(title)}</h2><button type="button" class="btn btn-ghost btn-icon glass glass--pressable" aria-label="${TEXT.BTN_CLOSE}">✕</button></div>`
    : '';
  modal.innerHTML = `${header}<div class="modal-body${bodyCls ? ` ${bodyCls}` : ''}">${body}${footer ? `<div class="modal-footer">${footer}</div>` : ''}</div>`;
  const x = modal.querySelector('.modal-header button');
  if (x) x.addEventListener('click', closeModal);
  root.appendChild(modal);
  host.innerHTML = '';
  host.appendChild(root);
  return host;
}

export function closeModal() {
  if (_imageViewerOpen) { closeImageViewer(); return; } // ZK-L1: lightbox is the active overlay — close it, never corrupt stack/lock state
  const host = typeof document !== 'undefined' ? document.getElementById('modal-container') : null;
  if (!host) return;
  closeHostOverlays(host);
  const prev = _modalStack.pop();
  host.innerHTML = '';
  if (prev) host.appendChild(prev);
}

export function closeAllModals() {
  _modalStack.length = 0;
  if (_imageViewerOpen) closeImageViewer(); // ZK: a full-screen lightbox must not survive a global close (logout/navigation)
  const host = typeof document !== 'undefined' ? document.getElementById('modal-container') : null;
  if (host) host.innerHTML = '';
}

export function openPolicyModal(key) {
  const isPrivacy = key === TEXT.POLICY_KEY_PRIVACY;
  const name = isPrivacy ? TEXT.AGREE_LINK_PRIVACY : TEXT.AGREE_LINK_AGREEMENT;
  const md = isPrivacy ? TEXT.POLICY_PRIVACY : TEXT.POLICY_AGREEMENT;
  openModal({ title: name, cls: 'modal--wide', bodyCls: 'contract-md policy-md', body: `<div class="policy-body">${mdRender(md)}</div>` });
}

// ZK: full-screen image lightbox — large contained image on a full-viewport dim overlay.
// Click on the surrounding dim area or Esc closes; body scroll is locked while open.
// Reuses the .modal-overlay host (fixed inset 0 + flex + margin:auto centering) and stacks
// any underlying modal the same way openModal does. The old openModal-based image viewer
// (title-less modal with a footer close button) is replaced — chat/complaints callers inherit
// this via the same exported name.
export function openImageViewer(src) {
  if (_imageViewerOpen) return; // F3: singleton — never stack two viewers
  const host = typeof document !== 'undefined' ? document.getElementById('modal-container') : null;
  if (!host) return;
  closeHostOverlays(host);
  const cur = host.firstElementChild;
  if (cur) _modalStack.push(cur); // preserve an underlying modal (same stacking as openModal)
  _imageViewerOpen = true;
  _bodyLockCount += 1;
  document.body.classList.add('image-viewer-lock');
  const root = document.createElement('div');
  root.className = 'modal-overlay image-viewer-modal';
  const img = document.createElement('img');
  img.className = 'image-viewer-img';
  img.src = src;
  img.alt = '';
  root.appendChild(img);
  root.addEventListener('click', e => { if (e.target === root) closeImageViewer(); });
  _imageViewerKey = e => { if (e.key === 'Escape') closeImageViewer(); };
  document.addEventListener('keydown', _imageViewerKey);
  host.innerHTML = '';
  host.appendChild(root);
}

export function closeImageViewer() {
  if (!_imageViewerOpen) return;
  _imageViewerOpen = false;
  if (_imageViewerKey) { document.removeEventListener('keydown', _imageViewerKey); _imageViewerKey = null; }
  _bodyLockCount = Math.max(0, _bodyLockCount - 1);
  if (_bodyLockCount === 0) document.body.classList.remove('image-viewer-lock');
  const host = typeof document !== 'undefined' ? document.getElementById('modal-container') : null;
  if (!host) return;
  host.innerHTML = '';
  const prev = _modalStack.pop();
  if (prev) host.appendChild(prev);
}

export function confirm({ title = null, message = '', needReAuth = false, okText = TEXT.BTN_CONFIRM, onConfirm } = {}) {
  const msg = escHtml(message);
  const body = needReAuth
    ? `<p class="confirm-msg">${msg}</p>
      <div class="form-group reauth-group">
        <label class="form-label">${TEXT.REAUTH_PASSWORD_LABEL} <span class="req">*</span></label>
        <input type="password" class="form-input" id="reauth-password" placeholder="${TEXT.REAUTH_PASSWORD_HINT}" autocomplete="current-password">
        <p class="form-hint form-hint--error hidden" id="reauth-err"></p>
      </div>`
    : `<p class="confirm-msg">${msg}</p>`;
  const footer = `<button type="button" class="btn btn-outline glass glass--pressable" data-action="ui.closeModal">${TEXT.BTN_CANCEL}</button>
    <button type="button" class="btn glass glass--pressable" data-action="${needReAuth ? 'ui.runReAuth' : 'ui.runPendingConfirm'}">${escHtml(okText)}</button>`;
  if (needReAuth) reAuthAction = onConfirm; else pendingConfirmAction = onConfirm;
  openModal({
    title, body, footer,
    style: `max-width:${CONFIG.MODAL_W_CONFIRM};`,
    closable: !needReAuth,
  });
  const cancelBtn = document.querySelector('.modal-footer [data-action="ui.closeModal"]');
  if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
  const okBtn = document.querySelector(needReAuth ? '[data-action="ui.runReAuth"]' : '[data-action="ui.runPendingConfirm"]');
  if (okBtn) okBtn.addEventListener('click', needReAuth ? runReAuth : runPendingConfirm);
  if (needReAuth) setTimeout(() => { const i = document.getElementById('reauth-password'); if (i) i.focus(); }, CONFIG.REAUTH_FOCUS_MS);
}

export function runPendingConfirm() {
  closeModal();
  const action = pendingConfirmAction;
  pendingConfirmAction = null;
  if (action) action();
}

export async function runReAuth() {
  const input = document.getElementById('reauth-password');
  const errEl = document.getElementById('reauth-err');
  if (!input || !errEl) return;
  const password = input.value;
  if (!password) { errEl.textContent = TEXT.REAUTH_PASSWORD_HINT; errEl.classList.remove('hidden'); input.focus(); return; }
  try {
    const r = await api('/api/auth/re-auth', { method: 'POST', body: { password } });
    const action = reAuthAction;
    reAuthAction = null;
    closeModal();
    if (action) await action(r.capToken);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
    input.value = '';
    input.focus();
  }
}

registerLogoutReset(() => { pendingConfirmAction = null; reAuthAction = null; });
