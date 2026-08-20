/**
 * admin feature actions: stats, users, demands, reviews, content, awards, verifications, posts,
 * contracts, feedback, invites, traffic. All admin pages are registered in index.js and wired
 * via data-action delegation (U-3 series); each loader renders its per-page v1-parity card.
 */
import { TEXT } from '../../constants/text.js';
import { ROLES } from '../../../shared/enums.js'; // Z-16-F5: roles via shared enums
import { api } from '../../core/api.js';
import { dhGet, invalidate } from '../../core/datahub.js';
import { openModal, closeModal, closeAllModals, showToast, confirm, withCaptcha } from '../../core/ui.js';
import { escHtml, fmtDateTime, loaderHtml, mdRender } from '../../core/dom.js'; // U-3f: post full-text modal via shared mdRender
import { priceRangeText, methodName } from '../../core/display.js'; // U-3g: contract method label
import { teacherGradeName, ratingText, starsHtml, reviewStatusMeta } from '../teacher/display.js'; // U-3a: teacher row meta; U-3c: review stars/status tag
import { renderDemandCard } from '../student/render.js'; // U-3b: shared demand card (admin:true reuse, W6)
import { contractStatusMeta } from '../contract/display.js'; // U-3g: contract status tag (shared single source)
import { splitContractBiz, stripContractMarker, renderContractDiff } from '../contract/render.js'; // U-3g: contract diff/full-text modal (W6 reuse)
import { feedbackKindName, feedbackSubjectName, feedbackKindCls } from '../complaints/display.js'; // U-3h: feedback kind/subject tags (shared single source)
import { STATUS, AWARD_STATUS, VERIFY_TYPES } from '../../../shared/enums.js'; // U-3c review / U-3d award / U-3e verify-type gates (shared enums)

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

// U-3b: admin demand list reuses the shared renderDemandCard (admin:true) — v1 parity without
// a second renderer. Keyset pagination via nextCursor + load-more (reset=true clears the cursor).
let _adminDemandsCursor = null;
let _adminDemandsAll = [];
let _adminDemandsBusy = false; // F6: in-flight guard — load-more double-click must not append twice (audit F1)
export async function loadAdminDemands(reset = true) {
  if (_adminDemandsBusy) return;
  _adminDemandsBusy = true;
  if (reset) { _adminDemandsCursor = null; _adminDemandsAll = []; }
  try {
    const qs = _adminDemandsCursor ? `?cursor=${encodeURIComponent(_adminDemandsCursor)}` : '';
    const data = await api(`/api/admin/demands${qs}`, { method: 'GET' });
    _adminDemandsAll = _adminDemandsAll.concat(data.demands || []);
    _adminDemandsCursor = data.nextCursor || null;
    const el = document.getElementById('admin-demands-list');
    if (!el) return;
    if (!_adminDemandsAll.length) { el.innerHTML = `<div class="empty-state"><p>${escHtml(TEXT.EMPTY_NO_DEMANDS)}</p></div>`; return; }
    el.innerHTML = _adminDemandsAll.map(d => renderDemandCard(d, { admin: true })).join('')
      + (_adminDemandsCursor ? `<div class="list-more-row"><button type="button" class="btn btn-outline glass glass--pressable" data-action="admin.loadMoreDemands">${escHtml(TEXT.BTN_LOAD_MORE)}</button></div>` : '');
  } catch (err) { showToast(err.message); }
  finally { _adminDemandsBusy = false; }
}

export function loadMoreAdminDemands() { return loadAdminDemands(false); }

export function adminDeleteDemand(id) {
  confirm({ title: TEXT.BTN_DELETE_DEMAND, message: TEXT.CONFIRM_DELETE_DEMAND, onConfirm: () => {
    api(`/api/admin/demands/${id}`, { method: 'DELETE', body: {} })
      .then(() => { invalidate('admin'); showToast(TEXT.ADMIN_DONE); loadAdminDemands(true); })
      .catch(err => showToast(err.message)); // Q-3b-F3: invalidate after write
  }});
}

