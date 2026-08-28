/**
 * admin feature render helpers: pure row/card renderers + display mappers.
 * Extracted from actions.js (loaders stay in actions, DOM markup here).
 */
import { TEXT } from '../../constants/text.js';
import { ROLES, STATUS, VERIFY_TYPES, DEACTIVATED_USER_PREFIX } from '../../../shared/enums.js';
import { escHtml, fmtDateTime } from '../../core/dom.js';
import { priceRangeText, methodName, roleLabel } from '../../core/display.js';
import { teacherGradeName, ratingText, starsHtml, reviewStatusMeta } from '../teacher/display.js';
import { contractStatusMeta } from '../contract/display.js';
import { feedbackKindName, feedbackSubjectName, feedbackKindCls, isFeedbackBug } from '../complaints/display.js';

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

export function renderAdminFeedbackRow(f) {
  const resolved = f.status === STATUS.RESOLVED; // shared enum, not a bare literal
  const subject = feedbackSubjectName(f.subject); // non-complaint stays ''
  return `<div class="list-card glass feedback-card${isFeedbackBug(f.kind) ? ' feedback-card--bug' : ''}${resolved ? ' feedback-card--resolved' : ''}">
    <div class="list-card-header">
      <span class="list-card-title">${escHtml(f.title || TEXT.FEEDBACK_UNTITLED)}</span>
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

export function renderAdminContractRow(c) {
  const { text: statusText, cls: statusCls } = contractStatusMeta(c);
  const methodNameText = methodName(c.method) || c.method;
  return `<div class="admin-row glass admin-contract-row">
    <div class="admin-row-main">
      <div class="admin-row-line">
        <strong>${escHtml(c.student_name || '')} × ${escHtml(c.teacher_name || '')}</strong>
        <span class="tag glass glass--solid ${statusCls}">${escHtml(statusText)}</span>
      </div>
      <div class="admin-row-meta">${escHtml(TEXT.ADMIN_CONTRACT_DRAFTER_PREFIX)}${escHtml(c.drafter_name || '')} · ${escHtml(methodNameText)} · ${c.rate}${escHtml(TEXT.PRICE_UNIT)} · ${fmtDateTime(c.updated_at)}</div>
    </div>
    <div class="admin-row-actions">
      <button type="button" class="btn btn-soft btn-xs glass glass--pressable" data-action="admin.viewContract" data-id="${c.id}">${escHtml(TEXT.BTN_VIEW_CONTRACT)}</button>
      <button type="button" class="btn btn-soft btn-xs glass glass--pressable" data-action="admin.removeContract" data-id="${c.id}">${escHtml(TEXT.BTN_REMOVE_CONTRACT)}</button>
    </div>
  </div>`;
}

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

export function renderAdminContentRow(it) {
  const author = it.author && it.author.username ? escHtml(it.author.username) : escHtml(DEACTIVATED_USER_PREFIX);
  const roleTag = it.author && it.author.role ? `<span class="tag glass glass--solid">${escHtml(roleLabel(it.author.role))}</span>` : '';
  // rejected is a warn state too (a green 'approved-like' tag on rejected items was misleading)
  const warnStatus = it.status === STATUS.OPEN || it.status === STATUS.PENDING || it.status === STATUS.REJECTED;
  const statusTag = it.status ? `<span class="tag glass glass--solid ${warnStatus ? 'tag-warn' : 'tag-ok'}">${escHtml(it.status)}</span>` : '';
  const onlyBan = it.type === 'teacher'; // teacher profiles have no hard-delete branch
  return `<div class="list-card glass content-card">
    <div class="list-card-header">
      <span class="list-card-title">${escHtml(it.title || it.type)}</span>
      <span class="feedback-tags">
        <span class="tag glass glass--solid">${escHtml(contentTypeName(it.type))}</span>
        ${statusTag}${roleTag}
      </span>
    </div>
    <div class="list-card-detail">${escHtml(String(it.body || '').slice(0, 160))}</div>
    <div class="feedback-foot">
      <span class="list-card-meta">${author} · ${fmtDateTime(it.created_at)}</span>
      <div class="admin-row-actions">
        <button type="button" class="btn btn-soft btn-xs glass glass--pressable" data-action="admin.penalty" data-id="${it.id}" data-type="${escHtml(it.type || 'post')}">${onlyBan ? escHtml(TEXT.ADMIN_CONTENT_PENALTY_BAN) : escHtml(TEXT.ADMIN_CONTENT_PENALTY_DELETE) + ' / ' + escHtml(TEXT.ADMIN_CONTENT_PENALTY_BAN)}</button>
      </div>
    </div>
  </div>`;
}

export const contentTypeName = t => ({
  post: TEXT.ADMIN_CONTENT_TYPE_POST, demand: TEXT.ADMIN_CONTENT_TYPE_DEMAND, teacher: TEXT.ADMIN_CONTENT_TYPE_TEACHER,
  review: TEXT.ADMIN_CONTENT_TYPE_REVIEW, message: TEXT.ADMIN_CONTENT_TYPE_MESSAGE, feedback: TEXT.ADMIN_CONTENT_TYPE_FEEDBACK,
  complaint: TEXT.ADMIN_CONTENT_TYPE_COMPLAINT, upload: TEXT.ADMIN_CONTENT_TYPE_UPLOAD,
  contract: TEXT.ADMIN_CONTENT_TYPE_CONTRACT, signing: TEXT.ADMIN_CONTENT_TYPE_SIGNING,
}[t] || t);

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

// v1-parity admin user row (data-action delegation, no inline handlers). Student rows
// show demand count; teacher rows show grade/rating/price + verify badge. Actions are wired
// via ACTION_MAP (banUser/viewProfile/verifyTeacher/unverify).
export function renderAdminUserRow(u, role) {
  // student/teacher rows both expose user_id (dbGetStudentUsersAdmin / dbAdminSearchUsers / dbGetTeachers adminView) — no role branch
  const uid = u.user_id;
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

