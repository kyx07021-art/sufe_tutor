/**
 * admin feature registry: admin-stats page + delegation.
 */
import { TEXT } from '../../constants/text.js';
import { ROLES } from '../../../shared/enums.js'; // Z-16-F5: roles via shared enums
import { registerPage } from '../../core/router.js';
import { api } from '../../core/api.js';
import { invalidate } from '../../core/datahub.js'; // Q-3b-F3: invalidate after write
import * as actions from './actions.js';
const ACTION_MAP = {
  'admin.closeModal': actions.closeModalAction,
  'admin.approveReview': el => api(`/api/admin/reviews/${el.dataset.id}/approve`, { method: 'POST', body: {} }).then(() => { invalidate('admin'); actions.loadAdminReviews(); }).catch(() => {}), // Q-3b-F3
  'admin.rejectReview': el => api(`/api/admin/reviews/${el.dataset.id}/reject`, { method: 'POST', body: {} }).then(() => { invalidate('admin'); actions.loadAdminReviews(); }).catch(() => {}), // Q-3b-F3
  'admin.penalty': el => actions.openContentPenaltyModal(Number(el.dataset.id), el.dataset.type),
  'admin.submitPenalty': el => actions.doSubmitContentPenalty(Number(el.dataset.id), el.dataset.type, el.dataset.actionType || 'remove'),
  // U-3f: posts management — full-text view + remove (capToken via needReAuth confirm)
  'admin.openPostView': el => actions.openPostViewModal(Number(el.dataset.id)),
  'admin.deletePost': el => actions.adminDeletePost(Number(el.dataset.id)),
  'admin.submitAwardReject': el => actions.doAwardAction(Number(el.dataset.id), 'reject'),
  // U-3d: award review — view proof, approve (confirm), reject (reason modal)
  'admin.viewAwardProof': el => actions.viewAwardProof(Number(el.dataset.id)),
  'admin.approveAward': el => actions.approveAward(Number(el.dataset.id)),
  'admin.rejectAwardModal': el => actions.rejectAwardModal(Number(el.dataset.id)),
  // U-3a: user management rows — ban/unban (capToken re-auth), view profile, verify/unverify
  'admin.banUser': el => actions.confirmBanUser(Number(el.dataset.id), el.dataset.banned !== '0', el.dataset.role || ROLES.STUDENT),
  'admin.viewProfile': el => actions.openProfilePanel(Number(el.dataset.id)),
  'admin.verifyTeacher': el => actions.toggleTeacherVerify(Number(el.dataset.id), true),
  'admin.unverify': el => actions.toggleTeacherVerify(Number(el.dataset.id), false),
  // U-3k: invite-code issuance/management (admin-stats block + manager modal)
  'admin.genInvite': actions.generateInviteCode,
  'admin.openInviteManager': actions.openInviteManager,
  'admin.revokeInvite': el => actions.revokeInvite(el.dataset.code),
  'admin.copyInvite': el => actions.copyInviteCode(el.dataset.code),
  // U-3b: demand management — admin remove (via /api/admin/demands/:id) + keyset load-more
  'admin.deleteDemand': el => actions.adminDeleteDemand(Number(el.dataset.id)),
  'admin.loadMoreDemands': actions.loadMoreAdminDemands,
  // U-3e: verification queue — admission image preview + approve (structured form) / reject / revoke
  'admin.viewAdmissionImage': el => actions.viewAdmissionImage(Number(el.dataset.id)),
  'admin.verifApprove': el => actions.verifApprove(Number(el.dataset.id)),
  'admin.verifReject': el => actions.verifReject(Number(el.dataset.id)),
  'admin.verifRejectConfirm': el => actions.verifRejectConfirm(Number(el.dataset.id)),
  'admin.verifRevoke': el => actions.verifRevoke(Number(el.dataset.id)),
  // U-3g: contract management — full-text view (with diff) + remove (capToken via needReAuth confirm)
  'admin.viewContract': el => actions.adminViewContract(Number(el.dataset.id)),
  'admin.removeContract': el => actions.adminRemoveContract(Number(el.dataset.id)),
  // U-3h: feedback review — mark resolved (light action, invalidate + reload)
  'admin.resolveFeedback': el => actions.resolveAdminFeedback(Number(el.dataset.id)),
};
// U-3i: admin seg-tabs (ui.js applyTabBindings dispatches seg-tab-change, bubbles to document).
// Filter by container id so other features' seg-tabs don't trigger admin reloads.
function onSegTab(e) {
  const tabs = e.detail && e.detail.container;
  if (tabs && tabs.id === 'admin-content-tabs') actions.loadAdminContent(String(e.detail.key || ''));
}
let installed = false;
function onActionClick(e) {
  const el = e.target && e.target.closest ? e.target.closest('[data-action]') : null;
  if (!el) return;
  const fn = ACTION_MAP[el.dataset.action];
  if (!fn) return;
  if (e.target && e.target.matches('input[type="file"]')) return;
  e.preventDefault(); fn(el, e);
}
function onLoad() {
  if (installed || typeof document === 'undefined') return () => {};
  installed = true;
  registerPage({ id: 'admin-stats', roles: [ROLES.ADMIN], label: TEXT.PAGE_ADMIN_STATS, desc: TEXT.PAGE_ADMIN_STATS_DESC, auth: true, enter: () => actions.loadAdminStats() });
  // Z-3-F1/U-2: restore the 11 dormant admin modules (B5 admin-panel parity) — each page
  // enters via its existing loader; content pages get their per-page rendering upgrades in U-3a..j.
  registerPage({ id: 'admin-traffic', roles: [ROLES.ADMIN], label: TEXT.PAGE_ADMIN_TRAFFIC, desc: TEXT.PAGE_ADMIN_TRAFFIC_DESC, auth: true, enter: () => actions.loadAdminTraffic() });
  registerPage({ id: 'admin-students', roles: [ROLES.ADMIN], label: TEXT.PAGE_ADMIN_STUDENTS, desc: TEXT.PAGE_ADMIN_STUDENTS_DESC, auth: true, enter: () => actions.loadAdminStudents() });
  registerPage({ id: 'admin-teachers', roles: [ROLES.ADMIN], label: TEXT.PAGE_ADMIN_TEACHERS, desc: TEXT.PAGE_ADMIN_TEACHERS_DESC, auth: true, enter: () => actions.loadAdminTeachers() });
  registerPage({ id: 'admin-demands', roles: [ROLES.ADMIN], label: TEXT.PAGE_ADMIN_DEMANDS, desc: TEXT.PAGE_ADMIN_DEMANDS_DESC, auth: true, enter: () => actions.loadAdminDemands() });
  registerPage({ id: 'admin-reviews', roles: [ROLES.ADMIN], label: TEXT.PAGE_ADMIN_REVIEWS, desc: TEXT.PAGE_ADMIN_REVIEWS_DESC, auth: true, enter: () => actions.loadAdminReviews() });
  registerPage({ id: 'admin-awards', roles: [ROLES.ADMIN], label: TEXT.PAGE_ADMIN_AWARDS, desc: TEXT.PAGE_ADMIN_AWARDS_DESC, auth: true, enter: () => actions.loadAdminAwards() });
  registerPage({ id: 'admin-verifications', roles: [ROLES.ADMIN], label: TEXT.PAGE_ADMIN_VERIFICATIONS, desc: TEXT.PAGE_ADMIN_VERIFICATIONS_DESC, auth: true, enter: () => actions.loadAdminVerifications() });
  registerPage({ id: 'admin-posts', roles: [ROLES.ADMIN], label: TEXT.PAGE_ADMIN_POSTS, desc: TEXT.PAGE_ADMIN_POSTS_DESC, auth: true, enter: () => actions.loadAdminPosts() });
  registerPage({ id: 'admin-contracts', roles: [ROLES.ADMIN], label: TEXT.PAGE_ADMIN_CONTRACTS, desc: TEXT.PAGE_ADMIN_CONTRACTS_DESC, auth: true, enter: () => actions.loadAdminContracts() });
  registerPage({ id: 'admin-feedback', roles: [ROLES.ADMIN], label: TEXT.PAGE_ADMIN_FEEDBACK, desc: TEXT.PAGE_ADMIN_FEEDBACK_DESC, auth: true, enter: () => actions.loadAdminFeedback() });
  registerPage({ id: 'admin-content', roles: [ROLES.ADMIN], label: TEXT.PAGE_ADMIN_CONTENT, desc: TEXT.PAGE_ADMIN_CONTENT_DESC, auth: true, enter: () => actions.loadAdminContent() });
  document.addEventListener('click', onActionClick);
  document.addEventListener('seg-tab-change', onSegTab); // U-3i: content-review type tabs
  // U-3a: debounced username search on the admin students/teachers pages (input delegation)
  function onInput(e) {
    const el = e.target && e.target.closest ? e.target.closest('[data-input-action]') : null;
    if (!el) return;
    if (el.dataset.inputAction === 'admin.searchStudents') actions.adminUsersSearchDebounced(ROLES.STUDENT, el.value);
    else if (el.dataset.inputAction === 'admin.searchTeachers') actions.adminUsersSearchDebounced(ROLES.TEACHER, el.value);
  }
  document.addEventListener('input', onInput);
  // U-3c: admin reviews status filter; U-3d: admin awards status filter; U-3e: verif status filter
  function onChange(e) {
    const el = e.target;
    if (!el || !el.dataset) return;
    if (el.dataset.change === 'admin.filterReviews') actions.loadAdminReviews(el.value);
    else if (el.dataset.change === 'admin.filterAwards') actions.loadAdminAwards(el.value);
    else if (el.dataset.change === 'admin.filterVerif') actions.loadAdminVerifications(el.value);
  }
  document.addEventListener('change', onChange);
  return () => { document.removeEventListener('click', onActionClick); document.removeEventListener('input', onInput); document.removeEventListener('change', onChange); document.removeEventListener('seg-tab-change', onSegTab); installed = false; };
}
export default { id: 'admin', text: TEXT, pages: [], actions: ACTION_MAP, onLoad };
export { actions, TEXT };
