/**
 * contract feature actions: sign/read/modify/revoke/cancel/view/verify.
 */
import { CONFIG } from '../../../shared/config.js';
import { STATUS } from '../../../shared/enums.js';
import { TEXT } from '../../constants/text.js';
import { state, registerLogoutReset } from '../../core/state.js';
import { api } from '../../core/api.js';
import { invalidate, dhGet } from '../../core/datahub.js';
import { escHtml, mdRender, fmtDateTime } from '../../core/dom.js';
import { openModal, closeModal, showToast, confirm, withCaptcha, initCustomSelects } from '../../core/ui.js';
import { renderContractDiff, splitContractBiz, stripContractMarker, verifyPanelHtml } from './render.js';
import { loadMyContracts } from './actions-list.js';

// Signing-gate state (contract must be read + scrolled before confirm) and the optimistic
// modify-version guard. Module scope, not window: per-session transient state owned by this
// module. Tests drive it via _signingSetForTests.
let _signingContractId = null;
let _signingElapsed = false;
let _signingScrolled = false;
let _signingOpenedAt = 0;
let _signingTimer = null;
let _contractModifyVersion = 0;

export function _signingSetForTests({ contractId, elapsed, scrolled, timer, modifyVersion } = {}) {
  if (contractId !== undefined) _signingContractId = contractId;
  if (elapsed !== undefined) _signingElapsed = elapsed;
  if (scrolled !== undefined) _signingScrolled = scrolled;
  if (timer !== undefined) _signingTimer = timer;
  if (modifyVersion !== undefined) _contractModifyVersion = modifyVersion;
}
export function _signingStateForTests() {
  return { contractId: _signingContractId, elapsed: _signingElapsed, scrolled: _signingScrolled, timer: _signingTimer, modifyVersion: _contractModifyVersion };
}

export function signReadHint() { return TEXT.SIGN_READ_HINT; }

export function signContract(contractId) {
  const c = state.myContracts.find(x => x.id === contractId);
  if (!c) return;
  _signingContractId = contractId;
  _signingElapsed = false;
  _signingScrolled = false;
  openModal({
    title: TEXT.SIGN_MODAL_TITLE,
    closable: false,
    cls: 'modal--wide',
    body: `<div class="contract-md contract-sign-scroll" id="contract-sign-scroll" data-action="contract.signScroll">${mdRender(stripContractMarker(c.contract_md || ''))}</div>
      <p class="contract-sign-disclose text-sm text-muted">${escHtml(TEXT.SIGN_MODAL_DISCLOSE.replace('{username}', (state.user && state.user.username) || ''))}</p>`,
    footer: `<button type="button" class="btn btn-outline glass glass--pressable" data-action="contract.closeModal">${TEXT.BTN_CANCEL}</button>
      <span class="text-sm text-muted contract-sign-hint" id="contract-sign-hint">${signReadHint()}</span>
      <button type="button" id="contract-sign-btn" class="btn glass glass--pressable" disabled data-action="contract.confirmSign">${TEXT.SIGN_COUNTDOWN_HINT.replace('{secs}', String(CONFIG.CONTRACT_SIGN_READ_SECONDS))}</button>`,
  });
  clearSigningTimer(); // idempotent — reopening must not stack intervals
  _signingOpenedAt = Date.now();
  _signingTimer = setInterval(() => {
    const remain = Math.max(0, CONFIG.CONTRACT_SIGN_READ_SECONDS * 1000 - (Date.now() - _signingOpenedAt));
    if (remain <= 0) {
      clearInterval(_signingTimer);
      _signingElapsed = true;
      updateSignBtnState();
    } else {
      updateSignBtnState(Math.ceil(remain / 1000));
    }
  }, 250);
  setTimeout(onContractSignScroll, 0);
}

export function onContractSignScroll() {
  const el = document.getElementById('contract-sign-scroll');
  if (!el) return;
  const overflow = el.scrollHeight - el.clientHeight;
  _signingScrolled = overflow <= CONFIG.CONTRACT_SIGN_SCROLL_EPS
    || (el.scrollHeight - el.scrollTop - el.clientHeight) <= CONFIG.CONTRACT_SIGN_SCROLL_EPS;
  updateSignBtnState(null, true);
}

export function updateSignBtnState(remainSec, preserveText = false) {
  const btn = document.getElementById('contract-sign-btn');
  if (!btn) return;
  const ready = _signingElapsed && _signingScrolled;
  btn.disabled = !ready;
  if (ready) btn.textContent = TEXT.SIGN_READ_DONE_BTN;
  else if (remainSec != null) btn.textContent = TEXT.SIGN_COUNTDOWN_HINT.replace('{secs}', String(remainSec));
  else if (!preserveText) btn.textContent = TEXT.SIGN_READ_HINT; // elapsed-but-not-scrolled shows the scroll hint, not the misleading ready label (was 'I have read and confirm' while disabled)
  const hint = document.getElementById('contract-sign-hint');
  if (!hint) return;
  hint.textContent = ready ? TEXT.SIGN_READY_HINT : TEXT.SIGN_READ_HINT;
}

