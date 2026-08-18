/**
 * student/demand feature registry: my-demands + browse-demands pages.
 * data-action/change delegation + match-detail close listeners (v1 parity).
 */
import { TEXT } from './text.js';
import { registerPage } from '../../core/router.js';
import * as actions from './actions.js';
import { goChatWithStudent } from '../chat/actions-list.js';
import { openProfilePanel } from '../teacher/actions.js';

const ACTION_MAP = {
  'student.openDemand': el => actions.openDemandCard(Number(el.dataset.id)),
  'student.openModal': actions.openDemandModal,
  'student.closeModal': actions.closeModalAction,
  'student.deleteDemand': el => actions.confirmDeleteDemand(Number(el.dataset.id)),
  'student.reopenDemand': el => actions.reopenDemand(Number(el.dataset.id)),
  'student.editDemand': el => actions.openDemandModal(Number(el.dataset.id)), // audit fix: passthrough wrapper lost the id
  'student.push': el => actions.submitDemandPush(Number(el.dataset.teacher)),
  'student.openSendModal': el => actions.openSendDemandModal(Number(el.dataset.id)),
  'student.doSubmitIntent': el => actions.doSubmitIntent(Number(el.dataset.id)),
  'student.submitIntent': el => actions.submitIntent(Number(el.dataset.id)),
  'student.acceptIntent': el => actions.resolveIntent(Number(el.dataset.demand), Number(el.dataset.teacher)),
  'student.rejectIntent': el => actions.rejectIntent(Number(el.dataset.demand), Number(el.dataset.teacher)),
  'student.resolvePush': el => actions.resolvePush(Number(el.dataset.id), el.dataset.result === 'accept'),
  'student.toggleIntents': el => actions.toggleDemandIntents(Number(el.dataset.id)),
  'student.matchDetail': el => actions.showMatchDetail(Number(el.dataset.id)),
  'student.viewProfile': el => openProfilePanel(Number(el.dataset.id)),
  'student.goChat': el => goChatWithStudent(Number(el.dataset.id)),
  // 8-step wizard nav (dw-footer) + tag-pick buttons (data-container/data-max)
  'student.wizardNext': () => actions.demandWizardNext(),
  'student.wizardBack': () => actions.demandWizardBack(),
  'student.toggleTagPick': el => actions.toggleTagPickAction(el),
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
  // Form change listeners (province/method/grade/subjects/nonacademic) are direct bindings inside
  // initDemandForm -- no change delegation needed here anymore (old student.* data-change attrs gone).
  const uninstallMatchClose = actions.installMatchDetailClose();
  return () => {
    document.removeEventListener('click', onActionClick);
    uninstallMatchClose();
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
