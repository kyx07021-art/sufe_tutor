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

export function openProfilePanel(userId) {
  const t = state.allTeachers.find(x => x.user_id === userId);
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
