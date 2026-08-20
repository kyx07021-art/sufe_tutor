/**
 * admin feature actions: stats, dashboard, users, demands, reviews, content, awards, verifications.
 *
 * Q-4b-M4 dormancy note: the admin management actions below loadAdminStats (loadAdminTraffic,
 * loadAdminUsers/Students/Teachers, loadAdminDemands/Reviews/Content/Posts/Contracts/Feedback/
 * Awards/Verifications, renderAdmin*Row, openContentPenaltyModal, submitContentPenalty,
 * openPostViewModal, adminDeletePost, adminViewContract, adminRemoveContract, resolveAdminFeedback,
 * confirmBanUser, generateInviteCode, openInviteManager, revokeInvite, viewAwardProof,
 * approveAward, rejectAwardModal, submitAwardReject, doAwardAction, viewAdmissionImage,
 * renderVerifForm, verifApprove/Revoke/Reject, toggleTeacherVerify, doTeacherVerify) have NO live
 * UI trigger — the admin-stats page renders loadAdminStats() only. They await the pending B5
 * admin-panel parity work and are consumed by tests (admin-client-actions, cache-invalidate-guard).
 * Dormant per rule 35: zero live production reference, explicitly noted here (do not remove — B5
 * depends on them; do not wire into ACTION_MAP before the admin panel exists).
 */
import { TEXT } from '../../constants/text.js';
import { ROLES } from '../../../shared/enums.js'; // Z-16-F5: roles via shared enums
import { api } from '../../core/api.js';
import { dhGet, invalidate } from '../../core/datahub.js';
import { openModal, closeModal, closeAllModals, showToast, confirm, withCaptcha } from '../../core/ui.js';
import { escHtml, fmtDateTime, loaderHtml } from '../../core/dom.js';
import { priceRangeText } from '../../core/display.js';
import { teacherGradeName, ratingText } from '../teacher/display.js'; // U-3a: teacher row meta (grade/rating) display mappings

function adminStatCards(pairs) {
  return pairs.map(([k, v]) => `<div class="stat-card"><div class="stat-value">${escHtml(String(v ?? 0))}</div><div class="stat-label">${escHtml(k)}</div></div>`).join('');
}

function adminOpsRows(items) {
  return items.map(([k, v]) => `<div class="ops-row"><span>${escHtml(k)}</span><code>${escHtml(String(v ?? 0))}</code></div>`).join('');
}

