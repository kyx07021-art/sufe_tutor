/**
 * contract feature actions: signing request and contract draft modals.
 */
import { CONFIG } from '../../../shared/config.js';
import { TEACHING_METHODS } from '../../../shared/enums.js';
import { TEXT } from '../../constants/text.js';
import { api, ensureAuth } from '../../core/api.js';
import { openModal, closeModal, showToast, initCustomSelects, syncCustomSelectText, withCaptcha } from '../../core/ui.js';
import { renderTimeSlotContainerHtml, validateTimeSlots, collectTimeSlots, prefillTimeSlots, dateFieldHtml, readDateField } from '../../core/ui-form.js';
import { demandOptionText, demandTargetNames, expectedTimeText } from '../student/display.js';
import { loaderHtml, escHtml } from '../../core/dom.js';
import { invalidate } from '../../core/datahub.js';
import { chatConvById } from './actions-chat-bridge.js';

export { chatConvById };

function collectScheduleText(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return '';
  const slots = collectTimeSlots(container);
  return slots.length ? expectedTimeText(JSON.stringify(slots)) : '';
}

export async function openSigningModal(convId) {
  if (!ensureAuth()) return;
  openModal({ title: TEXT.SIGNING_MODAL_TITLE, closable: false, body: `<div class="empty-state">${loaderHtml()}</div>` });
  let demands = [], demandsFailed = false;
  try { const data = await api(`/api/conversations/${convId}/bindable-demands?phase=signing`); demands = data.demands || []; }
  catch { demandsFailed = true; }
  window._signingDemands = demands;
  openModal({
    title: TEXT.SIGNING_MODAL_TITLE,
    closable: false,
    replace: true,
    body: `
        <p class="text-sm text-muted signing-modal-hint">${TEXT.SIGNING_MODAL_HINT}</p>
        <div class="form-group">
          <label class="form-label">${TEXT.SIGNING_DEMAND_LABEL} <span class="req">*</span></label>
          <select class="form-select" id="signing-demand" data-change="contract.prefillSigningTimeSlots">
            ${demands.length
              ? `<option value="">${TEXT.SIGNING_DEMAND_PLACEHOLDER}</option>` +
                demands.map(d => `<option value="${d.id}">${escHtml(demandOptionText(d))}</option>`).join('')
              : `<option value="" disabled>${TEXT.SIGNING_NO_DEMAND_HINT}</option>`}
          </select>
          ${demandsFailed ? `<p class="text-sm text-muted">${TEXT.SIGNING_DEMANDS_LOAD_FAIL}</p>` : ''}
        </div>
        <div class="form-group">
          <label class="form-label">${TEXT.LABEL_SIGNING_PRICE} <span class="req">*</span></label>
          <input type="number" id="signing-price" class="form-input" min="0" step="1" placeholder="${TEXT.SIGNING_PRICE_PLACEHOLDER}">
        </div>
        <div class="form-group">
          <label class="form-label">${TEXT.LABEL_SIGNING_SCHEDULE} <span class="req">*</span></label>
          <div id="signing-time-slots" class="time-slots">${renderTimeSlotContainerHtml()}</div>
        </div>
        <div class="form-group">
          <label class="form-label">${TEXT.LABEL_SIGNING_METHOD}</label>
          <select id="signing-method" class="form-select">
            <option value="online">${TEXT.SIGNING_METHOD_ONLINE}</option>
            <option value="offline" selected>${TEXT.SIGNING_METHOD_OFFLINE}</option>
          </select>
        </div>
        <p class="funds-note">${TEXT.FUNDS_NOTE}</p>`,
    footer: `<button type="button" class="btn btn-outline glass glass--pressable" data-action="contract.closeModal">${TEXT.BTN_CANCEL}</button>
          <button type="button" class="btn glass glass--pressable" data-action="contract.submitSigning" data-id="${convId}">${TEXT.BTN_SIGNING_SEND}</button>`,
  });
  const m = document.getElementById('signing-method');
  if (m && m.closest) initCustomSelects(m.closest('.modal'));
}

