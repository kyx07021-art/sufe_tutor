/**
 * student/demand feature renderers: cards, wizard modal, match detail.
 * No inline handlers or inline style attributes.
 */
import { CONFIG } from '../../../shared/config.js';
import { TEXT } from './text.js';
import { state } from '../../core/state.js';
import { escHtml, fmtDateTime } from '../../core/dom.js';
import { demandOptionText, demandIdText, demandBudgetText, studentGradeName, expectedTimeText, subjectNames } from '../../core/display.js';
import { buildStudentSubjectsHtml, buildStudentScoreRows } from '../region/render.js';

export function renderDemandCard(d) {
  return `<div class="list-card glass demand-card" data-action="student.openDemand" data-id="${d.id}" data-reveal-index="0">
    <div class="list-card-header">
      <span class="list-card-title">${escHtml(demandIdText(d.display_id))} ${escHtml(demandOptionText(d))}</span>
      <span class="tag glass glass--solid">${escHtml(studentGradeName(d.student_grade) || '')}</span>
    </div>
    <div class="list-card-body">
      <span class="tag glass glass--solid">${escHtml(subjectNames(d.target_subjects))}</span>
      <span class="tag tag-warn glass glass--solid">${escHtml(demandBudgetText(d))}</span>
      <span class="list-card-meta">${fmtDateTime(d.created_at)}</span>
    </div>
  </div>`;
}

export function renderDemandModalHtml(d) {
  return `<div class="form-group">
    <label class="form-label">${TEXT.LABEL_STUDENT_GRADE}</label>
    <select class="form-select" id="d-grade"></select>
  </div>
  <div class="form-group">
    <label class="form-label">${TEXT.LABEL_SUBJECTS}</label>
    <div id="d-subjects" class="checkbox-grid"></div>
  </div>
  <div class="form-group">
    <label class="form-label">${TEXT.LABEL_SCORES}</label>
    <div id="d-scores"></div>
  </div>`;
}

export function renderPushBtn(d) {
  const cooldown = pushCooldownLeft(d);
  return cooldown > 0
    ? `<button type="button" class="btn btn-sm glass glass--pressable" disabled>${cooldown}${TEXT.PUSH_COOLDOWN_UNIT}</button>`
    : `<button type="button" class="btn btn-sm glass glass--pressable" data-action="student.push" data-id="${d.id}">${TEXT.BTN_PUSH_DEMAND}</button>`;
}

export function renderIntentTeacherRow(t, demandId) {
  return `<div class="list-card glass intent-row">
    <span class="list-card-title">${escHtml(t.username)}</span>
    <button type="button" class="btn btn-sm glass glass--pressable" data-action="student.acceptIntent" data-demand="${demandId}" data-teacher="${t.user_id}">${TEXT.BTN_ACCEPT_INTENT}</button>
  </div>`;
}

export { buildStudentSubjectsHtml, buildStudentScoreRows };

let _pushCooldowns = {};
export function pushCooldownLeft(d) {
  const until = _pushCooldowns[d.id] || 0;
  return Math.max(0, Math.ceil((until - Date.now()) / 1000));
}
export function setPushCooldown(id, secs) { _pushCooldowns[id] = Date.now() + secs * 1000; }
