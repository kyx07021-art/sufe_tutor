/**
 * admin feature registry: admin-stats page + delegation.
 */
import { TEXT } from '../../constants/text.js';
import { ROLES } from '../../../shared/enums.js'; // Z-16-F5: roles via shared enums
import { registerPage } from '../../core/router.js';
import { api } from '../../core/api.js';
import * as actions from './actions.js';
const ACTION_MAP = {
  'admin.closeModal': actions.closeModalAction,
  'admin.approveReview': el => api(`/api/admin/reviews/${el.dataset.id}/approve`, { method: 'POST', body: {} }).then(() => actions.loadAdminReviews()).catch(() => {}),
  'admin.rejectReview': el => api(`/api/admin/reviews/${el.dataset.id}/reject`, { method: 'POST', body: {} }).then(() => actions.loadAdminReviews()).catch(() => {}),
  'admin.penalty': el => actions.openContentPenaltyModal(el.dataset.id, el.dataset.type),
  'admin.submitPenalty': el => actions.doSubmitContentPenalty(el.dataset.id, el.dataset.type),
  'admin.deletePost': el => actions.adminDeletePost(Number(el.dataset.id)),
  'admin.submitAwardReject': el => actions.doAwardAction(Number(el.dataset.id), 'reject'),
};
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
  document.addEventListener('click', onActionClick);
  return () => { document.removeEventListener('click', onActionClick); installed = false; };
}
export default { id: 'admin', text: TEXT, pages: [], actions: ACTION_MAP, onLoad };
export { actions, TEXT };
