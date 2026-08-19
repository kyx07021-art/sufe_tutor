/**
 * teacher feature registry: browse-teachers page + delegation.
 */
import { TEXT } from './text.js';
import { registerPage } from '../../core/router.js';
import * as actions from './actions.js';

const ACTION_MAP = {
  'teacher.openProfile': el => actions.openProfilePanel(Number(el.dataset.id)),
  // Z-10-F1: write-review entry (profile panel button, teacherId read from module state — NOT el)
  'teacher.openReview': () => actions.openReviewModal(),
  'teacher.closeReview': actions.closeModalAction,
  'teacher.submitReview': actions.submitReview,
  'teacher.setStars': el => actions.setReviewStars(el),
  'teacher.approveReview': el => actions.adminReviewAction(Number(el.dataset.id), 'approve'),
  'teacher.rejectReview': el => actions.adminReviewAction(Number(el.dataset.id), 'reject'),
  'teacher.deleteReview': el => actions.confirmDeleteReview(Number(el.dataset.id)),
  'teacher.matchDetail': el => actions.showTeacherMatchDetail(Number(el.dataset.id)),
  'teacher.toggleFilters': actions.toggleFilters,
};

let installed = false;

function onActionClick(e) {
  const el = e.target && e.target.closest ? e.target.closest('[data-action]') : null;
  if (!el) return;
  const fn = ACTION_MAP[el.dataset.action];
  if (!fn) return;
  if (e.target && e.target.matches('input[type="file"]')) return;
  e.preventDefault();
  fn(el, e);
}

function onLoad() {
  if (installed || typeof document === 'undefined') return () => {};
  installed = true;
  registerPage({
    id: 'browse-teachers',
    roles: ['student', 'teacher'],
    label: TEXT.PAGE_BROWSE_TEACHERS,
    desc: TEXT.PAGE_BROWSE_TEACHERS_DESC,
    auth: false,
    enter: () => actions.loadTeachers(),
  });
  document.addEventListener('click', onActionClick);
  // Z-8-F1: avatar clicks are intercepted by anim.js capture and dispatch profile-panel-open
  // (core must not depend on features); the profile panel belongs to the teacher domain, so this
  // feature consumes the event (fixes dead avatar clicks across router/chat/student renderers)
  const onProfileOpen = e => { if (e.detail && e.detail.userId) actions.openProfilePanel(Number(e.detail.userId)); };
  document.addEventListener('profile-panel-open', onProfileOpen);
  return () => {
    document.removeEventListener('click', onActionClick);
    document.removeEventListener('profile-panel-open', onProfileOpen);
    installed = false;
  };
}

export default {
  id: 'teacher',
  text: TEXT,
  pages: [],
  actions: ACTION_MAP,
  onLoad,
};

export { actions, TEXT };
