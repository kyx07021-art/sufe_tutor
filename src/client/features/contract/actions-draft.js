/**
 * contract feature actions: contract draft modal.
 */
import { CONFIG } from '../../../shared/config.js';
import { TEACHING_METHODS } from '../../../shared/enums.js';
import { TEXT } from '../../constants/text.js';
import { api, ensureAuth } from '../../core/api.js';
import { openModal, closeModal, showToast, initCustomSelects } from '../../core/ui.js';
import { renderTimeSlotContainerHtml, validateTimeSlots, collectTimeSlots, dateFieldHtml, readDateField } from '../../core/ui-form.js';
import { expectedTimeText } from '../student/display.js';
import { invalidate } from '../../core/datahub.js';

function collectScheduleText(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return '';
  const slots = collectTimeSlots(container);
  return slots.length ? expectedTimeText(JSON.stringify(slots)) : '';
}

export async function openContractDraftModal(convId) {
  if (!ensureAuth()) return;
  openModal({
    title: TEXT.DRAFT_MODAL_TITLE,
    closable: false,
    cls: 'contract-form',
    body: draftBody(),
    footer: `<button type="button" class="btn btn-outline glass glass--pressable" data-action="contract.closeModal">${TEXT.BTN_CANCEL}</button>
          <button type="button" class="btn glass glass--pressable" data-action="contract.submitDraft" data-id="${convId}">${TEXT.BTN_SEND}</button>`,
  });
  const m = document.getElementById('contract-method');
  if (m && m.closest) initCustomSelects(m.closest('.modal'));
  contractToggleOther('contract-pay-method', 'contract-pay-method-other-wrap');
  contractToggleOther('contract-trial-pay', 'contract-trial-pay-other-wrap');
}

function draftBody() {
  return `
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
    const data = await api('/api/contracts', { method: 'POST', body: { conversationId: convId, method, plan, rate: +rate, schedule, location, payMethod, payMethodOther, firstLessonDate, trialPay, trialPayOther } });
    invalidate('contracts');
    closeModal();
    showToast(data.message || TEXT.CONTRACT_DRAFT_SENT_TOAST);
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    contractDraftBusy = false;
  }
}