export function prefillSigningTimeSlots() {
  const sel = document.getElementById('signing-demand');
  if (!sel) return;
  const d = (window._signingDemands || []).find(x => String(x.id) === String(sel.value));
  const container = document.getElementById('signing-time-slots');
  if (!d || !container || container.querySelectorAll('.time-slot').length) return;
  prefillTimeSlots(container, d.expected_time || '');
}

export async function submitSigning(convId) {
  const demandId = parseInt(document.getElementById('signing-demand').value) || null;
  const price = +document.getElementById('signing-price').value || 0;
  const tsErr = validateTimeSlots(document.getElementById('signing-time-slots'));
  const schedule = collectScheduleText('signing-time-slots');
  const method = document.getElementById('signing-method').value;
  if (!demandId) { showToast(TEXT.VALIDATE_SIGNING_DEMAND); return; }
  if (price <= 0) { showToast(TEXT.VALIDATE_SIGNING_PRICE); return; }
  if (tsErr) { showToast(tsErr); return; }
  if (!schedule) { showToast(TEXT.VALIDATE_SIGNING_SCHEDULE); return; }
  withCaptcha(() => doSubmitSigning(convId, { demandId, price, schedule, method }));
}

let signingBusy = false; // Q-4a-M2: double-submit guard — POST in-flight while modal closed via header X then reopened+resubmitted would create a duplicate signing request (mirrors contractDraftBusy)
export async function doSubmitSigning(convId, { demandId, price, schedule, method }) {
  if (signingBusy) return;
  signingBusy = true;
  try {
    await api(`/api/conversations/${convId}/signing`, { method: 'POST', body: { demandId, price, schedule, method } });
    closeModal();
    showToast(TEXT.SIGNING_REQUEST_SENT_TOAST);
  } catch (err) { showToast(err.message); }
  finally { signingBusy = false; }
}


export async function openContractDraftModal(convId) {
  if (!ensureAuth()) return;
  openModal({ title: null, closable: false, body: loaderHtml() });
  let demands = [], demandsFailed = false;
  try { const data = await api(`/api/conversations/${convId}/bindable-demands?phase=contract`); demands = data.demands || []; }
  catch { demandsFailed = true; }
  const conv = chatConvById ? chatConvById(convId) : null;
  const preselect = (conv && demands.find(d => d.id === conv.demand_id)) || null;
  window._contractDraftDemands = demands;
  openModal({
    title: TEXT.DRAFT_MODAL_TITLE,
    closable: false,
    replace: true,
    cls: 'contract-form',
    body: draftBody(demands, preselect, demandsFailed),
    footer: `<button type="button" class="btn btn-outline glass glass--pressable" data-action="contract.closeModal">${TEXT.BTN_CANCEL}</button>
          <button type="button" class="btn glass glass--pressable" data-action="contract.submitDraft" data-id="${convId}">${TEXT.BTN_SEND}</button>`,
  });
  if (demandsFailed) showToast(TEXT.CONTRACT_DEMANDS_LOAD_FAIL, 'error');
  const m = document.getElementById('contract-method');
  if (m && m.closest) initCustomSelects(m.closest('.modal'));
  contractToggleOther('contract-pay-method', 'contract-pay-method-other-wrap');
  contractToggleOther('contract-trial-pay', 'contract-trial-pay-other-wrap');
  prefillContractFromDemand();
}