// U-3c: review moderation — status filter (service GET /api/admin/reviews?status=) + v1-parity row
// (teacher←reviewer + stars + status tag + comment + time; approve/reject only while PENDING).
export async function loadAdminReviews(status = '') {
  try {
    const qs = status ? `?status=${encodeURIComponent(status)}` : '';
    const data = await dhGet(`/api/admin/reviews${qs}`, { domain: 'admin' });
    const el = document.getElementById('admin-reviews-list');
    if (el) el.innerHTML = (data.reviews || []).map(renderAdminReviewRow).join('');
  } catch (err) { showToast(err.message); }
}

export function renderAdminReviewRow(r) {
  const st = reviewStatusMeta(r.status);
  return `<div class="admin-row glass admin-review-row">
    <div class="admin-row-main">
      <div class="admin-row-line">
        <strong>${escHtml(r.teacher_name || '')}</strong>
        <span class="text-muted">←</span> ${escHtml(r.reviewer_name || '')}
        ${starsHtml(r.rating)}${st ? `<span class="tag ${st.cls} glass glass--solid">${escHtml(st.text)}</span>` : ''}
      </div>
      <div class="review-text">${escHtml(r.comment || '')}</div>
      <div class="admin-row-meta">${fmtDateTime(r.created_at)}</div>
    </div>
    <div class="admin-row-actions">
      ${r.status === STATUS.PENDING ? `<button type="button" class="btn btn-soft btn-xs glass glass--pressable" data-action="admin.approveReview" data-id="${r.id}">${escHtml(TEXT.BTN_APPROVE)}</button>
      <button type="button" class="btn btn-soft btn-xs glass glass--pressable" data-action="admin.rejectReview" data-id="${r.id}">${escHtml(TEXT.BTN_REJECT)}</button>` : ''}
    </div>
  </div>`;
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


let _adminPostsCache = []; // U-3f: post full-text modal data source (closure, not window)

export async function loadAdminPosts() {
  try {
    // Q-3b-F1: `/api/posts?sort=new` is shared with the posts domain; the cache key must carry
    // domain 'posts' (datahub caches per-endpoint with a single domain slot). If an admin session
    // writes domain='admin' first, invalidate('posts')/dhRefreshDomain('posts') miss and the list
    // stays stale forever (server delete bumps only [POSTS]).
    const data = await dhGet('/api/posts?sort=new', { domain: 'posts' });
    _adminPostsCache = data.posts || []; // U-3f: full-text modal data source (v1 parity: closure not window)
    const el = document.getElementById('admin-posts-list');
    if (el) el.innerHTML = _adminPostsCache.length ? _adminPostsCache.map(renderAdminPostRow).join('') : `<p class="empty-state">${escHtml(TEXT.ADMIN_POSTS_EMPTY)}</p>`;
  } catch (err) { showToast(err.message); }
}

// U-3f: v1-parity admin post row — title + author + like count + created_at + view/remove
// buttons (data-action delegation, zero inline). The remove button carries capToken via
// adminDeletePost's needReAuth confirm (server now requires it for admin deletes).
export function renderAdminPostRow(p) {
  return `<div class="admin-row glass admin-post-row">
    <div class="admin-row-main">
      <div class="admin-row-line">
        <strong>${escHtml(p.title || '')}</strong>
        <span class="text-muted">${escHtml(p.username || '')}</span>
        <span class="list-card-meta">${p.like_count || 0} ${escHtml(TEXT.POST_LIKE_ARIA)}</span>
      </div>
      <div class="admin-row-meta">${fmtDateTime(p.created_at)}</div>
    </div>
    <div class="admin-row-actions">
      <button type="button" class="btn btn-soft btn-xs glass glass--pressable" data-action="admin.openPostView" data-id="${p.id}">${escHtml(TEXT.BTN_VIEW)}</button>
      <button type="button" class="btn btn-soft btn-xs glass glass--pressable" data-action="admin.deletePost" data-id="${p.id}">${escHtml(TEXT.BTN_REMOVE)}</button>
    </div>
  </div>`;
}

// U-3f: full-text modal — shared mdRender (core/dom.js) renders the post body.
export function openPostViewModal(id) {
  const p = _adminPostsCache.find(x => x.id === id);
  if (!p) { showToast(TEXT.ADMIN_POST_NOT_FOUND, 'error'); return; }
  openModal({
    title: p.title || '', cls: 'modal--wide',
    body: `<p class="text-sm text-muted modal-sub-info">${escHtml(p.username || '')} · ${fmtDateTime(p.created_at)}</p>
      <div class="md-preview glass glass--solid">${mdRender(p.body_md || '')}</div>`,
    footer: `<button type="button" class="btn glass glass--pressable" data-action="admin.closeModal">${escHtml(TEXT.BTN_CLOSE)}</button>`,
  });
}

export function adminDeletePost(id) {
  confirm({ title: TEXT.BTN_DELETE, message: TEXT.ADMIN_DELETE_CONFIRM, needReAuth: true, onConfirm: capToken => {
    withCaptcha(() => performPostDelete(id, capToken));
  }});
}
// U-3f: actual post-delete write path (adminDeletePost confirm delegates here). Exported for
// direct write-path testing — U-3f audit F1 (G1/G2): the confirm path is captcha-gated, so the
// write path is exercised directly, mirroring performAwardAction/performVerifAction.
export async function performPostDelete(id, capToken) {
  try {
    await api(`/api/posts/${id}`, { method: 'DELETE', body: { capToken } });
    invalidate('posts'); // Q-3b-F3: invalidate after write (loadAdminPosts reads dhGet cache)
    showToast(TEXT.ADMIN_DONE);
    loadAdminPosts();
  } catch (err) { showToast(err.message); }
}

// U-3g: contract management — v1-parity row (student×teacher + status tag + drafter/method/
// rate/time) + full-text modal with modification diff + remove (capToken via needReAuth confirm).
let _adminContractsCache = []; // contract full-text/diff modal data source (closure, not window)

export async function loadAdminContracts() {
  try {
    const data = await dhGet('/api/admin/contracts', { domain: 'contracts' }); // Q-3b-M1: single slot for /api/admin/contracts (aligns DH_PREFETCH 'contracts' + invalidate('contracts'))
    _adminContractsCache = data.contracts || [];
    const el = document.getElementById('admin-contracts-list');
    if (el) el.innerHTML = _adminContractsCache.length ? _adminContractsCache.map(renderAdminContractRow).join('') : `<p class="empty-state">${escHtml(TEXT.ADMIN_CONTRACTS_EMPTY)}</p>`;
  } catch (err) { showToast(err.message); }
}

export function renderAdminContractRow(c) {
  const { text: statusText, cls: statusCls } = contractStatusMeta(c);
  const methodNameText = methodName(c.method) || c.method;
  return `<div class="admin-row glass admin-contract-row">
    <div class="admin-row-main">
      <div class="admin-row-line">
        <strong>${escHtml(c.student_name || '')} × ${escHtml(c.teacher_name || '')}</strong>
        <span class="tag glass glass--solid ${statusCls}">${escHtml(statusText)}</span>
      </div>
      <div class="admin-row-meta">${escHtml(TEXT.ADMIN_CONTRACT_DRAFTER_PREFIX)}${escHtml(c.drafter_name || '')} · ${escHtml(methodNameText)} · ${c.hourly_rate}${escHtml(TEXT.PRICE_UNIT)} · ${fmtDateTime(c.updated_at)}</div>
    </div>
    <div class="admin-row-actions">
      <button type="button" class="btn btn-soft btn-xs glass glass--pressable" data-action="admin.viewContract" data-id="${c.id}">${escHtml(TEXT.BTN_VIEW_CONTRACT)}</button>
      <button type="button" class="btn btn-soft btn-xs glass glass--pressable" data-action="admin.removeContract" data-id="${c.id}">${escHtml(TEXT.BTN_REMOVE_CONTRACT)}</button>
    </div>
  </div>`;
}

// U-3g: full-text modal — modified contracts (prev_business set) render a diff block first
// (renderContractDiff + splitContractBiz), then the current body via shared mdRender, with the
// internal marker stripped (stripContractMarker single source).
export function adminViewContract(id) {
  const c = _adminContractsCache.find(x => x.id === id);
  if (!c) { showToast(TEXT.ADMIN_CONTRACT_NOT_FOUND, 'error'); return; }
  const diffHtml = c.prev_business ? renderContractDiff(c.prev_business, splitContractBiz(c.contract_md)) : '';
  openModal({
    title: diffHtml ? TEXT.CONTRACT_VIEW_DIFF_TITLE : TEXT.BTN_VIEW_CONTRACT,
    cls: 'modal--wide', bodyCls: 'contract-md',
    body: `${diffHtml ? `<div class="contract-diff-head">${escHtml(TEXT.CONTRACT_DIFF_HINT)}</div>
      <div class="contract-diff">${diffHtml}</div>
      <div class="contract-diff-divider"></div>` : ''}
      ${mdRender(stripContractMarker(c.contract_md))}`,
    footer: `<button type="button" class="btn glass glass--pressable" data-action="admin.closeModal">${escHtml(TEXT.BTN_CLOSE)}</button>`,
  });
}
export async function adminRemoveContract(id) {
  confirm({ title: TEXT.BTN_DELETE, message: TEXT.ADMIN_DELETE_CONFIRM, needReAuth: true, onConfirm: async capToken => {
    try { await api(`/api/admin/contracts/${id}`, { method: 'DELETE', body: { capToken } }); invalidate('contracts'); showToast(TEXT.ADMIN_DONE); loadAdminContracts(); } catch (err) { showToast(err.message); } // Q-3b-F3: invalidate after write
  }});
}

// U-3h: feedback review — v1-parity card (bug/complaint warning edge + resolved fade + kind/subject
// status tags + content + resolve button). Resolve stays a light action (no capToken; P12 lists
// logout/revoke/sign as danger ops — marking a feedback resolved is not one).
export async function loadAdminFeedback() {
  try {
    const data = await dhGet('/api/feedbacks', { domain: 'admin' });
    const el = document.getElementById('admin-feedback-list');
    if (el) el.innerHTML = (data.feedbacks || []).length ? (data.feedbacks || []).map(renderAdminFeedbackRow).join('') : `<p class="empty-state">${escHtml(TEXT.ADMIN_FEEDBACK_EMPTY)}</p>`;
  } catch (err) { showToast(err.message); }
}

export function renderAdminFeedbackRow(f) {
  const resolved = f.status === 'resolved';
  const subject = feedbackSubjectName(f.subject); // non-complaint stays ''
  return `<div class="list-card glass feedback-card${f.kind === 'bug' ? ' feedback-card--bug' : ''}${resolved ? ' feedback-card--resolved' : ''}">
    <div class="list-card-header">
      <span class="list-card-title">${escHtml(f.title || TEXT.BTN_FEEDBACK)}</span>
      <span class="feedback-tags">
        <span class="tag glass glass--solid ${feedbackKindCls(f.kind)}">${escHtml(feedbackKindName(f.kind))}</span>
        ${subject ? `<span class="tag glass glass--solid tag-ok">${escHtml(subject)}</span>` : ''}
        <span class="tag glass glass--solid ${resolved ? 'tag-ok' : 'tag-warn'}">${escHtml(resolved ? TEXT.FEEDBACK_STATUS_RESOLVED : TEXT.FEEDBACK_STATUS_OPEN)}</span>
      </span>
    </div>
    <div class="list-card-detail feedback-content">${escHtml(f.content)}</div>
    <div class="feedback-foot">
      <span class="list-card-meta">${escHtml(f.username)} · ${fmtDateTime(f.created_at)}</span>
      ${resolved ? '' : `<button type="button" class="btn btn-soft btn-xs glass glass--pressable" data-action="admin.resolveFeedback" data-id="${f.id}">${escHtml(TEXT.BTN_MARK_RESOLVED)}</button>`}
    </div>
  </div>`;
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


// U-3d: award moderation — status filter + v1-parity row (teacher + status tag + admin note +
// proof view + approve/reject while PENDING). Undefined status reads the current select value so
// post-write refreshes (approve/reject) keep the active filter instead of resetting to All.
export async function loadAdminAwards(status) {
  const el = document.getElementById('admin-awards-list');
  if (status === undefined) {
    const sel = document.getElementById('admin-awards-status');
    status = sel ? sel.value : '';
  }
  try {
    const qs = status ? `?status=${encodeURIComponent(status)}` : '';
    const data = await dhGet(`/api/admin/awards${qs}`, { domain: 'admin' });
    if (el) el.innerHTML = (data.awards || []).map(renderAdminAwardRow).join('');
  } catch (err) { showToast(err.message); }
}

function awardStatusTag(status) {
  if (status === AWARD_STATUS.APPROVED) return `<span class="tag tag-ok glass glass--solid">${escHtml(TEXT.AWARD_STATUS_APPROVED)}</span>`;
  if (status === AWARD_STATUS.REJECTED) return `<span class="tag tag-danger glass glass--solid">${escHtml(TEXT.AWARD_STATUS_REJECTED)}</span>`;
  return `<span class="tag tag-warn glass glass--solid">${escHtml(TEXT.AWARD_STATUS_PENDING)}</span>`;
}

export function renderAdminAwardRow(a) {
  return `<div class="admin-row glass admin-award-row">
    <div class="admin-row-main">
      <div class="admin-row-line">
        <strong>${escHtml(a.title || '')}</strong>
        ${escHtml(TEXT.ADMIN_AWARD_TEACHER_LABEL)}：${escHtml(a.teacher_username || '—')}
        ${awardStatusTag(a.status)}
      </div>
      ${a.admin_note ? `<div class="admin-award-note">${escHtml(TEXT.AWARD_REJECTED_NOTE_PREFIX)}${escHtml(a.admin_note)}</div>` : ''}
      <div class="admin-row-meta">${fmtDateTime(a.created_at)}</div>
    </div>
    <div class="admin-row-actions">
      ${a.proof_upload_id ? `<button type="button" class="btn btn-soft btn-xs glass glass--pressable" data-action="admin.viewAwardProof" data-id="${a.id}">${escHtml(TEXT.ADMIN_AWARD_PROOF_VIEW)}</button>` : ''}
      ${a.status === AWARD_STATUS.PENDING ? `<button type="button" class="btn btn-soft btn-xs glass glass--pressable" data-action="admin.approveAward" data-id="${a.id}">${escHtml(TEXT.ADMIN_AWARD_APPROVE)}</button>
      <button type="button" class="btn btn-soft btn-xs glass glass--pressable" data-action="admin.rejectAwardModal" data-id="${a.id}">${escHtml(TEXT.ADMIN_AWARD_REJECT)}</button>` : ''}
    </div>
  </div>`;
}

// U-3d: fetch the stored proof image and show it in a modal (GET /api/admin/awards/:id/proof).
export async function viewAwardProof(id) {
  try {
    const d = await api(`/api/admin/awards/${id}/proof`, { method: 'GET' });
    openModal({ title: TEXT.ADMIN_AWARD_PROOF, body: d.dataUrl ? `<img class="award-proof-img" src="${escHtml(d.dataUrl)}" alt="">` : `<p>${escHtml(TEXT.ADMIN_AWARD_NONE)}</p>`, footer: `<button type="button" class="btn glass glass--pressable" data-action="admin.closeModal">${escHtml(TEXT.BTN_CLOSE)}</button>` });
  } catch (err) { showToast(err.message); }
}
export function approveAward(id) {
  // Server handleAdminAwardAction is a danger op (confirmDangerOtp) — re-auth + captcha,
  // aligned with the ban/penalty paths.
  confirm({ title: TEXT.ADMIN_AWARD_APPROVE, message: TEXT.ADMIN_AWARD_APPROVE_CONFIRM, needReAuth: true, onConfirm: capToken => {
    withCaptcha(() => performAwardAction(id, 'approve', { capToken }));
  }});
}
export function rejectAwardModal(id) { openModal({ title: TEXT.ADMIN_AWARD_REJECT, body: `<div class="form-group"><label>${escHtml(TEXT.ADMIN_AWARD_REJECT_HINT)}</label><textarea id="award-reject-note" class="form-input" placeholder="${escHtml(TEXT.ADMIN_AWARD_REJECT_PLACEHOLDER)}"></textarea></div>`, footer: `<button type="button" class="btn glass glass--pressable" data-action="admin.submitAwardReject" data-id="${id}">${TEXT.BTN_CONFIRM}</button>` }); }
export function doAwardAction(id, action) {
  const note = document.getElementById('award-reject-note')?.value || '';
  if (action === 'reject' && !note.trim()) { showToast(TEXT.ADMIN_AWARD_REJECT_REQUIRED, 'error'); return; }
  confirm({ title: TEXT.ADMIN_AWARD_REJECT, message: TEXT.ADMIN_AWARD_REJECT_CONFIRM, needReAuth: true, onConfirm: capToken => {
    withCaptcha(() => performAwardAction(id, action, { note, capToken }));
  }});
}
// U-3d: actual award write path (both confirm flows delegate here). Exported for direct
// write-path testing — Q-3b-F3b/F3c invalidate guard drives it, bypassing the confirm UI.
export async function performAwardAction(id, action, { note = '', capToken } = {}) {
  try {
    await api(`/api/admin/awards/${id}/action`, { method: 'POST', body: { action, note, capToken } });
    closeModal(); invalidate('admin'); showToast(TEXT.ADMIN_DONE); loadAdminAwards(); // Q-3b-F3: invalidate after write
  } catch (err) { showToast(err.message); }
}

// U-3e: verification review queue — v1-parity card (user + verify_type tag + status tag +
// verify code + meta + admission preview + structured approve form / reject / revoke). All
// danger ops wrapped in confirm needReAuth + captcha (server requires capToken per U-3e-s1).
let _verifListCache = []; // admission-image lookup for viewAdmissionImage (v1 parity: closure, not window)

export async function loadAdminVerifications(status) {
  const el = document.getElementById('admin-verifications-list');
  if (status === undefined) {
    const sel = document.getElementById('admin-verif-status');
    status = sel ? sel.value : 'all';
  }
  try {
    const qs = status && status !== 'all' ? `?status=${encodeURIComponent(status)}` : '';
    const data = await dhGet(`/api/admin/verifications${qs}`, { domain: 'admin' });
    _verifListCache = data.verifications || [];
    if (el) el.innerHTML = _verifListCache.length ? _verifListCache.map(renderVerifCard).join('') : `<p class="empty-state">${escHtml(TEXT.ADMIN_VERIF_EMPTY)}</p>`;
  } catch (err) { showToast(err.message); }
}

function verifStatusTag(status) {
  if (status === STATUS.APPROVED) return `<span class="tag tag-ok glass glass--solid">${escHtml(TEXT.VERIF_APPROVED)}</span>`;
  if (status === STATUS.REJECTED) return `<span class="tag tag-danger glass glass--solid">${escHtml(TEXT.VERIF_REJECTED)}</span>`;
  return `<span class="tag tag-warn glass glass--solid">${escHtml(TEXT.VERIF_PENDING)}</span>`;
}

export function renderVerifCard(v) {
  return `<div class="list-card glass verif-card" data-id="${v.id}">
    <div class="verif-head">
      <span class="verif-user">${escHtml(v.username || ('#' + v.user_id))}</span>
      ${v.verify_type === VERIFY_TYPES.ADMISSION ? `<span class="tag tag-accent glass glass--solid">${escHtml(TEXT.ADMIN_VERIF_ADMISSION_TAG)}</span>` : ''}
      ${verifStatusTag(v.status)}
      <span class="verif-code">${v.verify_type === VERIFY_TYPES.ADMISSION ? escHtml(TEXT.ADMIN_VERIF_ADMISSION_NO_CODE) : escHtml(v.verify_code)}</span>
    </div>
    <div class="verif-meta">${fmtDateTime(v.created_at)}${v.verified_at ? ' · ' + fmtDateTime(v.verified_at) : ''}</div>
    ${v.verify_type === VERIFY_TYPES.ADMISSION && v.admission_image ? `<div class="verif-admission-preview"><button type="button" class="btn btn-soft btn-xs glass glass--pressable" data-action="admin.viewAdmissionImage" data-id="${v.id}">${escHtml(TEXT.ADMIN_VERIF_ADMISSION_VIEW_IMG)}</button></div>` : ''}
    ${v.status === STATUS.APPROVED ? `<div class="verif-result">${escHtml([v.school, v.level, v.major, v.enrollment_status, v.enroll_year].filter(Boolean).join(' · '))}</div>
      <div class="verif-actions"><button type="button" class="btn btn-soft btn-sm glass glass--pressable" data-action="admin.verifRevoke" data-id="${v.id}">${escHtml(TEXT.ADMIN_VERIF_REVOKE_BTN)}</button></div>` : ''}
    ${v.status === STATUS.PENDING ? renderVerifForm(v) : ''}
  </div>`;
}

// v1-parity structured approve form (5 fields; school+level required on submit).
export function renderVerifForm(v) {
  return `<div class="verif-form">
    <p class="verif-form-hint">${escHtml(TEXT.ADMIN_VERIF_FORM_HINT)}</p>
    <div class="verif-grid">
      <div class="form-group"><label class="form-label">${escHtml(TEXT.ADMIN_VERIF_SCHOOL_LABEL)}</label><input type="text" class="form-input" id="verif-school-${v.id}" maxlength="30" placeholder="${escHtml(TEXT.ADMIN_VERIF_SCHOOL_PLACEHOLDER)}"></div>
      <div class="form-group"><label class="form-label">${escHtml(TEXT.ADMIN_VERIF_LEVEL_LABEL)}</label><input type="text" class="form-input" id="verif-level-${v.id}" maxlength="20" placeholder="${escHtml(TEXT.ADMIN_VERIF_LEVEL_PLACEHOLDER)}"></div>
      <div class="form-group"><label class="form-label">${escHtml(TEXT.ADMIN_VERIF_MAJOR_LABEL)}</label><input type="text" class="form-input" id="verif-major-${v.id}" maxlength="60" placeholder="${escHtml(TEXT.ADMIN_VERIF_MAJOR_PLACEHOLDER)}"></div>
      <div class="form-group"><label class="form-label">${escHtml(TEXT.ADMIN_VERIF_STATUS_LABEL)}</label><input type="text" class="form-input" id="verif-status-${v.id}" maxlength="20" placeholder="${escHtml(TEXT.ADMIN_VERIF_STATUS_PLACEHOLDER)}"></div>
      <div class="form-group"><label class="form-label">${escHtml(TEXT.ADMIN_VERIF_YEAR_LABEL)}</label><input type="text" class="form-input" id="verif-year-${v.id}" maxlength="10" placeholder="${escHtml(TEXT.ADMIN_VERIF_YEAR_PLACEHOLDER)}"></div>
    </div>
    <div class="verif-actions">
      <button type="button" class="btn btn-soft btn-sm glass glass--pressable" data-action="admin.verifApprove" data-id="${v.id}">${escHtml(TEXT.ADMIN_VERIF_APPROVE_BTN)}</button>
      <button type="button" class="btn btn-soft btn-sm glass glass--pressable" data-action="admin.verifReject" data-id="${v.id}">${escHtml(TEXT.ADMIN_VERIF_REJECT_BTN)}</button>
    </div>
  </div>`;
}

export function verifApprove(id) {
  const g = s => ((document.getElementById(s) || {}).value || '').trim();
  const body = {
    action: 'approve',
    school: g(`verif-school-${id}`), level: g(`verif-level-${id}`),
    major: g(`verif-major-${id}`), enrollment_status: g(`verif-status-${id}`),
    enroll_year: g(`verif-year-${id}`),
  };
  if (!body.school || !body.level) { showToast(TEXT.ADMIN_VERIF_APPROVE_REQUIRED, 'error'); return; }
  confirm({ title: TEXT.ADMIN_VERIF_APPROVE_BTN, message: TEXT.ADMIN_VERIF_APPROVE_CONFIRM, needReAuth: true, onConfirm: capToken => {
    withCaptcha(() => performVerifAction(id, body, { capToken }));
  }});
}
// L-1 (U-3e audit): reject collects an optional reason — server supports body.reason and sends
// it in the VERIFY_REJECTED notification; without it the notified reason is always empty. The
// optional reason is gathered in a modal, submit goes through needReAuth re-auth + captcha.
export function verifReject(id) {
  openModal({ title: TEXT.ADMIN_VERIF_REJECT_BTN, body: `<div class="form-group"><label>${escHtml(TEXT.ADMIN_VERIF_REASON_LABEL)}</label><textarea id="verif-reject-reason" class="form-input" rows="3" placeholder="${escHtml(TEXT.ADMIN_VERIF_REASON_PLACEHOLDER)}"></textarea></div>`, footer: `<button type="button" class="btn btn-outline glass glass--pressable" data-action="admin.closeModal">${escHtml(TEXT.BTN_CANCEL)}</button><button type="button" class="btn glass glass--pressable" data-action="admin.verifRejectConfirm" data-id="${id}">${escHtml(TEXT.BTN_CONFIRM)}</button>` });
}
export function verifRejectConfirm(id) {
  const reason = document.getElementById('verif-reject-reason')?.value.trim() || '';
  closeModal(); // close the reason modal before the reauth confirm (U-3e re-review obs: avoid two stacked modals)
  confirm({ title: TEXT.ADMIN_VERIF_REJECT_BTN, message: TEXT.ADMIN_VERIF_REJECT_CONFIRM, needReAuth: true, onConfirm: capToken => {
    withCaptcha(() => performVerifAction(id, { action: 'reject', reason }, { capToken }));
  }});
}
export function verifRevoke(id) {
  confirm({ title: TEXT.ADMIN_VERIF_REVOKE_BTN, message: TEXT.ADMIN_VERIF_REVOKE_CONFIRM, needReAuth: true, onConfirm: capToken => {
    withCaptcha(() => performVerifAction(id, { action: 'revoke' }, { capToken }));
  }});
}
// U-3e: actual verification write path (all three confirm flows delegate here). Exported for
// direct write-path testing — cache-invalidate-guard drives it, bypassing the confirm UI.
export async function performVerifAction(id, body, { capToken } = {}) {
  try {
    await api(`/api/admin/verifications/${id}/action`, { method: 'POST', body: { ...body, capToken } });
    invalidate('admin'); // Q-3b-F3: invalidate after write
    showToast(body.action === 'approve' ? TEXT.ADMIN_VERIF_APPROVED_OK : body.action === 'revoke' ? TEXT.ADMIN_VERIF_REVOKED_OK : TEXT.ADMIN_VERIF_REJECTED_OK, 'success');
    loadAdminVerifications();
  } catch (err) { showToast(err.message); }
}

export function viewAdmissionImage(id) {
  const v = _verifListCache.find(x => x.id === id);
  if (!v) { showToast(TEXT.ADMIN_VERIF_NOT_FOUND, 'error'); return; }
  openModal({ title: TEXT.ADMIN_ADMISSION_IMAGE, body: v.admission_image ? `<img class="verif-admission-img" src="${escHtml(v.admission_image)}" alt="">` : `<p>${escHtml(TEXT.ADMIN_VERIF_EMPTY)}</p>`, footer: `<button type="button" class="btn glass glass--pressable" data-action="admin.closeModal">${escHtml(TEXT.BTN_CLOSE)}</button>` });
}

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
