/**
 * student/demand feature actions: list, create, intents, pushes.
 */
import { TEXT } from './text.js';
import { state } from '../../core/state.js';
import { api } from '../../core/api.js';
import { dhGet, dhOnDomainRefresh, invalidate } from '../../core/datahub.js';
import { openModal, closeModal, showToast, btnLoading, btnDone, confirm } from '../../core/ui.js';
import { escHtml } from '../../core/dom.js';
import { renderDemandCard, renderDemandModalHtml, renderPushBtn, renderIntentTeacherRow, setPushCooldown, pushCooldownLeft } from './render.js';
import { buildStudentSubjectsHtml, buildStudentScoreRows } from '../region/render.js';
import { SUFE_REGIONS } from '../../constants/region-data.js';
import { STUDENT_GRADES } from '../../../shared/enums.js';

export function loadMyDemands() {
  const el = document.getElementById('my-demands-list');
  if (!el) return;
  el.innerHTML = '<div class="empty-state">loading</div>';
  return dhGet('/api/student/demands?scope=mine', { domain: 'demands' }).then(data => {
    state.myDemands = data.demands || [];
    el.innerHTML = state.myDemands.map(renderDemandCard).join('') || `<div class="empty-state">${TEXT.EMPTY_NO_MY_DEMANDS}</div>`;
  }).catch(err => { el.innerHTML = `<div class="empty-state"><p>${escHtml(err.message)}</p></div>`; });
}

export function loadBrowseDemands() {
  const el = document.getElementById('browse-demands-list') || document.getElementById('demands-list');
  if (!el) return;
  el.innerHTML = '<div class="empty-state">loading</div>';
  return dhGet('/api/student/demands', { domain: 'demands' }).then(data => {
    state.browseDemands = data.demands || [];
    el.innerHTML = state.browseDemands.map(renderDemandCard).join('') || `<div class="empty-state">${TEXT.DEMAND_EMPTY}</div>`;
  }).catch(err => { el.innerHTML = `<div class="empty-state"><p>${escHtml(err.message)}</p></div>`; });
}

dhOnDomainRefresh('demands', () => { loadMyDemands(); loadBrowseDemands(); });

export function openDemandModal() {
  openModal({ title: TEXT.DEMAND_MODAL_TITLE, closable: false, body: renderDemandModalHtml(), footer: `<button type="button" class="btn btn-outline glass glass--pressable" data-action="student.closeModal">${TEXT.BTN_CANCEL}</button><button type="button" class="btn glass glass--pressable" data-action="student.submitDemand">${TEXT.BTN_SAVE_DEMAND}</button>` });
}

export async function handleSubmitDemand() {
  const grade = document.getElementById('d-grade')?.value || '';
  const subjects = [...document.querySelectorAll('#d-subjects input:checked')].map(x => x.value);
  const scores = collectStudentScores();
  if (!grade || !subjects.length) { showToast(TEXT.VALIDATE_DEMAND_INCOMPLETE, 'error'); return; }
  try {
    const payload = { demand: {
      province: document.getElementById('d-province')?.value || '',
      target_type: 'academic',
      student_grade: grade,
      student_gender: '',
      target_subjects: subjects,
      current_scores: scores,
      preferred_personality_tags: [],
      preferred_teacher_gender: '',
      teaching_goal: [],
      skill_notes: [],
      teaching_method: document.getElementById('d-method')?.value || 'offline',
      address: document.getElementById('d-address')?.value || '',
      expected_time: '',
      budget_min: +document.getElementById('d-budget-min')?.value || 0,
      budget_max: +document.getElementById('d-budget-max')?.value || 0,
      submitter_type: 'student',
      parent_contact: document.getElementById('d-parent-contact')?.value || '',
      student_contact: document.getElementById('d-student-contact')?.value || '',
      additional_info: document.getElementById('d-info')?.value || '',
    }};
    await api('/api/student/demands', { method: 'POST', body: payload });
    closeModal();
    showToast(TEXT.DEMAND_SUBMITTED_TOAST);
    invalidate('demands');
    loadMyDemands();
  } catch (err) { showToast(err.message, 'error'); }
}

export function confirmDeleteDemand(id) {
  confirm({ title: TEXT.BTN_DELETE_DEMAND, message: TEXT.CONFIRM_DELETE_DEMAND, onConfirm: () => handleDeleteDemand(id) });
}

export async function handleDeleteDemand(id) {
  try {
    await api(`/api/student/demands/${id}`, { method: 'DELETE', body: {} });
    showToast(TEXT.DEMAND_DELETED_TOAST);
    invalidate('demands');
    loadMyDemands();
  } catch (err) { showToast(err.message); }
}

export function reopenDemand(id) {
  api(`/api/student/demands/${id}/reopen`, { method: 'POST', body: {} }).then(() => { showToast(TEXT.DEMAND_REOPENED_TOAST); invalidate('demands'); loadMyDemands(); }).catch(err => showToast(err.message));
}

export async function submitDemandPush(demandId) {
  try {
    const teacherId = Number(document.querySelector('[data-push-teacher]')?.dataset.pushTeacher || 0);
    const message = document.getElementById('push-message')?.value || '';
    await api('/api/demand-pushes', { method: 'POST', body: { demandId, teacherUserId: teacherId, message } });
    setPushCooldown(demandId, 60);
    showToast(TEXT.PUSH_SUBMITTED_TOAST);
    closeModal();
  } catch (err) { showToast(err.message); }
}

