/**
 * admin feature actions: stats, dashboard, users, demands, reviews, content, awards, verifications.
 */
import { TEXT } from '../../constants/text.js';
import { ROLES } from '../../../shared/enums.js'; // Z-16-F5: roles via shared enums
import { api } from '../../core/api.js';
import { dhGet, invalidate } from '../../core/datahub.js';
import { openModal, closeModal, showToast, confirm, withCaptcha } from '../../core/ui.js';
import { escHtml } from '../../core/dom.js';

export async function loadAdminStats() {
  try {
    const [stats, dash] = await Promise.all([
      api('/api/admin/stats', { method: 'GET' }),
      api('/api/admin/dashboard', { method: 'GET' }),
    ]);
    const el = document.getElementById('admin-stats-box') || document.getElementById('admin-stats-content');
    if (el) el.textContent = JSON.stringify({ stats: stats.stats || stats, dashboard: dash.dashboard || dash });
  } catch (err) { showToast(err.message); }
}

export async function loadAdminDashboard() {
  try {
    const data = await api('/api/admin/dashboard', { method: 'GET' });
    const el = document.getElementById('admin-dashboard-box');
    if (el) el.textContent = JSON.stringify(data.dashboard || data);
  } catch (err) { showToast(err.message); }
}

export async function loadAdminTraffic() {
  try {
    const data = await api('/api/admin/traffic', { method: 'GET' });
    const el = document.getElementById('admin-traffic-box');
    if (el) el.textContent = JSON.stringify(data.traffic || data);
  } catch (err) { showToast(err.message); }
}

// Z-11-F5: dormant stub — traffic range selector for the admin traffic box (pending B5);
// zero call sites, kept as a marker where the range UI hooks in. Delete with B5 migration.
export function setTrafficRange() {}

export async function loadAdminUsers(role = ROLES.STUDENT) {
  try {
    const data = await dhGet(`/api/admin/users?role=${role}`, { domain: 'admin' });
    const el = document.getElementById('admin-users-list') || (role === ROLES.TEACHER ? document.getElementById('admin-teachers-list') : document.getElementById('admin-students-list'));
    if (el) el.innerHTML = (data.users || []).map(renderAdminUserRow).join('');
  } catch (err) { showToast(err.message); }
}

export function loadAdminStudents() { return loadAdminUsers(ROLES.STUDENT); }
export function loadAdminTeachers() { return loadAdminUsers(ROLES.TEACHER); }
// Z-11-F5: dormant stub — debounced username search for the admin users list (pending B5);
// zero call sites, kept as a marker where the search UI hooks in. Delete with B5 migration.
export function adminUsersSearchDebounced() {}

export function renderAdminUserRow(u) {
  return `<div class="list-card glass admin-user-row"><span>${escHtml(u.username)}</span><span class="tag glass glass--solid">${escHtml(u.role || '')}</span></div>`;
}

export async function loadAdminDemands() {
  try {
    const data = await dhGet('/api/admin/demands', { domain: 'admin' });
    const el = document.getElementById('admin-demands-list');
    if (el) el.innerHTML = (data.demands || []).map(d => `<div class="list-card glass">${escHtml(d.display_id || d.id)}</div>`).join('');
  } catch (err) { showToast(err.message); }
}

export async function loadAdminReviews() {
  try {
    const data = await dhGet('/api/admin/reviews', { domain: 'admin' });
    const el = document.getElementById('admin-reviews-list');
    if (el) el.innerHTML = (data.reviews || []).map(renderAdminReviewRow).join('');
  } catch (err) { showToast(err.message); }
}

export function renderAdminReviewRow(r) {
  return `<div class="list-card glass admin-review-row"><span>${escHtml(r.comment || '')}</span>
    <button type="button" class="btn btn-sm glass glass--pressable" data-action="admin.approveReview" data-id="${r.id}">${TEXT.BTN_APPROVE}</button>
    <button type="button" class="btn btn-sm btn-outline glass glass--pressable" data-action="admin.rejectReview" data-id="${r.id}">${TEXT.BTN_REJECT}</button></div>`;
}

export async function loadAdminContent(type = 'post') {
  try {
    const data = await api(`/api/admin/content?type=${type}`, { method: 'GET' });
    const el = document.getElementById('admin-content-list');
    if (el) el.innerHTML = (data.items || []).map(renderAdminContentRow).join('');
  } catch (err) { showToast(err.message); }
}

export function renderAdminContentRow(it) {
  return `<div class="list-card glass admin-content-row"><span>${escHtml(it.title || it.id)}</span>
    <button type="button" class="btn btn-sm btn-outline glass glass--pressable" data-action="admin.penalty" data-id="${it.id}" data-type="${escHtml(it.type || 'post')}">${TEXT.ADMIN_PENALTY}</button></div>`;
}