function draftBody(demands, preselect, demandsFailed) {
  const opts = demands.length
    ? (preselect
      ? demands.map(d => `<option value="${d.id}"${d.id === preselect.id ? ' selected' : ''}>${escHtml(demandOptionText(d))}</option>`).join('')
      : `<option value="" selected disabled>${TEXT.CONTRACT_DEMANDS_SIGNED_HINT}</option>` + demands.map(d => `<option value="${d.id}">${escHtml(demandOptionText(d))}</option>`).join(''))
    : `<option value="" disabled>${TEXT.CONTRACT_DEMANDS_EMPTY}</option>`;
  return `
        <div class="form-group">
          <label class="form-label">${TEXT.LABEL_CONTRACT_DEMAND} <span class="req">*</span></label>
          <select class="form-select" id="contract-demand" data-change="contract.prefillDraft">${opts}</select>
        </div>
        <div class="form-group">
          <label class="form-label">${TEXT.LABEL_CONTRACT_METHOD}</label>
          <select class="form-select" id="contract-method">
            ${TEACHING_METHODS.map(m => `<option value="${m.id}">${m.name}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">${TEXT.LABEL_CONTRACT_SCHEDULE}</label>
          <div id="contract-time-slots" class="time-slots">${renderTimeSlotContainerHtml()}</div>
        </div>
        <div class="form-group">
          <label class="form-label">${TEXT.LABEL_CONTRACT_LOCATION}</label>
          <input type="text" class="form-input" id="contract-location" maxlength="${CONFIG.CONTRACT_LOCATION_MAX}" placeholder="${TEXT.CONTRACT_LOCATION_PLACEHOLDER}">
          <div class="form-note-block">${TEXT.CONTRACT_LOCATION_NOTE}</div>
        </div>
        <div class="form-group">
          <label class="form-label">${TEXT.LABEL_CONTRACT_RATE}</label>
          <input type="number" class="form-input" id="contract-rate" min="0" step="1" placeholder="${TEXT.CONTRACT_PRICE_PLACEHOLDER}">
        </div>
        <div class="form-group">
          <label class="form-label">${TEXT.LABEL_CONTRACT_PAY_METHOD}</label>
          <select class="form-select" id="contract-pay-method" data-change="contract.toggleOther" data-other="contract-pay-method-other-wrap">
            <option value="per_session">${TEXT.PAY_METHOD_PER_SESSION}</option>
            <option value="weekly">${TEXT.PAY_METHOD_WEEKLY}</option>
            <option value="monthly">${TEXT.PAY_METHOD_MONTHLY}</option>
            <option value="other">${TEXT.PAY_METHOD_OTHER}</option>
          </select>
          <div class="form-other-wrap hidden" id="contract-pay-method-other-wrap">
            <input type="text" class="form-input" id="contract-pay-method-other" maxlength="${CONFIG.PAY_OTHER_MAX}" placeholder="${TEXT.CONTRACT_PAY_METHOD_OTHER_PLACEHOLDER}">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">${TEXT.LABEL_CONTRACT_FIRST_LESSON}</label>
          ${dateFieldHtml()}
        </div>
        <div class="form-group">
          <label class="form-label">${TEXT.LABEL_CONTRACT_TRIAL_PAY}</label>
          <select class="form-select" id="contract-trial-pay" data-change="contract.toggleOther" data-other="contract-trial-pay-other-wrap">
            <option value="first_free">${TEXT.TRIAL_PAY_FIRST_FREE}</option>
            <option value="first_hour_free">${TEXT.TRIAL_PAY_FIRST_HOUR_FREE}</option>
            <option value="normal">${TEXT.TRIAL_PAY_NORMAL}</option>
            <option value="other">${TEXT.TRIAL_PAY_OTHER}</option>
          </select>
          <div class="form-other-wrap hidden" id="contract-trial-pay-other-wrap">
            <input type="text" class="form-input" id="contract-trial-pay-other" maxlength="${CONFIG.PAY_OTHER_MAX}" placeholder="${TEXT.CONTRACT_TRIAL_PAY_OTHER_PLACEHOLDER}">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">${TEXT.LABEL_CONTRACT_PLAN}</label>
          <div class="md-toolbar">
            <button type="button" class="md-btn glass" data-action="contract.mdWrap" data-md="h2">H2</button>
            <button type="button" class="md-btn glass" data-action="contract.mdWrap" data-md="h3">H3</button>
            <button type="button" class="md-btn glass" data-action="contract.mdWrap" data-md="bold">${TEXT.POST_MD_BOLD}</button>
            <button type="button" class="md-btn glass" data-action="contract.preview">${TEXT.POST_PREVIEW_BTN}</button>
          </div>
          <textarea id="post-body" class="form-input post-body-input" rows="8" placeholder="${TEXT.CONTRACT_PLAN_PLACEHOLDER}"></textarea>
        </div>
        <p class="funds-note">${TEXT.FUNDS_NOTE}</p>`;
}


export function contractToggleOther(selectId, wrapId) {
  const sel = document.getElementById(selectId);
  const wrap = document.getElementById(wrapId);
  if (sel && wrap) wrap.classList.toggle('hidden', sel.value !== 'other');
}

export function prefillContractFromDemand() {
  const sel = document.getElementById('contract-demand');
  if (!sel) return;
  const d = (window._contractDraftDemands || []).find(x => String(x.id) === sel.value);
  if (!d) return;
  if (d.teaching_method) {
    const mSel = document.getElementById('contract-method');
    if (mSel && [...mSel.options].some(o => o.value === d.teaching_method)) { mSel.value = d.teaching_method; syncCustomSelectText(mSel); }
  }
  const rateEl = document.getElementById('contract-rate');
  if (rateEl && !rateEl.value && (d.budget_min || d.budget_max)) {
    rateEl.value = Math.round(((+d.budget_min || 0) + (+d.budget_max || 0)) / 2) || (+d.budget_max || +d.budget_min);
  }
  const plan = document.getElementById('post-body');
  const subjLine = demandTargetNames(d.target_subjects, d.target_type);
  if (plan && !plan.value.trim() && subjLine) { plan.value = `${TEXT.CONTRACT_SUBJECT_LINE_PREFIX}${subjLine}\n\n`; }
  const ts = document.getElementById('contract-time-slots');
  if (ts && !ts.querySelectorAll('.time-slot').length) prefillTimeSlots(ts, d.expected_time || '');
}

let contractDraftBusy = false;

export async function submitContractDraft(convId) {
  const method = document.getElementById('contract-method').value;
  const rate = document.getElementById('contract-rate').value;
  const plan = (document.getElementById('post-body').value || '').trim();
  const payMethod = document.getElementById('contract-pay-method').value;
  const payMethodOther = payMethod === 'other' ? (document.getElementById('contract-pay-method-other').value || '').trim() : '';
  const firstLessonDateRaw = readDateField(document.getElementById('contract-first-lesson-field'));
  const trialPay = document.getElementById('contract-trial-pay').value;
  const trialPayOther = trialPay === 'other' ? (document.getElementById('contract-trial-pay-other').value || '').trim() : '';
  const demandId = parseInt(document.getElementById('contract-demand').value) || null;
  if (!demandId) { showToast(TEXT.CONTRACT_REQUIRE_SIGNED, 'error'); return; }
  if (!rate || +rate <= 0) { showToast(TEXT.VALIDATE_CONTRACT_RATE, 'error'); return; }
  if (payMethod === 'other' && !payMethodOther) { showToast(TEXT.VALIDATE_CONTRACT_PAY_METHOD_OTHER, 'error'); return; }
  if (trialPay === 'other' && !trialPayOther) { showToast(TEXT.VALIDATE_CONTRACT_TRIAL_PAY_OTHER, 'error'); return; }
  if (!plan) { showToast(TEXT.VALIDATE_CONTRACT_PLAN, 'error'); return; }
  const tsErr = validateTimeSlots(document.getElementById('contract-time-slots'));
  if (tsErr) { showToast(tsErr, 'error'); return; }
  if (firstLessonDateRaw === null) { showToast(TEXT.VALIDATE_CONTRACT_FIRST_LESSON_INCOMPLETE, 'error'); return; }
  const firstLessonDate = firstLessonDateRaw;
  if (contractDraftBusy) return;
  contractDraftBusy = true;
  try {
    const schedule = collectScheduleText('contract-time-slots');
    const location = (document.getElementById('contract-location').value || '').trim();
    const data = await api('/api/contracts', { method: 'POST', body: { conversationId: convId, method, plan, hourlyRate: +rate, schedule, location, demandId, payMethod, payMethodOther, firstLessonDate, trialPay, trialPayOther } });
    invalidate('contracts');
    closeModal();
    showToast(data.message || TEXT.CONTRACT_DRAFT_SENT_TOAST);
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    contractDraftBusy = false;
  }
}
