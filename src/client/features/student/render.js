/**
 * student/demand feature renderers: demand cards, intent rows, demand modal.
 * No inline handlers or inline style attributes (data-action delegation, v2 rule).
 *
 * v1 parity (B4 redo): renderDemandCard full structure -- type/match badge, four-state intent btn,
 * push actions, student/admin ops, big-and-light budget, greet-bubble, intent toggle row;
 * renderIntentTeacherRow with status tag + price + teacher greet; teacher-card push button with
 * global per-minute cooldown (v1 pushCooldownUntil).
 */
import { TEXT } from './text.js';
import { escHtml, fmtDate, renderAvatarHtml } from '../../core/dom.js';
import {
  demandIdText, demandTargetNameList, studentGradeName, methodName, expectedTimeText,
  provinceName, priceRangeText, usernameHtml, deactivatedTag, starsHtml,
} from '../../core/display.js';
import { matchDegree, matchLevel } from '../../core/match.js';
import { CARET_SVG } from '../../core/ui.js';
import { SUFE_REGIONS } from '../../constants/region-data.js';
import { STUDENT_GRADES, STATUS, DEMAND_TYPES } from '../../../shared/enums.js';

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

// v1 parity: demand form modal html. Edit branch preselects the province; remaining fields are
// filled by actions.prefillDemandForm after the modal opens (race-guarded fetch).
export function renderDemandModalHtml(d) {
  const selProv = d ? d.province : '';
  const provinceOptions = SUFE_REGIONS.provinces.map(p => `<option value="${escHtml(p.id)}"${p.id === selProv ? ' selected' : ''}>${escHtml(p.name)}</option>`).join('');
  return `<div class="form-group">
    <label class="form-label">${TEXT.LABEL_PROVINCE}</label>
    <select class="form-select" id="d-province" data-change="student.provinceChange"><option value="">${TEXT.OPTION_PLACEHOLDER}</option>${provinceOptions}</select>
  </div>
  <div class="form-group">
    <label class="form-label">${TEXT.LABEL_STUDENT_GRADE}</label>
    <select class="form-select" id="d-grade" data-change="student.updateDemand">${STUDENT_GRADES.map(g => `<option value="${escHtml(g.id)}">${escHtml(g.name)}</option>`).join('')}</select>
  </div>
  <div class="form-group">
    <label class="form-label">${TEXT.LABEL_SUBJECTS}</label>
    <div id="d-subjects" class="checkbox-grid"></div>
  </div>
  <div class="form-group">
    <label class="form-label">${TEXT.LABEL_SCORES}</label>
    <div id="d-scores"></div>
  </div>
  <div class="form-group">
    <label class="form-label">${TEXT.LABEL_METHOD}</label>
    <select class="form-select" id="d-method"><option value="offline">${TEXT.METHOD_OFFLINE}</option><option value="online">${TEXT.METHOD_ONLINE}</option></select>
  </div>
  <div class="form-group">
    <label class="form-label">${TEXT.LABEL_BUDGET}</label>
    <input type="number" id="d-budget-min" class="form-input" placeholder="${TEXT.BUDGET_MIN_PLACEHOLDER}"><input type="number" id="d-budget-max" class="form-input" placeholder="${TEXT.BUDGET_MAX_PLACEHOLDER}">
  </div>
  <div class="form-group"><label class="form-label">${TEXT.LABEL_PARENT_CONTACT}</label><input id="d-parent-contact" class="form-input"></div>
  <div class="form-group"><label class="form-label">${TEXT.LABEL_STUDENT_CONTACT}</label><input id="d-student-contact" class="form-input"></div>
  <div class="form-group"><label class="form-label">${TEXT.LABEL_ADDITIONAL_INFO}</label><textarea id="d-info" class="form-input" rows="3"></textarea></div>`;
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
