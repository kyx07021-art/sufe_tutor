/**
 * teacher feature actions: list, filters, profile panel, reviews.
 */
import { TEXT } from '../../constants/text.js';
import { ROLES, TEACHING_METHODS, WEEKDAYS } from '../../../shared/enums.js'; // Z-16-F5: roles via shared enums; Q-4a-M1b: filter options
import { state } from '../../core/state.js';
import { api } from '../../core/api.js';
import { dhGet, dhPeek, dhOnDomainRefresh } from '../../core/datahub.js';
import { openModal, closeModal, showToast, btnLoading, btnDone, confirm } from '../../core/ui.js';
import { escHtml, loaderHtml } from '../../core/dom.js'; // Z-10-F5: loader placeholder via shared helper
import { renderTeacherCard, renderProfilePanel, renderProfileReviewsCard, renderProfileAwardsCard, studentMatchDetailHtml, reviewModalHtml, setStudentOpenDemand } from './render.js';
import { matchDegree, matchDims, matchLevel, matchRowsHtml, matchNoteHtml } from '../../core/match.js';
import { demandIsActive } from '../student/display.js';
import { positionFloatCard } from '../../core/anim.js';

let profilePanelUserId = null;
let _studentOpenDemand = false;
let _matchDetailOpen = false;

// Q-4a-M1b: fill teacher sort/filter controls (shell provides empty container; was dead — toggle showed blank dropdown)
function fillTeacherFilters() {
  const fill = (id, opts) => {
    const el = document.getElementById(id);
    if (!el || el.options.length > 1) return; // idempotent
    el.innerHTML = `<option value="">${escHtml(TEXT.DEMAND_FILTER_ALL)}</option>` + opts.map(o => `<option value="${escHtml(o.value)}">${escHtml(o.label)}</option>`).join('');
  };
  fill('filter-method', TEACHING_METHODS.map(m => ({ value: m.id, label: m.name })));
  fill('filter-day', WEEKDAYS.map(d => ({ value: d.id, label: d.name })));
  fill('filter-verified', [{ value: '1', label: TEXT.VERIFY_DONE }, { value: '0', label: TEXT.FILTER_UNVERIFIED }]);
  fill('teacher-sort', [{ value: 'match', label: TEXT.TEACHER_SORT_MATCH }, { value: 'rating', label: TEXT.TEACHER_SORT_RATING }, { value: 'price', label: TEXT.TEACHER_SORT_PRICE }]);
  const lbl = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  lbl('teacher-sort-label', TEXT.LABEL_SORT);
  lbl('teacher-method-label', TEXT.LABEL_TEACHING_METHOD_PROFILE);
  lbl('teacher-day-label', TEXT.LABEL_DAY);
  lbl('teacher-verified-label', TEXT.LABEL_VERIFIED);
}
export function loadTeachers() {
  const el = document.getElementById('browse-teachers-list') || document.getElementById('teachers-list');
  if (!el) return;
  fillTeacherFilters();
  el.innerHTML = `<div class="empty-state">${loaderHtml()}</div>`;
  return dhGet('/api/teachers', { domain: 'teachers' }).then(async data => {
    state.allTeachers = data.teachers || [];
    await attachStudentMatch(state.allTeachers);
    renderTeachers();
  }).catch(err => {
    el.innerHTML = `<div class="empty-state"><p>${TEXT.ERROR_LOAD_PREFIX}${escHtml(err.message)}</p></div>`;
  });
}

export function renderTeachers() {
  const el = document.getElementById('browse-teachers-list') || document.getElementById('teachers-list');
  if (!el) return;
  if (!state.allTeachers.length) { el.innerHTML = `<div class="empty-state">${TEXT.EMPTY_NO_TEACHERS}</div>`; return; }
  el.innerHTML = state.allTeachers.map(renderTeacherCard).join('');
}

export async function attachStudentMatch(teachers) {
  if (!state.user || state.user.role !== ROLES.STUDENT) { _studentOpenDemand = false; setStudentOpenDemand(false); return; }
  for (const t of teachers) delete t._matchForStudent;
  let demands = [];
  try { demands = (await dhGet('/api/student/demands?scope=mine', { domain: 'demands' })).demands || []; }
  catch { demands = []; }
  const open = demands.filter(d => demandIsActive(d));
  _studentOpenDemand = open.length > 0;
  setStudentOpenDemand(_studentOpenDemand);
  if (!open.length) return;
  for (const t of teachers) {
    const items = open
      .map(d => ({ d, md: matchDegree(t, d) }))
      .filter(x => x.md != null)
      .sort((a, b) => b.md - a.md);
    if (items.length) t._matchForStudent = { md: items[0].md, items };
  }
}

export function studentOpenDemand() { return _studentOpenDemand; }