// R-5b: structured stats panel replacing raw JSON dump (labels via TEXT single source).
export async function loadAdminStats() {
  try {
    const [statsRes, dashRes] = await Promise.all([
      api('/api/admin/stats', { method: 'GET' }),
      api('/api/admin/dashboard', { method: 'GET' }),
    ]);
    const s = statsRes.stats || statsRes;
    const d = dashRes.dashboard || dashRes;
    const u = s.users || {}, r = s.reviews || {}, inv = s.invites || {}, t = s.todo || {};
    const dt = d.todo || {}, mt = (d.metrics || {}).total || {};
    const topPaths = (d.metrics || {}).topPaths || [];
    const status = (d.metrics || {}).status || [];
    const el = document.getElementById('admin-stats-box') || document.getElementById('admin-stats-content');
    if (!el) return;
    el.innerHTML =
      `<div class="stats-grid">${adminStatCards([
        [TEXT.ADMIN_STAT_TOTAL_USERS, u.total], [TEXT.ADMIN_STAT_STUDENTS, u.students],
        [TEXT.ADMIN_STAT_TEACHERS, u.teachers], [TEXT.ADMIN_STAT_PROFILES, s.profiles],
        [TEXT.ADMIN_STAT_DEMANDS, s.demands],
      ])}</div>` +
      `<div class="ops-detail">` +
        `<div class="ops-block"><h4>${escHtml(TEXT.ADMIN_SECTION_REVIEWS)}</h4>${adminOpsRows([
          [TEXT.ADMIN_STAT_REVIEWS_TOTAL, r.total], [TEXT.ADMIN_STAT_REVIEWS_APPROVED, r.approved],
          [TEXT.ADMIN_STAT_REVIEWS_PENDING, r.pending], [TEXT.ADMIN_STAT_REVIEWS_REJECTED, r.rejected],
        ])}</div>` +
        `<div class="ops-block"><h4>${escHtml(TEXT.ADMIN_SECTION_INVITES)}</h4>${adminOpsRows([
          [TEXT.ADMIN_STAT_INVITES_USED, inv.used], [TEXT.ADMIN_STAT_INVITES_ACTIVE, inv.active],
        ])}<div class="ops-row ops-row--actions">
          <button type="button" class="btn btn-soft btn-xs glass glass--pressable" data-action="admin.genInvite">${escHtml(TEXT.BTN_GENERATE_INVITE)}</button>
          <button type="button" class="btn btn-soft btn-xs glass glass--pressable" data-action="admin.openInviteManager">${escHtml(TEXT.ADMIN_INVITE)}</button>
        </div></div>` +
        `<div class="ops-block"><h4>${escHtml(TEXT.ADMIN_SECTION_TODO)}</h4>${adminOpsRows([
          [TEXT.ADMIN_STAT_VERIFY_PENDING, dt.verificationsPending],
          [TEXT.ADMIN_STAT_REVIEWS_PENDING, dt.reviewsPending],
          [TEXT.ADMIN_STAT_AWARDS_PENDING, t.awardsPending],
          [TEXT.ADMIN_STAT_FEEDBACKS_OPEN, t.feedbacksOpen],
          [TEXT.ADMIN_STAT_COMPLAINTS_OPEN, t.complaintsOpen],
        ])}</div>` +
        `<div class="ops-block"><h4>${escHtml(TEXT.ADMIN_SECTION_TRAFFIC)}</h4>${adminOpsRows([
          [TEXT.ADMIN_STAT_REQUESTS, mt.requests], [TEXT.ADMIN_STAT_ERRORS, mt.errors],
          [TEXT.ADMIN_STAT_SLOW, mt.slow], [TEXT.ADMIN_STAT_LIMITED, mt.limited],
          [TEXT.ADMIN_STAT_AVG_MS, mt.avgMs],
        ])}</div>` +
      `</div>` +
      (topPaths.length ? `<div class="ops-block"><h4>${escHtml(TEXT.ADMIN_SECTION_TOP_PATHS)}</h4>${adminOpsRows(topPaths.map(p => [p.path_group, p.count]))}</div>` : '') +
      (status.length ? `<div class="ops-block"><h4>${escHtml(TEXT.ADMIN_SECTION_STATUS)}</h4>${adminOpsRows(status.map(x => [x.status_group, x.count]))}</div>` : '');
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

export async function loadAdminUsers(role = ROLES.STUDENT, q = '') {
  try {
    const suffix = q ? `&q=${encodeURIComponent(q)}` : '';
    const data = await dhGet(`/api/admin/users?role=${role}${suffix}`, { domain: 'admin' });
    const el = document.getElementById(role === ROLES.TEACHER ? 'admin-teachers-list' : 'admin-students-list');
    if (el) el.innerHTML = (data.users || []).map(u => renderAdminUserRow(u, role)).join('');
  } catch (err) { showToast(err.message); }
}

export function loadAdminStudents() { return loadAdminUsers(ROLES.STUDENT); }
export function loadAdminTeachers() { return loadAdminUsers(ROLES.TEACHER); }

// U-3a: debounced username search (300ms). Empty query falls back to the full list via the
// server-side q branch (dbSearchUsersByRole single source). Timers cleared on re-entry.
let _adminUsersSearchTimer = 0;
export function adminUsersSearchDebounced(role, q) {
  clearTimeout(_adminUsersSearchTimer);
  _adminUsersSearchTimer = setTimeout(() => loadAdminUsers(role, String(q || '').trim()), 300);
}

// U-3a: v1-parity admin user row (data-action delegation, no inline handlers). Student rows
// show demand count; teacher rows show grade/rating/price + verify badge. Actions are wired
// via ACTION_MAP (banUser/viewProfile/verifyTeacher/unverify).
export function renderAdminUserRow(u, role) {
  const uid = role === ROLES.TEACHER ? (u.user_id || u.id) : u.id;
  const meta = role === ROLES.TEACHER
    ? `${teacherGradeName(u.grade) || '—'} · ${ratingText(u.rating)}${TEXT.RATING_SCORE_SUFFIX} · ${priceRangeText(u.price_min, u.price_max, TEXT.PRICE_UNIT) || '?'}`
    : `${u.demand_count || 0}${TEXT.DEMAND_COUNT_SUFFIX}`;
  return `<div class="admin-row glass admin-user-row">
    <div class="admin-row-main">
      <div class="admin-row-line">
        <strong>${escHtml(u.username)}</strong>
        ${u.verified ? `<span class="tag tag-ok glass glass--solid">${TEXT.VERIFIED_BADGE}</span>` : ''}
        ${u.banned ? `<span class="tag tag-danger glass glass--solid">${TEXT.TAG_BANNED}</span>` : ''}
      </div>
      <div class="admin-row-meta">${escHtml(meta)} · ${escHtml(TEXT.REGISTERED_AT_PREFIX)}${escHtml(fmtDateTime(u.created_at))}</div>
    </div>
    <div class="admin-row-actions">
      ${role === ROLES.TEACHER ? `<button type="button" class="btn btn-soft btn-xs glass glass--pressable" data-action="admin.viewProfile" data-id="${uid}">${TEXT.BTN_VIEW_DETAIL}</button>` : ''}
      ${role === ROLES.TEACHER && u.credential_image
        ? (u.verified
          ? `<button type="button" class="btn btn-soft btn-xs glass glass--pressable" data-action="admin.unverify" data-id="${uid}">${TEXT.UNVERIFY}</button>`
          : `<button type="button" class="btn btn-soft btn-xs glass glass--pressable" data-action="admin.verifyTeacher" data-id="${uid}">${TEXT.VERIFY_TEACHER}</button>`)
        : ''}
      ${u.banned
        ? `<button type="button" class="btn btn-soft btn-xs glass glass--pressable" data-action="admin.banUser" data-id="${uid}" data-banned="0" data-role="${role}">${TEXT.BTN_UNBAN}</button>`
        : `<button type="button" class="btn btn-soft btn-xs glass glass--pressable" data-action="admin.banUser" data-id="${uid}" data-banned="1" data-role="${role}">${TEXT.BTN_BAN}</button>`}
    </div>
  </div>`;
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
    // Q-2f-M2: teacher profile has no hard-delete branch — server handleContentAction
    // requires action='ban' for type='teacher' (else 400). UI/API shape mismatch fix.
    const action = type === 'teacher' ? 'ban' : 'delete';
    confirm({ title: TEXT.ADMIN_PENALTY, message: TEXT.ADMIN_PENALTY_CONFIRM, needReAuth: true, onConfirm: async capToken => {
      withCaptcha(async () => {
        await api(`/api/admin/content/${type}/${id}/action`, { method: 'POST', body: { action, reason, capToken } });
        closeModal(); showToast(TEXT.ADMIN_DONE); loadAdminContent(type);
      });
    }});
  } catch (err) { showToast(err.message); }
}


export async function loadAdminPosts() {
  try {
    // Q-3b-F1: `/api/posts?sort=new` is shared with the posts domain; the cache key must carry
    // domain 'posts' (datahub caches per-endpoint with a single domain slot). If an admin session
    // writes domain='admin' first, invalidate('posts')/dhRefreshDomain('posts') miss and the list
    // stays stale forever (server delete bumps only [POSTS]).
    const data = await dhGet('/api/posts?sort=new', { domain: 'posts' });
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
      try { await api(`/api/posts/${id}`, { method: 'DELETE', body: { capToken } }); invalidate('posts'); showToast(TEXT.ADMIN_DONE); loadAdminPosts(); } catch (err) { showToast(err.message); } // Q-3b-F3: invalidate after write (loadAdminPosts reads dhGet cache)
    });
  }});
}