export function confirmSignContract() {
  const id = _signingContractId;
  clearSigningTimer();
  confirm({ message: TEXT.CONFIRM_SIGN_TWICE, onConfirm: () => {
    confirm({ message: TEXT.CONFIRM_SIGN_FINAL, needReAuth: true, onConfirm: async capToken => {
      withCaptcha(() => doSignContract(id, capToken));
    }});
  }});
}

export async function doSignContract(id, capToken) {
  try {
    const data = await api(`/api/contracts/${id}/sign`, { method: 'POST', body: { capToken } });
    closeModal();
    showToast(data.signed ? TEXT.CONTRACT_SIGNED_TOAST : TEXT.BTN_SIGN_WAITING);
    invalidate('contracts');
    loadMyContracts();
  } catch (err) { showToast(err.message); }
}

export function viewContract(contractId) {
  const c = state.myContracts.find(x => x.id === contractId);
  if (!c) return;
  const diffHtml = c.prev_business ? renderContractDiff(c.prev_business, splitContractBiz(c.contract_md || '')) : '';
  openModal({
    title: diffHtml ? TEXT.CONTRACT_VIEW_DIFF_TITLE : TEXT.BTN_VIEW_CONTRACT,
    cls: 'modal--wide',
    bodyCls: 'contract-md',
    body: `${diffHtml ? `<div class="contract-diff-head">${escHtml(TEXT.CONTRACT_DIFF_HINT)}</div>
        <div class="contract-diff glass glass--solid">${diffHtml}</div>
        <div class="contract-diff-divider"></div>` : ''}
      ${mdRender(stripContractMarker(c.contract_md || ''))}`,
  });
}

export function openContractModifyModal(contractId) {
  const c = state.myContracts.find(x => x.id === contractId);
  if (!c) return;
  _contractModifyVersion = c.version != null ? c.version : 0;
  openModal({
    title: TEXT.MODIFY_CONTRACT_TITLE,
    closable: false,
    body: `
        <div class="form-group">
          <label class="form-label">${TEXT.LABEL_CONTRACT_PLAN}</label>
          <div class="md-toolbar">
            <button type="button" class="md-btn glass" data-action="contract.mdWrap" data-md="h2">H2</button>
            <button type="button" class="md-btn glass" data-action="contract.mdWrap" data-md="h3">H3</button>
            <button type="button" class="md-btn glass" data-action="contract.mdWrap" data-md="bold">${TEXT.POST_MD_BOLD}</button>
            <button type="button" class="md-btn glass" data-action="contract.preview">${TEXT.POST_PREVIEW_BTN}</button>
          </div>
          <textarea id="post-body" class="form-input post-body-input" rows="12">${escHtml(splitContractBiz(c.contract_md))}</textarea>
          <p class="text-muted text-sm contract-modify-hint">${TEXT.CONTRACT_MODIFY_BIZ_HINT}</p>
        </div>`,
    footer: `<button type="button" class="btn btn-outline glass glass--pressable" data-action="contract.closeModal">${TEXT.BTN_CANCEL}</button>
          <button type="button" class="btn glass glass--pressable" data-action="contract.submitModify" data-id="${c.id}">${TEXT.BTN_SAVE}</button>`,
  });
}


export function openRevokeContractModal(contractId) {
  openModal({
    title: TEXT.REVOKE_MODAL_TITLE,
    cls: 'modal--narrow',
    body: `<p class="danger-warn">${TEXT.REVOKE_CONTRACT_WARN}</p>`,
    footer: `<button type="button" class="btn btn-outline glass glass--pressable" data-action="contract.closeModal">${TEXT.BTN_THINK_AGAIN}</button>
          <button type="button" class="btn btn-outline btn-sm glass glass--pressable" data-action="contract.confirmRevoke" data-id="${contractId}">${TEXT.BTN_CONTINUE_DANGER}</button>`,
  });
}

export function confirmRevokeContract(contractId) {
  confirm({ message: TEXT.REVOKE_CONTRACT_FINAL, needReAuth: true, onConfirm: async capToken => {
    withCaptcha(() => doRevokeContract(contractId, capToken));
  }});
}

export async function doRevokeContract(contractId, capToken) {
  try {
    await api(`/api/contracts/${contractId}/revoke`, { method: 'POST', body: { capToken } });
    showToast(TEXT.CONTRACT_REVOKED_TOAST);
    invalidate('contracts');
    loadMyContracts();
  } catch (err) { showToast(err.message); }
}