// v1 parity (app-teachers.js): probe refresh replaces the cached array then re-hangs
// state.allTeachers — cross-feature readers (openProfilePanel/findCachedTeacher) mirror
// it, and an open list re-renders under the user's current filter/sort controls instead
// of keeping deactivated-teacher cards until the next tab switch.
export function registerTeacherDomainRefresh() {
  dhOnDomainRefresh('teachers', () => {
    const c = dhPeek('/api/teachers');
    if (c && c.teachers) state.allTeachers = c.teachers;
    if (state.page === 'browse-teachers') {
      attachStudentMatch(state.allTeachers) // async (non-student exits early with a resolved promise)
        .then(() => { if (state.page === 'browse-teachers') applyFilters(); }) // read current controls, keep user filter
        .catch(() => { /* network blip: keep current render, next probe retries */ });
    }
  });
}
registerTeacherDomainRefresh();

export async function openProfilePanel(userId) {
  let t = state.allTeachers.find(x => x.user_id === userId);
  // Z-10-F1: write-review gate data source — GET /api/teacher/profile carries server-side `signed`
  // (student has contracted this teacher; single source of truth); list data lacks it.
  // Only logged-in students request it: guests would get 401 and be bounced to the login view by
  // api()'s dead-token handling (regression caught in re-review); guests/non-students fall through
  // to list data where signed is absent and the button stays hidden.
  if (state.user && state.user.role === ROLES.STUDENT) {
    try {
      const data = await api(`/api/teacher/profile?userId=${userId}`, { method: 'GET' });
      if (data && data.profile) t = data.profile;
    } catch { /* fallback to list data */ }
  }
  if (!t) {
    try {
      const data = await api(`/api/users/${userId}`, { method: 'GET' });
      t = data.user || null;
    } catch (err) { showToast(err.message); return; }
  }
  if (!t) return;
  profilePanelUserId = userId;
  openModal({
    title: TEXT.PROFILE_PANEL_TITLE,
    cls: 'modal--wide',
    body: renderProfilePanel(t, ''),
  });
  loadReviews(userId);
  loadAwards(userId);
}

async function loadReviews(userId) {
  try {
    const data = await api(`/api/reviews?teacherUserId=${userId}`, { method: 'GET' });
    const box = document.querySelector('#modal-container .profile-reviews');
    if (box) box.innerHTML = (data.reviews || []).map(renderProfileReviewsCard).join('') || `<div class="empty-state">${TEXT.EMPTY_NO_REVIEWS}</div>`;
  } catch { /* silent */ }
}

async function loadAwards(userId) {
  try {
    const data = await api(`/api/teacher/awards?userId=${userId}`, { method: 'GET' });
    const box = document.querySelector('#modal-container .profile-awards');
    if (box) box.innerHTML = (data.awards || []).map(renderProfileAwardsCard).join('');
  } catch { /* silent */ }
}

// Z-10-F1: openReviewModal reads the teacher from the module state set by openProfilePanel;
// a null/undefined arg must NOT clobber it (the button's data-action passes no arg — clobbering
// would make submitReview post teacherUserId=undefined and fail the contracted-gate 403).
export function openReviewModal(teacherId) {
  if (teacherId != null) profilePanelUserId = teacherId;
  openModal({ title: TEXT.REVIEW_MODAL_TITLE_PREFIX, body: reviewModalHtml(), footer: `<button type="button" class="btn btn-outline glass glass--pressable" data-action="teacher.closeReview">${TEXT.BTN_CANCEL}</button><button type="button" class="btn glass glass--pressable" data-action="teacher.submitReview">${TEXT.BTN_SUBMIT_REVIEW}</button>` });
}

export async function submitReview() {
  const teacherId = profilePanelUserId;
  const rating = Number(document.querySelector('#review-stars .selected')?.dataset.rating || 0);
  const comment = (document.getElementById('review-comment')?.value || '').trim();
  if (!rating) { showToast(TEXT.VALIDATE_SELECT_RATING, 'error'); return; }
  if (comment.length < 2) { showToast(TEXT.VALIDATE_COMMENT_TOO_SHORT, 'error'); return; }
  try {
    await api('/api/reviews', { method: 'POST', body: { teacherUserId: teacherId, rating, comment } });
    closeModal();
    showToast(TEXT.SUCCESS_REVIEW_SUBMITTED);
  } catch (err) { showToast(err.message); }
}

export function setReviewStars(el) {
  const container = document.getElementById('review-stars');
  if (!container) return;
  container.querySelectorAll('.star').forEach(s => s.classList.toggle('selected', Number(s.dataset.rating) <= Number(el.dataset.rating)));
}

export function adminReviewAction(id, action) {
  if (action === 'approve') {
    api(`/api/admin/reviews/${id}/approve`, { method: 'POST', body: {} }).then(() => { showToast(TEXT.SUCCESS_APPROVED); loadTeachers(); }).catch(err => showToast(err.message));
  } else {
    api(`/api/admin/reviews/${id}/reject`, { method: 'POST', body: {} }).then(() => { showToast(TEXT.SUCCESS_REJECTED); loadTeachers(); }).catch(err => showToast(err.message));
  }
}

export function confirmDeleteReview(id) {
  confirm({ title: TEXT.BTN_DELETE_REVIEW, message: TEXT.CONFIRM_DELETE_REVIEW, onConfirm: () => api(`/api/admin/reviews/${id}`, { method: 'DELETE', body: {} }).then(() => { showToast(TEXT.REVIEW_DELETED); loadTeachers(); }).catch(err => showToast(err.message)) });
}