export async function loadAdminContracts() {
  try {
    const data = await dhGet('/api/admin/contracts', { domain: 'contracts' }); // Q-3b-M1: single slot for /api/admin/contracts (aligns DH_PREFETCH 'contracts' + invalidate('contracts'))
    const el = document.getElementById('admin-contracts-list');
    if (el) el.innerHTML = (data.contracts || []).map(c => `<div class="list-card glass">${escHtml(c.id || '')}</div>`).join('');
  } catch (err) { showToast(err.message); }
}

export function adminViewContract(id) { openModal({ title: TEXT.BTN_VIEW_CONTRACT, body: `<p>${String(id)}</p>` }); }
export async function adminRemoveContract(id) {
  confirm({ title: TEXT.BTN_DELETE, message: TEXT.ADMIN_DELETE_CONFIRM, needReAuth: true, onConfirm: async capToken => {
    try { await api(`/api/admin/contracts/${id}`, { method: 'DELETE', body: { capToken } }); invalidate('contracts'); showToast(TEXT.ADMIN_DONE); loadAdminContracts(); } catch (err) { showToast(err.message); } // Q-3b-F3: invalidate after write
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
  try { await api(`/api/feedbacks/${id}/resolve`, { method: 'POST', body: {} }); invalidate('admin'); showToast(TEXT.ADMIN_DONE); loadAdminFeedback(); } catch (err) { showToast(err.message); } // Q-3b-F3: invalidate after write
}

export function confirmBanUser(id, banned = true, role = ROLES.STUDENT) {
  confirm({ title: TEXT.ADMIN_BAN, message: banned ? TEXT.ADMIN_BAN_CONFIRM : TEXT.ADMIN_UNBAN_CONFIRM, needReAuth: true, onConfirm: async capToken => {
    try { await api(`/api/admin/users/${id}/ban`, { method: 'POST', body: { banned, capToken } }); invalidate('admin'); showToast(TEXT.ADMIN_DONE); loadAdminUsers(role); } catch (err) { showToast(err.message); } // Q-3b-F3: invalidate after write + refresh the list the ban came from (U-3a)
  }});
}
export function doBanUser(id) { return confirmBanUser(id, true); }

// U-3k: invite-code issuance/management — v1-parity but data-action delegated (zero inline
// handlers, contract 6). Pure API consumers: POST /api/admin/invite, GET /api/admin/invites,
// DELETE /api/admin/invites/:code (backend business capability, no frontend coupling).
export async function generateInviteCode() {
  try {
    const data = await api('/api/admin/invite', { method: 'POST', body: {} });
    const code = data.code || '';
    const body = `<div class="invite-new">
      <p class="invite-code-text" id="invite-code-text">${escHtml(code)}</p>
      <p class="text-sm text-muted">${escHtml(TEXT.INVITE_NO_EXPIRY)}</p>
      <div class="form-actions">
        <button type="button" class="btn btn-soft glass glass--pressable" data-action="admin.copyInvite" data-code="${escHtml(code)}">${escHtml(TEXT.BTN_COPY_CODE)}</button>
      </div>
    </div>`;
    openModal({ title: TEXT.ADMIN_INVITE, body, footer: `<button type="button" class="btn glass glass--pressable" data-action="admin.closeModal">${escHtml(TEXT.BTN_CLOSE)}</button>` });
  } catch (err) { showToast(err.message); }
}

export function openInviteManager() {
  openModal({ title: TEXT.ADMIN_INVITE, cls: 'modal--wide', body: `<div class="invite-manager" id="invite-manager-body"><div class="empty-state empty-state--small"><p>${loaderHtml('sm')}</p></div></div>`, footer: `<button type="button" class="btn glass glass--pressable" data-action="admin.closeModal">${escHtml(TEXT.BTN_CLOSE)}</button>` });
  api('/api/admin/invites', { method: 'GET' }).then(data => {
    const list = data.invites || [];
    const el = document.getElementById('invite-manager-body');
    if (!el) return;
    if (!list.length) { el.innerHTML = `<p class="profile-empty">${escHtml(TEXT.INVITE_MANAGER_EMPTY)}</p>`; return; }
    el.innerHTML = `<table class="invite-manager-table">
      <thead><tr><th>${escHtml(TEXT.INVITE_MANAGER_CODE)}</th><th>${escHtml(TEXT.INVITE_MANAGER_STATUS)}</th><th>${escHtml(TEXT.INVITE_MANAGER_USED_BY)}</th><th>${escHtml(TEXT.INVITE_MANAGER_CREATED)}</th><th></th></tr></thead>
      <tbody>${list.map(inv => `<tr>
        <td class="invite-m-code">${escHtml(inv.code)}</td>
        <td>${inv.used_by ? `<span class="tag tag-ok glass glass--solid">${escHtml(TEXT.INVITE_MANAGER_USED)}</span>` : `<span class="tag tag-accent glass glass--solid">${escHtml(TEXT.INVITE_MANAGER_ACTIVE)}</span>`}</td>
        <td>${inv.used_by ? escHtml(inv.used_by_username || ('#' + inv.used_by)) : '—'}</td>
        <td class="invite-m-meta">${fmtDateTime(inv.created_at)}</td>
        <td>${inv.used_by ? '' : `<button type="button" class="btn btn-soft btn-xs glass glass--pressable" data-action="admin.revokeInvite" data-code="${escHtml(inv.code)}">${escHtml(TEXT.INVITE_MANAGER_REVOKE)}</button>`}</td>
      </tr>`).join('')}</tbody>
    </table>`;
  }).catch(err => { const el = document.getElementById('invite-manager-body'); if (el) el.innerHTML = `<p class="profile-empty">${escHtml(err.message)}</p>`; });
}

export function revokeInvite(code) {
  confirm({ title: TEXT.INVITE_MANAGER_TITLE, message: TEXT.INVITE_REVOKE_CONFIRM, onConfirm: () => {
    api(`/api/admin/invites/${encodeURIComponent(code)}`, { method: 'DELETE' }).then(() => { showToast(TEXT.INVITE_MANAGER_REVOKED); closeAllModals(); openInviteManager(); }).catch(err => showToast(err.message)); // closeAllModals first: avoid stale manager modal stacking under the fresh one (U-3k audit LOW-1)
  }});
}

export function copyInviteCode(code) {
  navigator.clipboard?.writeText(code).then(() => showToast(TEXT.SUCCESS_COPIED)).catch(() => showToast(TEXT.ERROR_COPY));
}


export async function loadAdminAwards() {
  try {
    const data = await dhGet('/api/admin/awards', { domain: 'admin' });
    const el = document.getElementById('admin-awards-list');
    if (el) el.innerHTML = (data.awards || []).map(a => `<div class="list-card glass">${escHtml(a.title || '')}</div>`).join('');
  } catch (err) { showToast(err.message); }
}

export function viewAwardProof(id) { openModal({ title: TEXT.ADMIN_AWARD_PROOF, body: `<p>${String(id)}</p>` }); }
export function approveAward(id) { api(`/api/admin/awards/${id}/action`, { method: 'POST', body: { action: 'approve' } }).then(() => { invalidate('admin'); showToast(TEXT.ADMIN_DONE); loadAdminAwards(); }).catch(err => showToast(err.message)); } // Q-3b-F3: invalidate after write
export function rejectAwardModal(id) { openModal({ title: TEXT.ADMIN_AWARD_REJECT, body: `<div class="form-group"><label>${TEXT.ADMIN_REASON}</label><textarea id="award-reject-note" class="form-input"></textarea></div>`, footer: `<button type="button" class="btn glass glass--pressable" data-action="admin.submitAwardReject" data-id="${id}">${TEXT.BTN_CONFIRM}</button>` }); }
export async function submitAwardReject(id) { return doAwardAction(id, 'reject'); }
export async function doAwardAction(id, action) {
  const note = document.getElementById('award-reject-note')?.value || '';
  try { await api(`/api/admin/awards/${id}/action`, { method: 'POST', body: { action, note } }); closeModal(); invalidate('admin'); showToast(TEXT.ADMIN_DONE); loadAdminAwards(); } catch (err) { showToast(err.message); } // Q-3b-F3: invalidate after write
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
export function verifApprove(id) { api(`/api/admin/verifications/${id}/action`, { method: 'POST', body: { action: 'approve', school: document.getElementById('verif-school')?.value || '', level: document.getElementById('verif-level')?.value || '' } }).then(() => { invalidate('admin'); showToast(TEXT.ADMIN_DONE); loadAdminVerifications(); }).catch(err => showToast(err.message)); } // Q-3b-F3: invalidate after write
export function verifRevoke(id) { api(`/api/admin/verifications/${id}/action`, { method: 'POST', body: { action: 'revoke' } }).then(() => { invalidate('admin'); showToast(TEXT.ADMIN_DONE); loadAdminVerifications(); }).catch(err => showToast(err.message)); } // Q-3b-F3: invalidate after write
export function verifReject(id) { return verifRevoke(id); }

// U-3a rework (audit F1): verify/unverify is a danger op (server handleVerifyTeacher requires
// confirmDangerOtp) — wrap in confirm needReAuth + withCaptcha, aligned with the ban path.
export function toggleTeacherVerify(userId, verified = true) {
  confirm({ title: TEXT.ADMIN_BAN, message: verified ? TEXT.VERIFY_TEACHER_CONFIRM : TEXT.UNVERIFY_CONFIRM, needReAuth: true, onConfirm: async capToken => {
    withCaptcha(async () => {
      try {
        await api(`/api/admin/teachers/${userId}/verify`, { method: 'POST', body: { verified: !!verified, capToken } });
        invalidate('admin'); showToast(verified ? TEXT.ADMIN_DONE : TEXT.UNVERIFY_DONE); loadAdminTeachers();
      } catch (err) { showToast(err.message); }
    });
  }});
}
export function doTeacherVerify(userId) { return toggleTeacherVerify(userId, true); }
export function doUnverify(userId) { return toggleTeacherVerify(userId, false); }

// U-3a: open the teacher profile panel from an admin row. Delegated via the profile-panel-open
// event (Z-8-F1 pattern) so admin does not depend on the teacher feature module directly.
export function openProfilePanel(userId) {
  document.dispatchEvent(new CustomEvent('profile-panel-open', { detail: { userId } }));
}

export function closeModalAction() { closeModal(); }
