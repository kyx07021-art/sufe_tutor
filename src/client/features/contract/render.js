/**
 * contract feature renderers: cards, signing progress, diffs, verify panel.
 * No inline handlers or inline style attributes.
 */
import { CONFIG } from '../../../shared/config.js';
import { STATUS } from '../../../shared/enums.js';
import { escHtml, fmtDateTime } from '../../core/dom.js';
import { state } from '../../core/state.js';
import { methodName, deactivatedTag } from '../../core/display.js';
import { contractStatusMeta, diffLines } from './display.js';
import { demandIdText, demandOptionText, demandTargetNames, expectedTimeText } from '../student/display.js';
import { mdRender } from '../../core/dom.js';
import { TEXT } from '../../constants/text.js';

export const CONTRACT_BIZ_END = '<!-- ' + String.fromCharCode(0x4e1a, 0x52a1, 0x6761, 0x6b3e, 0x7ed3, 0x675f);

export function splitContractBiz(md) {
  return String(md || '').split(CONTRACT_BIZ_END)[0].trim();
}

export function stripContractMarker(md) {
  return String(md || '').replace(new RegExp(CONTRACT_BIZ_END.replace(' ', '\\s*') + '[^\n]*\n?', 'g'), '');
}

export function contractActionable(c) {
  const iAmDrafter = c.drafter_user_id === state.user.id;
  if (c.status === STATUS.PENDING || c.status === STATUS.SIGNING) return !(iAmDrafter ? c.drafter_confirmed : c.other_confirmed);
  return false;
}

export function contractSignProgress(c) {
  const studentSigned = (c.drafter_user_id === c.student_user_id ? c.drafter_confirmed : c.other_confirmed) ? 1 : 0;
  const teacherSigned = (c.drafter_user_id === c.teacher_user_id ? c.drafter_confirmed : c.other_confirmed) ? 1 : 0;
  return `${studentSigned ? TEXT.CONTRACT_PARTY_SIGNED_A : TEXT.CONTRACT_PARTY_PENDING_A} · ${teacherSigned ? TEXT.CONTRACT_PARTY_SIGNED_B : TEXT.CONTRACT_PARTY_PENDING_B}`;
}

export function renderContractCard(c) {
  const me = state.user.id;
  const iAmDrafter = c.drafter_user_id === me;
  const peerName = me === c.student_user_id ? c.teacher_name : c.student_name;
  const methodNameText = methodName(c.method) || c.method;
  const { text: statusText, cls: statusCls } = contractStatusMeta(c);
  const myConfirmed = iAmDrafter ? c.drafter_confirmed : c.other_confirmed;
  let left = '', right = '';
  if (c.revoked) {
    const revokeText = c.revoked_by === me ? TEXT.CONTRACT_REVOKED_BY_ME : TEXT.CONTRACT_REVOKED_BY_PEER;
    left = `<span class="contract-wait-text ${c.revoked_by === me ? 'text-danger' : 'text-muted'}">${revokeText}</span>
      <button type="button" class="btn btn-soft btn-sm glass glass--pressable" data-action="contract.view" data-id="${c.id}">${TEXT.BTN_VIEW_CONTRACT}</button>`;
  } else if (c.status === STATUS.SIGNED) {
    left = `<button type="button" class="btn btn-soft btn-sm glass glass--pressable" data-action="contract.view" data-id="${c.id}">${TEXT.BTN_VIEW_CONTRACT}</button>
      <button type="button" class="btn btn-ghost btn-sm glass glass--pressable" data-action="contract.verify" data-id="${c.id}">${TEXT.BTN_VERIFY_LEDGER}</button>`;
    right = `<button type="button" class="btn-text-danger glass" data-action="contract.revoke" data-id="${c.id}">${TEXT.BTN_REVOKE_CONTRACT}</button>`;
  } else {
    left = `${myConfirmed
        ? `<span class="contract-wait-text text-muted">${TEXT.BTN_SIGN_WAITING}</span>`
        : `<button type="button" class="btn btn-soft btn-sm glass glass--pressable" data-action="contract.sign" data-id="${c.id}">${TEXT.BTN_SIGN}</button>`}
      ${myConfirmed ? '' : `<button type="button" class="btn btn-soft btn-sm glass glass--pressable" data-action="contract.modify" data-id="${c.id}">${TEXT.BTN_MODIFY_CONTRACT}</button>`}
      <button type="button" class="btn btn-soft btn-sm glass glass--pressable" data-action="contract.view" data-id="${c.id}">${TEXT.BTN_VIEW_CONTRACT}</button>`;
    right = `<button type="button" class="btn btn-soft btn-sm glass glass--pressable" data-action="contract.cancel" data-id="${c.id}">${TEXT.BTN_CANCEL_CONTRACT}</button>`;
  }
  return `<div class="list-card glass">
    <div class="list-card-header">
      <span class="list-card-title">${escHtml(peerName)}${deactivatedTag(peerName)}</span>
      <span class="tag glass glass--solid ${statusCls}">${statusText}</span>
    </div>
    <div class="list-card-body">
      <span class="tag glass glass--solid">${escHtml(methodNameText)}</span>
      <span class="tag tag-warn glass glass--solid">${c.hourly_rate}${TEXT.PRICE_UNIT}</span>
      ${c.demand_display_id ? `<span class="tag glass glass--solid">${escHtml(demandIdText(c.demand_display_id))}</span>` : ''}
      <span class="list-card-meta">${fmtDateTime(c.updated_at)}</span>
    </div>
    ${c.status === STATUS.SIGNING
      ? `<p class="contract-sign-progress text-sm text-muted">${contractSignProgress(c)}</p>`
      : c.status === STATUS.SIGNED
        ? `<p class="contract-sign-progress text-sm">${escHtml(TEXT.CONTRACT_SIGN_DONE_BOTH)}</p>`
        : ''}
    <div class="contract-actions">
      <div class="contract-actions-left">${left}</div>
      ${right}
    </div>
  </div>`;
}