export function openContentPenaltyModal(id, type) {
  openModal({ title: TEXT.ADMIN_PENALTY, body: `<div class="form-group"><label>${TEXT.ADMIN_REASON}</label><textarea id="penalty-reason" class="form-input"></textarea></div>`, footer: `<button type="button" class="btn btn-outline glass glass--pressable" data-action="admin.closeModal">${TEXT.BTN_CANCEL}</button><button type="button" class="btn glass glass--pressable" data-action="admin.submitPenalty" data-id="${id}" data-type="${type}">${TEXT.BTN_CONFIRM}</button>` });
}

export async function submitContentPenalty(id, type) { return doSubmitContentPenalty(id, type); }

export async function doSubmitContentPenalty(id, type) {
  const reason = document.getElementById('penalty-reason')?.value.trim();
  if (!reason) { showToast(TEXT.ADMIN_REASON_REQUIRED, 'error'); return; }
  try {
    confirm({ title: TEXT.ADMIN_PENALTY, message: TEXT.ADMIN_PENALTY_CONFIRM, needReAuth: true, onConfirm: async capToken => {
      withCaptcha(async () => {
        await api(`/api/admin/content/${type}/${id}/action`, { method: 'POST', body: { action: 'delete', reason, capToken } });
        closeModal(); showToast(TEXT.ADMIN_DONE); loadAdminContent(type);
      });
    }});
  } catch (err) { showToast(err.message); }
}


export async function loadAdminPosts() {
  try {
    const data = await dhGet('/api/posts?sort=new', { domain: 'admin' });
    const el = document.getElementById('admin-posts-list');
    if (el) el.innerHTML = (data.posts || []).map(renderAdminPostRow).join('');
  } catch (err) { showToast(err.message); }
}

export function renderAdminPostRow(p) {
  return `<div class="list-card glass admin-post-row"><span>${escHtml(p.title || '')}</span>
    <button type="button" class="btn btn-sm btn-outline glass glass--pressable" data-action="admin.deletePost" data-id="${p.id}">${TEXT.BTN_DELETE}</button></div>`;
}

export function openPostViewModal(id) {
  openModal({ title: TEXT.ADMIN_POST_VIEW, body: `<p>${String(id)}</p>`, footer: `<button type="button" class="btn glass glass--pressable" data-action="admin.closeModal">${TEXT.BTN_CLOSE}</button>` });
}

export function adminDeletePost(id) {
  confirm({ title: TEXT.BTN_DELETE, message: TEXT.ADMIN_DELETE_CONFIRM, needReAuth: true, onConfirm: async capToken => {
    withCaptcha(async () => {
      try { await api(`/api/posts/${id}`, { method: 'DELETE', body: { capToken } }); showToast(TEXT.ADMIN_DONE); loadAdminPosts(); } catch (err) { showToast(err.message); }
    });
  }});
}

export async function loadAdminContracts() {
  try {
    const data = await dhGet('/api/admin/contracts', { domain: 'admin' });
    const el = document.getElementById('admin-contracts-list');
    if (el) el.innerHTML = (data.contracts || []).map(c => `<div class="list-card glass">${escHtml(c.id || '')}</div>`).join('');
  } catch (err) { showToast(err.message); }
}

export function adminViewContract(id) { openModal({ title: TEXT.BTN_VIEW_CONTRACT, body: `<p>${String(id)}</p>` }); }
export async function adminRemoveContract(id) {
  confirm({ title: TEXT.BTN_DELETE, message: TEXT.ADMIN_DELETE_CONFIRM, needReAuth: true, onConfirm: async capToken => {
    try { await api(`/api/admin/contracts/${id}`, { method: 'DELETE', body: { capToken } }); showToast(TEXT.ADMIN_DONE); loadAdminContracts(); } catch (err) { showToast(err.message); }
  }});
}

export async function loadAdminFeedback() {
  try {
    const data = await dhGet('/api/feedbacks', { domain: 'admin' });
    const el = document.getElementById('admin-feedback-list');
    if (el) el.innerHTML = (data.feedbacks || []).map(f => `<div class="list-card glass">${escHtml(f.title || '')}</div>`).join('');
  } catch (err) { showToast(err.message); }
}

export async function resolveAdminFeedback(id) {
  try { await api(`/api/feedbacks/${id}/resolve`, { method: 'POST', body: {} }); showToast(TEXT.ADMIN_DONE); loadAdminFeedback(); } catch (err) { showToast(err.message); }
}

