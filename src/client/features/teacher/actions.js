/**
 * teacher feature actions: list, filters, profile panel, reviews.
 */
import { TEXT } from './text.js';
import { state } from '../../core/state.js';
import { api } from '../../core/api.js';
import { dhGet, dhOnDomainRefresh } from '../../core/datahub.js';
import { openModal, closeModal, showToast, btnLoading, btnDone, confirm } from '../../core/ui.js';
import { escHtml } from '../../core/dom.js';
import { renderTeacherCard, renderProfilePanel, renderProfileReviewsCard, renderProfileAwardsCard, studentMatchDetailHtml, reviewModalHtml } from './render.js';
import { matchDegree } from '../../core/match.js';

let profilePanelUserId = null;

export function loadTeachers() {
  const el = document.getElementById('browse-teachers-list') || document.getElementById('teachers-list');
  if (!el) return;
  el.innerHTML = '<div class="empty-state">loading</div>';
  return dhGet('/api/teachers', { domain: 'teachers' }).then(data => {
    state.allTeachers = data.teachers || [];
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

dhOnDomainRefresh('teachers', () => { renderTeachers(); });

export async function openProfilePanel(userId) {
  let t = state.allTeachers.find(x => x.user_id === userId);
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

export function openReviewModal(teacherId) {
  profilePanelUserId = teacherId;
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

export function attachStudentMatch() {
  const t = state.allTeachers || [];
  state.allTeachers = t.map(teacher => {
    const d = state.myDemands && state.myDemands[0];
    if (!d) return teacher;
    return { ...teacher, _matchDegree: matchDegree(teacher, d) };
  });
}

export function teacherSortMode(mode) {
  if (mode == null) {
    const role = state.user && state.user.role;
    return role === 'teacher' ? 'rating' : 'match';
  }
  state.teacherSort = mode; sortTeachers(); return mode;
}
export function syncMatchSortOpt() { /* handled by sort control */ }
export function sortTeachers(arrOrMode, maybeMode) {
  const arr = Array.isArray(arrOrMode) ? [...arrOrMode] : [...(state.allTeachers || [])];
  const mode = maybeMode || (Array.isArray(arrOrMode) ? 'rating' : state.teacherSort || 'match');
  if (mode === 'price') arr.sort((a,b) => (a.price_min||0)-(b.price_min||0));
  else if (mode === 'rating') arr.sort((a,b) => (b.rating||0)-(a.rating||0));
  else arr.sort((a,b) => (b._matchDegree||0)-(a._matchDegree||0));
  if (Array.isArray(arrOrMode)) { state.allTeachers = arr; }
  renderTeachers();
}

export function openTeacherCard(id) { openProfilePanel(id); }
export function toggleFilters() { const el = document.getElementById('teacher-filters'); if (el) el.classList.toggle('hidden'); }
export function applyFilters() { renderTeachers(); }
export function hasDaySlot(timeSlots, day) { return String(timeSlots||'').includes(day); }
export function showTeacherMatchDetail(id) {
  const t = findCachedTeacher(id);
  const d = state.myDemands && state.myDemands[0];
  if (!t || !d) return;
  openModal({ title: TEXT.MATCH_T_TITLE, body: studentMatchDetailHtml(t, d) });
}
export function renderProfileInfoCard(t) { return renderProfilePanel(t, ''); }