export async function verifyContractLedgerUi(contractId) {
  try {
    const data = await api(`/api/contracts/${contractId}/verify`);
    if (!data.recorded) { showToast(TEXT.CONTRACT_LEDGER_NONE); return; }
    openModal({
      title: TEXT.CONTRACT_VERIFY_PANEL_TITLE,
      cls: 'modal--wide',
      bodyCls: 'contract-md',
      body: verifyPanelHtml(contractId, data),
    });
  } catch (err) { showToast(err.message); }
}

export async function submitContractModify(contractId) {
  const md = (document.getElementById('post-body').value || '').trim();
  if (!md) { showToast(TEXT.CONTRACT_EMPTY, 'error'); return; }
  try {
    const data = await api(`/api/contracts/${contractId}`, { method: 'PUT', body: { contractMd: md, version: _contractModifyVersion } });
    closeModal();
    if (!(data && data.unchanged)) showToast(TEXT.CONTRACT_MODIFIED_TOAST);
    invalidate('contracts');
    loadMyContracts();
  } catch (err) {
    if (err.code === 'CONTRACT_MODIFIED_CONFLICT') {
      try {
        const fresh = await dhGet('/api/contracts/my', { domain: 'contracts', forceRefresh: true });
        const c = (fresh.contracts || []).find(x => x.id === contractId);
        if (c && c.version != null) _contractModifyVersion = c.version;
      } catch { /* silent */ }
    }
    showToast(err.message, 'error');
  }
}

export function cancelContract(contractId) {
  confirm({ message: TEXT.CONFIRM_CANCEL_CONTRACT, needReAuth: true, onConfirm: async capToken => {
    withCaptcha(() => doCancelContract(contractId, capToken));
  }});
}

export async function doCancelContract(contractId, capToken) {
  try {
    await api(`/api/contracts/${contractId}`, { method: 'DELETE', body: { capToken } });
    showToast(TEXT.CONTRACT_CANCELLED_TOAST);
    invalidate('contracts');
    loadMyContracts();
  } catch (err) { showToast(err.message); }
}

export function mdWrap(mode) {
  const ta = document.getElementById('post-body');
  if (!ta) return;
  const start = ta.selectionStart, end = ta.selectionEnd;
  if (mode === 'bold') {
    const sel = ta.value.slice(start, end);
    const surrounded = ta.value.slice(Math.max(0, start - 2), start) === '**' && ta.value.slice(end, end + 2) === '**';
    if (sel.length >= 4 && sel.startsWith('**') && sel.endsWith('**')) {
      const inner = sel.slice(2, -2);
      ta.value = ta.value.slice(0, start) + inner + ta.value.slice(end);
      ta.setSelectionRange(start, start + inner.length);
    } else if (surrounded) {
      ta.value = ta.value.slice(0, start - 2) + sel + ta.value.slice(end + 2);
      ta.setSelectionRange(start - 2, start - 2 + sel.length);
    } else {
      const inner = sel || TEXT.POST_MD_BOLD_DEFAULT;
      ta.value = ta.value.slice(0, start) + '**' + inner + '**' + ta.value.slice(end);
      ta.setSelectionRange(start + 2, start + 2 + inner.length);
    }
  } else {
    const prefix = mode === 'h3' ? '### ' : '## ';
    const other = mode === 'h3' ? '## ' : '### ';
    const lineStart = ta.value.lastIndexOf('\n', start - 1) + 1;
    let lineEnd = ta.value.indexOf('\n', end);
    if (lineEnd === -1) lineEnd = ta.value.length;
    const block = ta.value.slice(lineStart, lineEnd);
    const newBlock = block.split('\n').map(ln => {
      if (ln.startsWith(prefix)) return ln.slice(prefix.length);
      const bare = ln.startsWith(other) ? ln.slice(other.length) : ln;
      return prefix + bare;
    }).join('\n');
    ta.value = ta.value.slice(0, lineStart) + newBlock + ta.value.slice(lineEnd);
    ta.setSelectionRange(lineStart, lineStart + newBlock.length);
  }
  ta.focus();
}

export function preview() {
  const ta = document.getElementById('post-body');
  const html = ta ? mdRender(ta.value) : '';
  openModal({
    title: TEXT.POST_PREVIEW_BTN,
    cls: 'modal--wide',
    bodyCls: 'contract-md',
    body: html || `<p class="md-preview-empty">${TEXT.CONTRACT_EMPTY}</p>`,
  });
}

// clearSigningTimer single point — modal close (contract.closeModal), sign-confirm,
// and logout (registerLogoutReset) all release the interval so it never keeps ticking detached
export function clearSigningTimer() {
  if (_signingTimer) { clearInterval(_signingTimer); _signingTimer = null; }
}

export function closeModalAction() {
  clearSigningTimer();
  closeModal();
}
registerLogoutReset(clearSigningTimer);