export function renderContractDiff(prev, current) {
  const ops = diffLines(prev, current);
  const changed = ops.some(o => o.t !== 'same');
  if (!changed) return '';
  return ops.map(o => {
    const cls = o.t === 'del' ? 'diff-line diff-del' : o.t === 'add' ? 'diff-line diff-add' : 'diff-line diff-same';
    const sign = o.t === 'del' ? '−' : o.t === 'add' ? '+' : ' ';
    return `<div class="${cls}"><span class="diff-sign">${sign}</span><span>${escHtml(o.text) || '&nbsp;'}</span></div>`;
  }).join('');
}

export function verifyPanelHtml(contractId, data) {
  const verdict = data.archived ? TEXT.CONTRACT_LEDGER_ARCHIVED
    : data.valid ? TEXT.CONTRACT_LEDGER_VALID : TEXT.CONTRACT_LEDGER_INVALID;
  const chainBits = [
    `${data.headValid ? '✓' : '✗'}${TEXT.CONTRACT_VERIFY_LABEL_HEAD}`,
    `${data.linksValid ? '✓' : '✗'}${TEXT.CONTRACT_VERIFY_LABEL_LINK}`,
    `${data.seqValid ? '✓' : '✗'}${TEXT.CONTRACT_VERIFY_LABEL_SEQ}`,
  ].join('　');
  const rows = data.entryList || [];
  return `<p class="contract-verify-verdict ${data.valid ? 'contract-verify--ok' : 'contract-verify--bad'}">${escHtml(verdict)}</p>
    <div class="contract-verify-grid">
      <div class="contract-verify-row"><span class="text-muted">${escHtml(TEXT.CONTRACT_VERIFY_FLOW)}</span><code>${TEXT.CONTRACT_VERIFY_CD_PREFIX}${String(contractId).padStart(6, '0')}</code></div>
      <div class="contract-verify-row"><span class="text-muted">${escHtml(TEXT.CONTRACT_VERIFY_HASH)}</span><code class="contract-verify-hash">${escHtml(data.contentHash)}</code></div>
      <div class="contract-verify-row"><span class="text-muted">${escHtml(TEXT.CONTRACT_VERIFY_ENTRIES)}</span><span>${data.entries} ${TEXT.CONTRACT_VERIFY_ENTRY_UNIT} · ${escHtml(chainBits)}</span></div>
    </div>
    ${rows.length ? `<div class="contract-verify-list">${rows.map(e =>
      `<div class="contract-verify-entry"><span>#${e.seq == null ? '?' : e.seq}</span><span>${fmtDateTime(e.createdAt)}</span></div>`).join('')}</div>` : ''}`;
}

export { diffLines } from './display.js';
export { demandOptionText, expectedTimeText };