export function closeModalAction() { closeModal(); }


export function findCachedTeacher(userId) {
  return state.allTeachers.find(x => x.user_id === userId) || null;
}

export function closeProfilePanel() { closeModal(); }
export function profilePanelShowing() { return profilePanelUserId != null; }

export function viewTeacherCredential(userId) {
  const t = findCachedTeacher(userId);
  if (!t || !t.credential_image) { showToast(TEXT.CREDENTIAL_VIEW, 'error'); return; }
  openModal({ title: TEXT.CREDENTIAL_VIEW, body: `<div class="credential-view"><img src="${escHtml(t.credential_image)}" alt="${TEXT.CREDENTIAL_VIEW}"></div>` });
}

export function teacherSortMode(mode) {
  if (mode == null) {
    const role = state.user && state.user.role;
    return role === ROLES.TEACHER ? 'rating' : 'match';
  }
  state.teacherSort = mode; sortTeachers(); return mode;
}
export function syncMatchSortOpt() { /* handled by sort control */ }
export function teacherSortFromSelect(el) { // Q-4a-M1c: sort control change delegation
  const v = el ? String(el.value || '') : '';
  state.teacherSort = v || 'match';
  sortTeachers();
}
export function sortTeachers(arrOrMode, maybeMode) {
  const arr = Array.isArray(arrOrMode) ? [...arrOrMode] : [...(state.allTeachers || [])];
  const mode = maybeMode || (Array.isArray(arrOrMode) ? 'rating' : state.teacherSort || 'match');
  if (mode === 'price') arr.sort((a,b) => (a.price_min == null ? Infinity : a.price_min) - (b.price_min == null ? Infinity : b.price_min));
  else if (mode === 'rating') arr.sort((a,b) => (b.rating||0)-(a.rating||0));
  else if (mode === 'match') {
    if (!arr.some(t => t._matchForStudent)) return; // no match context: keep server order
    arr.sort((a,b) => {
      const am = a._matchForStudent ? a._matchForStudent.md : -1;
      const bm = b._matchForStudent ? b._matchForStudent.md : -1;
      return bm - am;
    });
  }
  if (Array.isArray(arrOrMode) || arrOrMode == null) { state.allTeachers = arr; } // Q-4a-M1c: write back on no-arg call too (sort control path was sorting a copy and never persisting)
  renderTeachers();
}

export function openTeacherCard(id) { openProfilePanel(id); }
export function toggleFilters() { const el = document.getElementById('teacher-filters'); if (el) el.classList.toggle('hidden'); }
export function applyFilters() {
  const method = document.getElementById('filter-method')?.value || '';
  const day = document.getElementById('filter-day')?.value || '';
  const verified = document.getElementById('filter-verified')?.value || '';
  // Q-4a-M1b audit FAIL fix: filter from the full cached source, NOT the previously-filtered
  // display state — clearing a filter must restore the full list (was sticky until reload).
  // Mirrors demand hall applyDemandControls. Falls back to state.allTeachers (first visit / no cache).
  const full = ((dhPeek('/api/teachers') || {}).teachers) || null;
  let list = [...((full && full.length ? full : state.allTeachers) || [])];
  if (method) list = list.filter(t => (t.teaching_method || '') === method);
  if (day) list = list.filter(t => hasDaySlot(t.time_slots, Number(day)));
  if (verified === '1') list = list.filter(t => t.verified === 1);
  else if (verified === '0') list = list.filter(t => !t.verified);
  state.allTeachers = list;
  if (state.teacherSort) sortTeachers(); // Q-4a 复审发现：筛选后重新应用排序（原回退服务端序）
  renderTeachers();
}
export function hasDaySlot(timeSlots, day) { // Q-4a-M1a: parse time_slots JSON and match dow exactly — old String.includes matched digits inside start/end times (e.g. dow=3, start '18:00' falsely matched day 1)
  if (Array.isArray(timeSlots)) { /* already parsed */ }
  else if (typeof timeSlots === 'string') { try { timeSlots = JSON.parse(timeSlots || '[]'); } catch { return false; } }
  else return false;
  if (!Array.isArray(timeSlots)) return false;
  return timeSlots.some(t => Number(t && (t.dow ?? t.day)) === day);
}
export function showTeacherMatchDetail(id) {
  const t = findCachedTeacher(id);
  if (!t || !t._matchForStudent) return;
  if (_matchDetailOpen) { closeMatchDetail(); return; }
  const btn = document.querySelector(`[data-action="teacher.matchDetail"][data-id="${id}"]`);
  if (!btn) return;
  btn.insertAdjacentHTML('afterend', studentMatchDetailHtml(t));
  const card = btn.nextElementSibling;
  if (!card || !card.classList.contains('match-detail')) return;
  document.body.appendChild(card);
  positionFloatCard(btn, card);
  _matchDetailOpen = true;
}

export function closeMatchDetail() {
  const el = document.querySelector('.match-detail--teacher');
  if (el) el.remove();
  _matchDetailOpen = false;
}
export function renderProfileInfoCard(t) { return renderProfilePanel(t, ''); }
