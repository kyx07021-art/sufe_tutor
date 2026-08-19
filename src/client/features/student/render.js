/**
 * student/demand feature renderers: demand cards, intent rows, demand modal.
 * No inline handlers or inline style attributes (data-action delegation, v2 rule).
 *
 * v1 parity (B4 redo): renderDemandCard full structure -- type/match badge, four-state intent btn,
 * push actions, student/admin ops, big-and-light budget, greet-bubble, intent toggle row;
 * renderIntentTeacherRow with status tag + price + teacher greet; teacher-card push button with
 * global per-minute cooldown (v1 pushCooldownUntil).
 */
import { TEXT } from '../../constants/text.js';
import { escHtml, fmtDate, renderAvatarHtml } from '../../core/dom.js';
import { methodName, provinceName, priceRangeText, usernameHtml, deactivatedTag } from '../../core/display.js';
import { demandIdText, demandTargetNameList, studentGradeName, expectedTimeText } from './display.js';
import { starsHtml } from '../teacher/display.js';
import { matchDegree, matchLevel } from '../../core/match.js';
import { CARET_SVG, segTabsHtml, checkboxItemsHtml } from '../../core/ui.js';
import { renderTimeSlotContainerHtml } from '../../core/ui-form.js';
import { gradeOptionsForProvince } from '../region/render.js';
import { STATUS, DEMAND_TYPES, GENDERS, TEACHING_METHODS, SUBJECTS, NONACADEMIC_PROJECTS, TEACHING_GOALS, PERSONALITY_TAGS } from '../../../shared/enums.js';
import { CONFIG } from '../../../shared/config.js';

// v1 parity: 8 wizard step labels (P4 split teaching-goal into P4 + teacher-pref into P6).
// Single source for the wizard's step count (actions.demandWizardGoTo clamps to this length).
export const DEMAND_WIZARD_STEPS = [
  TEXT.DW_STEP_PROVINCE, TEXT.DW_STEP_METHOD, TEXT.DW_STEP_STUDENT,
  TEXT.DW_STEP_SUBJECTS, TEXT.DW_STEP_SCORES, TEXT.DW_STEP_TEACHER_PREF,
  TEXT.DW_STEP_BUDGET, TEXT.DW_STEP_SUBMIT,
];

