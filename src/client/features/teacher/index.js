/**
 * teacher feature registry: browse-teachers page + delegation.
 */
import { TEXT } from '../../constants/text.js';
import { ROLES } from '../../../shared/enums.js'; // Z-16-F5: roles via shared enums
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
  // Z-3-F1 F1d1: tag-pick toggles on the profile form (personality + nonacademic projects)
  'teacher.toggleTagPick': el => actions.teacherTagPick(el),
  // Z-3-F1 F1d2: gaokao editor first-subject / science-arts-track pill switches
  'teacher.pickGkPill': el => actions.pickGkPill(el),
  'teacher.pickGkTrack': el => actions.pickGkTrack(el),
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
    roles: [ROLES.STUDENT, ROLES.TEACHER],
    label: TEXT.PAGE_BROWSE_TEACHERS,
    desc: TEXT.PAGE_BROWSE_TEACHERS_DESC,
    auth: false,
    enter: () => actions.loadTeachers(),
  });
  // Z-3-F1: teacher profile page — enter fetches own profile and renders the edit form
  registerPage({
    id: 'teacher-profile',
    roles: [ROLES.TEACHER],
    label: TEXT.PAGE_TEACHER_PROFILE,
    desc: TEXT.PAGE_TEACHER_PROFILE_DESC,
    auth: true,
    enter: () => actions.enterTeacherProfile(),
  });
  document.addEventListener('click', onActionClick);
  // Q-4a-M1b/M1c: teacher sort/filter controls change delegation (shell data-change attrs)
  function onChange(e) {
    const el = e.target;
    if (!el || !el.dataset) return;
    if (el.dataset.change === 'teacher.applyFilters') { actions.applyFilters(); return; }
    if (el.dataset.change === 'teacher.sort') { actions.teacherSortFromSelect(el); }
  }
  document.addEventListener('change', onChange);
  // Z-8-F1: avatar clicks are intercepted by anim.js capture and dispatch profile-panel-open
  // (core must not depend on features); the profile panel belongs to the teacher domain, so this
  // feature consumes the event (fixes dead avatar clicks across router/chat/student renderers)
  const onProfileOpen = e => { if (e.detail && e.detail.userId) actions.openProfilePanel(Number(e.detail.userId)); };
  document.addEventListener('profile-panel-open', onProfileOpen);
  return () => {
    document.removeEventListener('click', onActionClick);
    document.removeEventListener('change', onChange);
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