export function confirmBanUser(id, banned = true) {
  confirm({ title: TEXT.ADMIN_BAN, message: banned ? TEXT.ADMIN_BAN_CONFIRM : TEXT.ADMIN_UNBAN_CONFIRM, needReAuth: true, onConfirm: async capToken => {
    try { await api(`/api/admin/users/${id}/ban`, { method: 'POST', body: { banned, capToken } }); showToast(TEXT.ADMIN_DONE); loadAdminUsers(); } catch (err) { showToast(err.message); }
  }});
}
export function doBanUser(id) { return confirmBanUser(id, true); }

export async function generateInviteCode() {
  try {
    const data = await api('/api/admin/invite', { method: 'POST', body: {} });
    openModal({ title: TEXT.ADMIN_INVITE, body: `<code>${escHtml(data.code || '')}</code>` });
  } catch (err) { showToast(err.message); }
}

export function openInviteManager() {
  api('/api/admin/invites', { method: 'GET' }).then(data => {
    openModal({ title: TEXT.ADMIN_INVITE, body: (data.invites || []).map(i => `<div class="list-card glass">${escHtml(i.code)}</div>`).join('') });
  }).catch(err => showToast(err.message));
}

export function revokeInvite(code) {
  api(`/api/admin/invites/${encodeURIComponent(code)}`, { method: 'DELETE' }).then(() => { showToast(TEXT.ADMIN_DONE); openInviteManager(); }).catch(err => showToast(err.message));
}


export async function loadAdminAwards() {
  try {
    const data = await dhGet('/api/admin/awards', { domain: 'admin' });
    const el = document.getElementById('admin-awards-list');
    if (el) el.innerHTML = (data.awards || []).map(a => `<div class="list-card glass">${escHtml(a.title || '')}</div>`).join('');
  } catch (err) { showToast(err.message); }
}

export function viewAwardProof(id) { openModal({ title: TEXT.ADMIN_AWARD_PROOF, body: `<p>${String(id)}</p>` }); }
export function approveAward(id) { api(`/api/admin/awards/${id}/action`, { method: 'POST', body: { action: 'approve' } }).then(() => { showToast(TEXT.ADMIN_DONE); loadAdminAwards(); }).catch(err => showToast(err.message)); }
export function rejectAwardModal(id) { openModal({ title: TEXT.ADMIN_AWARD_REJECT, body: `<div class="form-group"><label>${TEXT.ADMIN_REASON}</label><textarea id="award-reject-note" class="form-input"></textarea></div>`, footer: `<button type="button" class="btn glass glass--pressable" data-action="admin.submitAwardReject" data-id="${id}">${TEXT.BTN_CONFIRM}</button>` }); }
export async function submitAwardReject(id) { return doAwardAction(id, 'reject'); }
export async function doAwardAction(id, action) {
  const note = document.getElementById('award-reject-note')?.value || '';
  try { await api(`/api/admin/awards/${id}/action`, { method: 'POST', body: { action, note } }); closeModal(); showToast(TEXT.ADMIN_DONE); loadAdminAwards(); } catch (err) { showToast(err.message); }
}

export async function loadAdminVerifications() {
  try {
    const data = await dhGet('/api/admin/verifications', { domain: 'admin' });
    const el = document.getElementById('admin-verifications-list');
    if (el) el.innerHTML = (data.verifications || []).map(v => `<div class="list-card glass">${escHtml(v.username || '')}</div>`).join('');
  } catch (err) { showToast(err.message); }
}

export function viewAdmissionImage(id) { openModal({ title: TEXT.ADMIN_ADMISSION_IMAGE, body: `<p>${String(id)}</p>` }); }
export function renderVerifForm(v) { return `<div class="list-card glass">${escHtml(v.username || '')}</div>`; }
export function verifApprove(id) { api(`/api/admin/verifications/${id}/action`, { method: 'POST', body: { action: 'approve', school: document.getElementById('verif-school')?.value || '', level: document.getElementById('verif-level')?.value || '' } }).then(() => { showToast(TEXT.ADMIN_DONE); loadAdminVerifications(); }).catch(err => showToast(err.message)); }
export function verifRevoke(id) { api(`/api/admin/verifications/${id}/action`, { method: 'POST', body: { action: 'revoke' } }).then(() => { showToast(TEXT.ADMIN_DONE); loadAdminVerifications(); }).catch(err => showToast(err.message)); }
export function verifReject(id) { return verifRevoke(id); }

export function toggleTeacherVerify(userId) { api(`/api/admin/teachers/${userId}/verify`, { method: 'POST', body: { verified: true } }).then(() => showToast(TEXT.ADMIN_DONE)).catch(err => showToast(err.message)); }
export function doTeacherVerify(userId) { return toggleTeacherVerify(userId); }

export function closeModalAction() { closeModal(); }