export function renderDemandCard(d, opts = {}) {
  const { editable = false, admin = false, teacher = false, myTeacher = null } = opts;
  const push = opts.push; // student-pushed pending demand (teacher pinned card)
  // Demand id tag (#0004, four digits): sits right of the time meta (same row)
  const idTag = d.display_id ? `<span class="demand-id-tag">${escHtml(demandIdText(d.display_id))}</span>` : '';
  // Match badge (teacher view + complete teacher profile): tri-color by matchLevel, click opens detail float
  const matchTag = (teacher && myTeacher)
    ? (() => {
        const md = (d._md !== undefined) ? d._md : matchDegree(myTeacher, d);
        if (md == null) return '';
        return `<button type="button" class="tag-match match-btn match-btn--${matchLevel(md)} glass glass--pressable" data-action="student.matchDetail" data-id="${d.id}" title="${TEXT.TAG_MATCH_TITLE}">${TEXT.TAG_MATCH}${md}%${TEXT.TAG_MATCH_HINT}</button>`;
      })()
    : '';
  // R2-b type badge: academic / non-academic (next to username in title row)
  const typeBadge = `<span class="tag tag-accent glass glass--solid">${d.target_type === DEMAND_TYPES.NONACADEMIC ? TEXT.BADGE_TYPE_NONACADEMIC : TEXT.BADGE_TYPE_ACADEMIC}</span> `;
  // R2-b target name split (demandTargetNameList single source): project name for non-academic, subject names for academic
  const subjNames = demandTargetNameList(d.target_subjects, d.target_type);
  const grade = studentGradeName(d.student_grade);
  const method = methodName(d.teaching_method) || methodName('offline');
  // Teacher view: four-state intent button (unsubmitted / pending / accepted-> / rejected)
  // v1 parity (audit B): CTA carries data-demand-id so doSubmitIntent's optimistic swap selector matches
  const teacherIntentBtn = !teacher ? ''
    : d.my_intent_status === STATUS.ACCEPTED ? `<button type="button" class="btn btn-soft btn-sm btn-intent-ok glass glass--pressable" data-action="student.goChat" data-id="${d.user_id}">${TEXT.INTENT_ACCEPTED_GO}</button>`
    : d.my_intent_status === STATUS.PENDING ? `<button type="button" class="btn btn-soft btn-sm btn-intent-wait glass glass--pressable" disabled data-demand-id="${d.id}">${TEXT.INTENT_PENDING}</button>`
    : d.my_intent_status === STATUS.REJECTED ? `<button type="button" class="btn btn-soft btn-sm btn-intent-wait glass glass--pressable" disabled>${TEXT.INTENT_REJECTED}</button>`
    : `<button type="button" class="btn btn-soft btn-sm glass glass--pressable btn-intent-cta" data-action="student.submitIntent" data-id="${d.id}" data-demand-id="${d.id}">${TEXT.BTN_SUBMIT_INTENT}</button>`;
  // Push action buttons (teacher pinned card: reject/accept the student's push)
  const pushActions = !teacher || !push ? '' : `
      <button type="button" class="btn btn-soft btn-sm glass glass--pressable" data-action="student.resolvePush" data-id="${push.push_id}" data-result="reject">${TEXT.BTN_PUSH_REJECT}</button>
      <button type="button" class="btn btn-soft btn-sm glass glass--pressable" data-action="student.resolvePush" data-id="${push.push_id}" data-result="accept">${TEXT.BTN_PUSH_ACCEPT}</button>`;
  // Student/admin card ops (reopen/edit/remove) bottom-right
  const ownerActions = (editable && d.status === STATUS.REVOKED ? `<button type="button" class="btn btn-soft btn-sm glass glass--pressable" data-action="student.reopenDemand" data-id="${d.id}">${TEXT.BTN_REOPEN_DEMAND}</button>`
    : editable && d.status !== STATUS.CONTRACTED ? `<button type="button" class="btn btn-soft btn-sm glass glass--pressable" data-action="student.editDemand" data-id="${d.id}">${TEXT.BTN_EDIT}</button>` : '')
    + (admin ? `<button type="button" class="btn btn-soft btn-sm glass glass--pressable" data-action="student.deleteDemand" data-id="${d.id}">${TEXT.BTN_REMOVE}</button>` : '');
  // Budget "big-and-light": large thin number + small grey unit; negotiable without unit
  const budgetNum = (d.budget_min || d.budget_max)
    ? `${d.budget_min || TEXT.BUDGET_NO_LIMIT}~${d.budget_max || TEXT.BUDGET_NO_LIMIT}`
    : '';
  const budget = budgetNum
    ? `<span class="demand-budget"><span class="demand-budget-num">${escHtml(budgetNum)}</span><span class="demand-budget-unit">${escHtml(TEXT.BUDGET_UNIT_SUFFIX)}</span></span>`
    : `<span class="demand-budget demand-budget--nego">${escHtml(TEXT.BUDGET_NEGOTIABLE)}</span>`;
  const timeLine = expectedTimeText(d.expected_time);
  const metaParts = [grade, method, timeLine ? `${TEXT.LABEL_EXPECTED_TIME}${timeLine}` : ''].filter(Boolean);
  const statusTag = d.status === STATUS.CONTRACTED
    ? ` <span class="tag tag-ok glass glass--solid">${TEXT.DEMAND_TAG_CONTRACTED}</span>`
    : d.status === STATUS.REVOKED ? ` <span class="tag tag-warn glass glass--solid">${TEXT.DEMAND_TAG_REVOKED}</span>` : '';
  // Student push greeting rendered as full quote block (no ellipsis)
  const greet = push && push.push_message ? `<div class="greet-bubble glass">
      <div class="greet-bubble-head">${TEXT.GREET_HEAD_STUDENT}</div>
      <div class="greet-bubble-body">${escHtml(push.push_message)}</div>
    </div>` : '';
  // Card "intents (N)" toggle: .btn-soft btn-sm; id anchors for toggleDemandIntents (expand/lazy-load/red-dot)
  const intentsToggle = editable && d.status !== STATUS.REVOKED
    ? `<button type="button" class="btn btn-soft btn-sm glass glass--pressable btn-intent-toggle" id="intent-toggle-${d.id}" data-action="student.toggleIntents" data-id="${d.id}">${TEXT.INTENTS_TITLE} (${d.intent_count || 0}) <span class="drop-caret">${CARET_SVG}</span><span class="corner-dot${d.pending_intents ? '' : ' hidden'}" id="intent-dot-${d.id}"></span></button>`
    : '';
  const intentsBox = editable && d.status !== STATUS.REVOKED ? `<div class="intents-box" id="intents-box-${d.id}"><div class="intents-box-inner"></div></div>` : '';
  const contactNote = push ? `<span class="push-note-text">${TEXT.PUSH_NOTE_TEXT}</span>` : `<span class="contact-sign-note">${TEXT.CONTACT_AFTER_SIGN_NOTE}</span>`;
  return `<div class="list-card list-card--demand glass" data-demand-id="${d.id}"${push ? ` data-push-id="${push.push_id}"` : ''} data-action="student.openDemand" data-id="${d.id}">
    ${renderAvatarHtml(d.avatar, d.username || '?', 'demand-avatar', d.user_id)}
    <div class="demand-card-main">
    <div class="list-card-header">
      <span class="list-card-title">${usernameHtml(d.username || '')}${deactivatedTag(d.username)}${typeBadge}${matchTag}${statusTag}</span>
      <span class="demand-card-tools">
        <span class="list-card-meta">${push ? fmtDate(push.push_created_at) : fmtDate(d.created_at)}</span>${idTag}
      </span>
    </div>
    ${(subjNames || []).length ? `<div class="demand-title">${escHtml((subjNames || []).join('、'))}</div>` : ''}
    ${metaParts.length ? `<div class="demand-sub">${metaParts.map(escHtml).join(' · ')}</div>` : ''}
    <div class="demand-price">${budget}</div>
    ${greet}
    <div class="demand-card-foot">
      <div class="list-card-contact">${contactNote}</div>
      <div class="demand-card-actions">
        ${teacher ? (push ? pushActions : teacherIntentBtn) : ''}${ownerActions}${intentsToggle}
      </div>
    </div>
    ${intentsBox}
    </div>
  </div>`;
}

