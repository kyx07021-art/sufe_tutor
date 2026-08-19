/**
 * notif feature registry: notifications page (all roles).
 * data-action click delegation + keyboard delegation for markRead (no inline onkeydown,
 * archtest). Page leave hook = batch-read (seen-removed), wired via router prev.leave().
 */
import { registerPage } from '../../core/router.js';
import * as actions from './actions.js';
import { TEXT } from '../../constants/text.js';
import { ROLES } from '../../../shared/enums.js'; // Z-16-F5: roles via shared enums

const ACTION_MAP = {
  'notif.toggleBlock': () => actions.toggleNotifBlock(),
  'notif.markRead': el => actions.markNotifRead(el.dataset.id),
};

let installed = false;

function onActionClick(e) {
  const el = e.target && e.target.closest ? e.target.closest('[data-action]') : null;
  if (!el) return;
  const fn = ACTION_MAP[el.dataset.action];
  if (!fn) return;
  e.preventDefault();
  fn(el, e);
}

function onActionKeydown(e) {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const el = e.target && e.target.closest ? e.target.closest('[data-action="notif.markRead"]') : null;
  if (!el) return;
  e.preventDefault();
  actions.markNotifRead(el.dataset.id);
}

function onLoad() {
  if (installed || typeof document === 'undefined') return () => {};
  installed = true;
  registerPage({
    id: 'notifications',
    roles: Object.values(ROLES),
    label: TEXT.PAGE_NOTIFICATIONS,
    desc: TEXT.PAGE_NOTIFICATIONS_DESC,
    auth: true,
    enter: () => actions.enterNotifications(),
    leave: () => actions.markAllNotifsRead(),
  });
  document.addEventListener('click', onActionClick);
  document.addEventListener('keydown', onActionKeydown);
  return () => {
    document.removeEventListener('click', onActionClick);
    document.removeEventListener('keydown', onActionKeydown);
    installed = false;
  };
}

export default {
  id: 'notif',
  text: TEXT,
  pages: [],
  actions: ACTION_MAP,
  onLoad,
};

export { actions, TEXT };
