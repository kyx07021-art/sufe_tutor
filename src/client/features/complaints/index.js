/**
 * complaints feature registry: page registration + data-action/change/seg-tab delegation.
 */
import { TEXT } from '../../constants/text.js';
import { ROLES } from '../../../shared/enums.js'; // Z-16-F5: roles via shared enums
import { registerPage } from '../../core/router.js';
import * as actions from './actions.js';
import * as render from './render.js';

const ACTION_MAP = {
  'complaints.close': actions.closeComplaintModal,
  'complaints.submit': actions.submitComplaint,
  'complaints.stageFiles': el => actions.complaintStageFiles(el),
  'complaints.unstage': el => actions.complaintUnstage(Number(el.dataset.id)),
  'complaints.pickRecent': el => actions.pickComplaintTarget(el.dataset.type, Number(el.dataset.id), el.dataset.name),
  'complaints.pickSearch': el => actions.pickComplaintTarget(el.dataset.type, Number(el.dataset.id), el.dataset.name),
  'complaints.clearTarget': el => actions.clearComplaintTarget(el.dataset.type),
  'complaints.openAttachment': el => actions.complaintOpenAttachment(Number(el.dataset.id), Number(el.dataset.idx)),
  'complaints.resolve': el => actions.resolveAdminComplaint(Number(el.dataset.id)),
};

let installed = false;

function onActionClick(e) {
  const el = e.target && e.target.closest ? e.target.closest('[data-action]') : null;
  if (!el) return;
  const fn = ACTION_MAP[el.dataset.action];
  if (!fn) return;
  if (e.target && e.target.matches('input[type="file"]')) return; // let file picker open; change handler uploads
  e.preventDefault();
  fn(el, e);
}

function onFileChange(e) {
  const el = e.target;
  if (el && el.dataset && el.dataset.action === 'complaints.stageFiles') actions.complaintStageFiles(el);
}

function onInput(e) {
  const el = e.target;
  if (el && el.dataset && el.dataset.cmpSearch) actions.complaintSearchInput(el.dataset.cmpSearch);
}

function onChange(e) {
  const el = e.target;
  if (!el || !el.dataset) return;
  if (el.dataset.change === 'complaints.reason') actions.switchComplaintReason(el);
}

function onSegTab(e) {
  const tabs = e.detail && e.detail.container;
  if (tabs && tabs.classList && tabs.classList.contains('complaint-tabs') && e.detail.key) {
    actions.switchComplaintTab(e.detail.key);
  }
}

function onLoad() {
  if (installed || typeof document === 'undefined') return () => {};
  installed = true;
  registerPage({
    id: 'admin-complaint',
    roles: [ROLES.ADMIN],
    label: TEXT.PAGE_ADMIN_COMPLAINT,
    desc: TEXT.PAGE_ADMIN_COMPLAINT_DESC,
    auth: true,
    enter: () => actions.loadAdminComplaints(),
  });
  document.addEventListener('click', onActionClick);
  document.addEventListener('input', onInput);
  document.addEventListener('change', onChange);
  document.addEventListener('change', onFileChange);
  document.addEventListener('seg-tab-change', onSegTab);
  return () => {
    document.removeEventListener('click', onActionClick);
    document.removeEventListener('input', onInput);
    document.removeEventListener('change', onChange);
    document.removeEventListener('change', onFileChange);
    document.removeEventListener('seg-tab-change', onSegTab);
    installed = false;
  };
}

export default {
  id: 'complaints',
  text: TEXT,
  pages: [],
  actions: ACTION_MAP,
  onLoad,
};

export { actions };
export { render };