export async function submitIntent(demandId) {
  try {
    const message = document.getElementById('intent-message')?.value || '';
    await api(`/api/demands/${demandId}/intents`, { method: 'POST', body: { message } });
    showToast(TEXT.INTENT_SUBMITTED_TOAST);
    closeModal();
  } catch (err) { showToast(err.message); }
}

export async function resolveIntent(demandId, teacherId) {
  try {
    const intentId = Number(document.querySelector(`[data-intent-row][data-teacher="${teacherId}"]`)?.dataset.intentId || 0);
    await api(`/api/intents/${intentId}/resolve`, { method: 'POST', body: { action: 'accept' } });
    showToast(TEXT.INTENT_RESOLVED_TOAST);
    invalidate('demands');
    loadMyDemands();
  } catch (err) { showToast(err.message); }
}

export function openDemandCard(id) {
  const d = [...(state.myDemands || []), ...(state.browseDemands || [])].find(x => x.id === id);
  if (!d) return;
  openModal({ title: demandIdText(d.display_id), body: `<div class="demand-detail">${escHtml(d.additional_info || '')}</div>` });
}

export function openDemandDetail(id) { openDemandCard(id); }

export function collectStudentScores() {
  const root = document.getElementById('d-scores');
  const out = [];
  if (!root) return out;
  root.querySelectorAll('.region-score-row').forEach(row => {
    const sid = row.dataset.scoreSubject;
    const inp = row.querySelector('input[data-sg-subject]');
    out.push({ subject: sid, mode: 'score', scale: inp ? +inp.dataset.scoreMax : 100, score: inp ? inp.value : '' });
  });
  return out;
}

export function closeModalAction() { closeModal(); }
export { renderPushBtn, pushCooldownLeft };


export function switchDemandType(type) { setDemandType(type); }
export function setDemandType(type) { state.demandType = type; }
export function renderDemandModal(d) { openDemandModal(); if (d) prefillDemandForm(d); }
export function demandWizardGoTo(step) { state.demandStep = step; }
export function demandWizardNext() { if (state.demandStep == null) state.demandStep = 1; else state.demandStep++; }
export function demandWizardBack() { if (state.demandStep) state.demandStep--; }
export function demandWizardValidateStep() { return true; }
export function initDemandForm() { /* populated by render modal */ }
export function prefillDemandForm(d) { state.editingDemandId = d && d.id; }
export function prefillStudentScores() {}
export function toggleAddressField() { const el = document.getElementById('d-address-wrap'); if (el) el.classList.toggle('hidden'); }
export function onDemandProvinceChange() { updateDemandSubjects(); }
export function updateDemandSubjects() { const sel = document.getElementById('d-grade'); if (sel) { const html = buildStudentSubjectsHtml(document.getElementById('d-province')?.value || '', sel.value); const box = document.getElementById('d-subjects'); if (box) box.innerHTML = html; } }
export function updateDemandScores() { const sel = document.getElementById('d-grade'); const subjects = [...document.querySelectorAll('#d-subjects input:checked')].map(x => x.value); const box = document.getElementById('d-scores'); if (box) box.innerHTML = buildStudentScoreRows(document.getElementById('d-province')?.value || '', sel?.value || '', subjects); }
export function showMatchDetail() {}
export function closeMatchDetail() {}
export function loadDemandList() { return loadMyDemands(); }
export function initDemandControls() {}
export function toggleDemandFilters() { const el = document.getElementById('demand-filters'); if (el) el.classList.toggle('hidden'); }
export function demandSortMode() {}
export function applyDemandControls() { loadBrowseDemands(); }
export function renderBrowseDemands() { loadBrowseDemands(); }
export async function openSendDemandModal(demandId) { openModal({ title: TEXT.PUSH_MODAL_TITLE, body: `<div class="form-group"><label class="form-label">${TEXT.LABEL_MESSAGE}</label><textarea id="push-message" class="form-input" rows="3"></textarea></div><input type="hidden" data-push-teacher="0">`, footer: `<button type="button" class="btn btn-outline glass glass--pressable" data-action="student.closeModal">${TEXT.BTN_CANCEL}</button><button type="button" class="btn glass glass--pressable" data-action="student.push">${TEXT.BTN_PUSH_DEMAND}</button>` }); }
export function startPushCooldown(id) { setPushCooldown(id, 60); }
export async function resolvePush(pushId, accept) { try { await api(`/api/demand-pushes/${pushId}/resolve`, { method: 'POST', body: { action: accept ? 'accept' : 'reject' } }); loadBrowseDemands(); } catch (err) { showToast(err.message); } }
export async function doSubmitIntent(demandId) { return submitIntent(demandId); }
export function showProfileIncompleteModal() { showToast(TEXT.PROFILE_INCOMPLETE_HINT, 'error'); }
export function toggleDemandIntents() {}
export function refreshIntentsBox() {}


export function gradeOptionsForProvince(provinceId) {
  if (SUFE_REGIONS.isFiveFour(provinceId)) return STUDENT_GRADES.filter(g => g.id !== 'p6');
  return STUDENT_GRADES.filter(g => g.id !== 'prep');
}