// v1 parity (C batch): 8-step demand wizard form. DOM stays mounted across pages (display toggling
// never unloads state); form novalidate -- per-page validation lives in actions.demandWizardValidateStep.
// No inline handlers: nav/delete/cancel via data-action delegation, submit via form submit listener,
// type tabs via seg-tab-change, tag-picks via student.toggleTagPick (actions/index wiring).
export function renderDemandModalHtml(demand) {
  // R2-b student gender: '' = not-say (default) + GENDERS male/female; teacher-side undeclared/nonbinary excluded
  const studentGenders = [{ id: '', name: TEXT.OPTION_GENDER_NOT_SAY }, ...GENDERS.filter(g => g.id !== 'undeclared' && g.id !== 'nonbinary')];
  const prefGenders = GENDERS.filter(g => g.id !== 'undeclared' && g.id !== 'nonbinary');
  const selProv = demand && demand.province ? demand.province : '';
  const tagPickBtn = (id, name, containerId, max) =>
    `<button type="button" class="tag-pick glass glass--solid" data-action="student.toggleTagPick" data-container="${containerId}" data-max="${max}" data-id="${escHtml(id)}">${escHtml(name)}</button>`;
  return `<form id="demand-form" novalidate>
    <div class="dw-stepper" id="dw-stepper">
      ${DEMAND_WIZARD_STEPS.map((s, i) => `<div class="dw-step-chip" data-step="${i + 1}" title="${s}"><span class="dw-step-chip-dot"></span><span class="dw-step-chip-label">${s}</span></div>`).join('')}
    </div>
    <div class="dw-steps-viewport">
    <div class="dw-steps-track">
    <div class="dw-step" data-step="1">
      <div class="form-group">
        <label class="form-label">${TEXT.LABEL_PROVINCE} <span class="req">*</span></label>
        <span id="d-province-wrap"></span>
        <div id="d-region-note"></div>
      </div>
    </div>
    <div class="dw-step" data-step="2">
      <div class="form-group">
        <label class="form-label">${TEXT.LABEL_TEACHING_METHOD} <span class="req">*</span></label>
        <select class="form-select" id="d-method">
          ${TEACHING_METHODS.map(m => `<option value="${m.id}">${m.name}</option>`).join('')}
        </select>
      </div>
      <p class="text-sm text-muted spacer-sm" id="d-method-note"></p>
      <div id="d-address-section">
        <div class="form-group">
          <label class="form-label">${TEXT.LABEL_ADDRESS} <span class="req">*</span></label>
          <div id="d-addr-picker" class="sh-addr-picker"></div>
          <input type="hidden" id="d-address" placeholder="${TEXT.ADDRESS_PLACEHOLDER}">
        </div>
      </div>
    </div>
    <div class="dw-step" data-step="3">
      <div class="form-group">
        <label class="form-label">${TEXT.LABEL_STUDENT_GENDER}</label>
        <select class="form-select" id="d-gender">
          ${studentGenders.map(g => `<option value="${g.id}">${g.name}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">${TEXT.LABEL_STUDENT_GRADE} <span class="req">*</span></label>
        <select class="form-select" id="d-grade"${selProv ? '' : ' disabled'}>
          <option value="">${selProv ? TEXT.OPTION_PLACEHOLDER : TEXT.SELECT_PROVINCE_FIRST}</option>${selProv ? gradeOptionsForProvince(selProv).map(g => `<option value="${g.id}">${g.name}</option>`).join('') : ''}
        </select>
      </div>
    </div>
    <div class="dw-step" data-step="4">
      <div class="form-group">
        ${segTabsHtml([
          { key: DEMAND_TYPES.ACADEMIC, label: TEXT.LABEL_TYPE_ACADEMIC },
          { key: DEMAND_TYPES.NONACADEMIC, label: TEXT.LABEL_TYPE_NONACADEMIC },
        ], DEMAND_TYPES.ACADEMIC, { containerClass: 'demand-type-tabs', containerId: 'd-type-tabs', attr: 'type' })}
      </div>
      <div class="demand-section" id="d-section-academic">
        <div class="form-group">
          <label class="form-label">${TEXT.LABEL_TARGET_SUBJECTS} <span class="req">*</span>${TEXT.LABEL_MULTI_SUFFIX}</label>
          <div class="checkbox-grid" id="d-subjects">${checkboxItemsHtml(SUBJECTS)}</div>
        </div>
      </div>
      <div class="demand-section hidden" id="d-section-nonacademic">
        <div class="form-group">
          <label class="form-label">${TEXT.LABEL_TARGET_PROJECTS} <span class="req">*</span>${TEXT.LABEL_MULTI_SUFFIX}</label>
          <div class="checkbox-grid" id="d-nonacademic">${checkboxItemsHtml(NONACADEMIC_PROJECTS)}</div>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">${TEXT.LABEL_TEACHING_GOAL}${TEXT.TEACHING_GOALS_HINT.replace('{max}', CONFIG.TEACHING_GOALS_MAX)}</label>
        <div id="d-teaching-goals">${TEACHING_GOALS.map(tag => tagPickBtn(tag.id, tag.name, 'd-teaching-goals', CONFIG.TEACHING_GOALS_MAX)).join('')}</div>
      </div>
    </div>
    <div class="dw-step" data-step="5">
      <div class="form-group">
        <label class="form-label" id="d-scores-title">${TEXT.LABEL_CURRENT_SCORES}</label>
        <div id="d-scores"><p class="text-sm text-muted">${TEXT.HINT_SELECT_TARGET_SUBJECTS}</p></div>
        <div id="d-skill-notes" class="hidden"></div>
      </div>
    </div>
    <div class="dw-step" data-step="6">
      <div class="form-group">
        <label class="form-label">${TEXT.LABEL_PREFERRED_PERSONALITY}${TEXT.PERSONALITY_TAGS_HINT.replace('{max}', CONFIG.PERSONALITY_TAGS_MAX)}</label>
        <div id="d-personality-tags">${PERSONALITY_TAGS.map(tag => tagPickBtn(tag.id, tag.name, 'd-personality-tags', CONFIG.PERSONALITY_TAGS_MAX)).join('')}</div>
      </div>
      <div class="form-group">
        <label class="form-label">${TEXT.LABEL_PREFERRED_GENDER}</label>
        <select class="form-select" id="d-pref-gender">
          <option value="">${TEXT.OPTION_PREF_GENDER_ANY}</option>${prefGenders.map(g => `<option value="${g.id}">${g.name}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="dw-step" data-step="7">
      <div class="form-group">
        <label class="form-label">${TEXT.LABEL_BUDGET}</label>
        <div class="range-row">
          <input type="number" class="form-input" id="d-budget-min" placeholder="${TEXT.PLACEHOLDER_MIN}" min="0" step="1">
          <span class="text-muted">~</span>
          <input type="number" class="form-input" id="d-budget-max" placeholder="${TEXT.PLACEHOLDER_MAX}" min="0" step="1">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">${TEXT.LABEL_EXPECTED_TIME}</label>
        <div id="d-time-slots" class="time-slots">${renderTimeSlotContainerHtml()}</div>
      </div>
    </div>
    <div class="dw-step" data-step="8">
      <div class="form-group">
        <label class="form-label">${TEXT.LABEL_SUBMITTER} <span class="req">*</span></label>
        <select class="form-select" id="d-submitter">
          <option value="parent">${TEXT.SUBMITTER_PARENT}</option><option value="student">${TEXT.SUBMITTER_STUDENT}</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">${TEXT.LABEL_PARENT_CONTACT} <span class="req">*</span><span class="form-label-note">${TEXT.CONTACT_AFTER_SIGN_NOTE}</span></label>
        <input type="text" class="form-input" id="d-parent-contact" placeholder="${TEXT.CONTACT_PLACEHOLDER}">
      </div>
      <div class="form-group">
        <label class="form-label">${TEXT.LABEL_STUDENT_CONTACT} <span class="req">*</span><span class="form-label-note">${TEXT.CONTACT_AFTER_SIGN_NOTE}</span></label>
        <input type="text" class="form-input" id="d-student-contact" placeholder="${TEXT.CONTACT_PLACEHOLDER}">
      </div>
      <div class="form-group">
        <label class="form-label">${TEXT.LABEL_ADDITIONAL_INFO}</label>
        <textarea class="form-input" id="d-info" rows="3" placeholder="${TEXT.DEMAND_INFO_PLACEHOLDER}"></textarea>
      </div>
    </div>
    </div><!-- /dw-steps-track -->
    </div><!-- /dw-steps-viewport -->
    <div class="dw-footer">
      ${demand ? `<button type="button" class="btn btn-sm btn-text-danger glass glass--pressable" data-action="student.deleteDemand" data-id="${demand.id}">${TEXT.BTN_DELETE_DEMAND}</button>` : ''}
      <button type="button" class="btn btn-outline glass glass--pressable" data-action="student.closeModal">${TEXT.BTN_CANCEL}</button>
      <button type="button" class="btn btn-outline glass glass--pressable hidden" id="dw-back" data-action="student.wizardBack">${TEXT.BTN_PREV_STEP}</button>
      <button type="button" class="btn glass glass--pressable" id="dw-next" data-action="student.wizardNext">${TEXT.BTN_NEXT_STEP}</button>
      <button type="submit" class="btn glass glass--pressable hidden" id="d-submit">${demand ? TEXT.BTN_SAVE_DEMAND : TEXT.BTN_SUBMIT_DEMAND}</button>
    </div>
  </form>`;
}

// v1 parity: teacher-card push button -- cooldown is a global per-minute limit shared by all push
// buttons; opens the demand-pick modal for a given teacher (data-action delegation).
export function renderPushBtn(t) {
  const left = pushCooldownLeft();
  return left > 0
    ? `<button type="button" class="tc-push-btn glass glass--pressable" disabled>${TEXT.PUSH_BTN_COOLDOWN} ${left}s</button>`
    : `<button type="button" class="tc-push-btn glass glass--pressable" data-action="student.openSendModal" data-id="${t.user_id}">${TEXT.BTN_PUSH_DEMAND} <span class="arrow">→</span></button>`;
}

// v1 parity: teacher intent row in the student's demand card -- username+stars, status tag,
// province+price meta, optional teacher greet quote, VIEW/AGREE/REJECT actions (data-action).
export function renderIntentTeacherRow(t, demandId) {
  const st = t.intent_status;
  const tag = st === STATUS.ACCEPTED ? `<span class="tag tag-ok glass glass--solid">${TEXT.INTENT_STATUS_ACCEPTED}</span>`
    : st === STATUS.REJECTED ? `<span class="tag tag-danger glass glass--solid">${TEXT.INTENT_STATUS_REJECTED}</span>` : `<span class="tag tag-warn glass glass--solid">${TEXT.INTENT_STATUS_PENDING}</span>`;
  const provName = escHtml(provinceName(t.province)); // N-15: unknown province echoes raw id, XSS-safe
  const viewBtn = `<button type="button" class="btn btn-soft btn-xs glass glass--pressable" data-action="student.viewProfile" data-id="${t.user_id}">${TEXT.BTN_VIEW}</button>`;
  const actions = st === STATUS.PENDING
    ? `<button type="button" class="btn btn-soft btn-xs glass glass--pressable" data-action="student.acceptIntent" data-demand="${demandId}" data-teacher="${t.user_id}">${TEXT.BTN_AGREE}</button>
       <button type="button" class="btn btn-soft btn-xs glass glass--pressable" data-action="student.rejectIntent" data-demand="${demandId}" data-teacher="${t.user_id}">${TEXT.BTN_REJECT}</button>` : '';
  const priceLine = priceRangeText(t.price_min, t.price_max, TEXT.PRICE_UNIT) || '?';
  const greetHtml = t.intent_message ? `<div class="greet-bubble glass greet-bubble--row">
      <div class="greet-bubble-head">${TEXT.GREET_HEAD_TEACHER}</div>
      <div class="greet-bubble-body">${escHtml(t.intent_message)}</div>
    </div>` : '';
  return `<div class="admin-row glass" data-intent-row data-teacher="${t.user_id}" data-intent-id="${t.intent_id}">
    <div class="admin-row-main">
      <div class="admin-row-line intent-row-line">
        <span class="intent-row-user"><strong>${usernameHtml(t.username)}</strong> ${starsHtml(t.rating)}</span>${tag}
      </div>
      <div class="admin-row-meta">${[provName, priceLine].filter(Boolean).join(' · ')}</div>
      ${greetHtml}
    </div>
    <div class="admin-row-actions">${viewBtn}${actions}</div>
  </div>`;
}

// Push cooldown: global per-minute limit (v1 pushCooldownUntil) -- all teacher-card push buttons share it
let _pushCooldownUntil = 0;
export function pushCooldownLeft() { return Math.max(0, Math.ceil((_pushCooldownUntil - Date.now()) / 1000)); }
export function setPushCooldown(secs) { _pushCooldownUntil = Date.now() + secs * 1000; }
export function startPushCooldown(seconds) { setPushCooldown(seconds); }
export function _pushCooldownResetForTests() { _pushCooldownUntil = 0; }
