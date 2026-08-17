/**
 * student/demand feature registry: my-demands + browse-demands pages.
 */
import { TEXT } from './text.js';
import { registerPage } from '../../core/router.js';
import * as actions from './actions.js';

const ACTION_MAP = {
  'student.openDemand': el => actions.openDemandCard(Number(el.dataset.id)),
  'student.openModal': actions.openDemandModal,
  'student.submitDemand': actions.handleSubmitDemand,
  'student.closeModal': actions.closeModalAction,
  'student.deleteDemand': el => actions.confirmDeleteDemand(Number(el.dataset.id)),
  'student.reopenDemand': el => actions.reopenDemand(Number(el.dataset.id)),
  'student.push': el => actions.submitDemandPush(Number(el.dataset.id)),
  'student.acceptIntent': el => actions.resolveIntent(Number(el.dataset.demand), Number(el.dataset.teacher)),
  'student.submitIntent': el => actions.submitIntent(Number(el.dataset.id)),
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
  registerPage({ id: 'my-demands', roles: ['student'], label: TEXT.PAGE_MY_DEMANDS, desc: TEXT.PAGE_MY_DEMANDS_DESC, auth: true, enter: () => actions.loadMyDemands() });
  registerPage({ id: 'browse-demands', roles: ['teacher'], label: TEXT.PAGE_BROWSE_DEMANDS, desc: TEXT.PAGE_BROWSE_DEMANDS_DESC, auth: false, enter: () => actions.loadBrowseDemands() });
  document.addEventListener('click', onActionClick);
  return () => {
    document.removeEventListener('click', onActionClick);
    installed = false;
  };
}

export default {
  id: 'student',
  text: TEXT,
  pages: [],
  actions: ACTION_MAP,
  onLoad,
};

export { actions, TEXT };
