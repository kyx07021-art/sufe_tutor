/**
 * settings feature registry: account-settings page.
 */
import { TEXT } from './text.js';
import { registerPage } from '../../core/router.js';
import * as actions from './actions.js';
const ACTION_MAP = {
  'settings.closeModal': actions.closeModalAction,
  'settings.submitUsername': actions.submitUsername,
  'settings.revokeDevice': el => actions.revokeDeviceSession(el.dataset.id),
  'settings.saveAvatar': actions.saveAvatar,
  'settings.deactivate': actions.confirmDeactivateAccount,
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
function onChange(e) {
  const el = e.target;
  if (el && el.dataset && el.dataset.settingsPrivacy) actions.setPrivacyField(el.dataset.settingsPrivacy, el.checked ? 1 : 0);
}
function onLoad() {
  if (installed || typeof document === 'undefined') return () => {};
  installed = true;
  registerPage({ id: 'account-settings', roles: ['student','teacher','admin'], label: TEXT.PAGE_ACCOUNT_SETTINGS, desc: TEXT.PAGE_ACCOUNT_SETTINGS_DESC, auth: true, enter: () => actions.enterAccountSettings() });
  document.addEventListener('click', onActionClick);
  document.addEventListener('change', onChange);
  return () => { document.removeEventListener('click', onActionClick); document.removeEventListener('change', onChange); installed = false; };
}
export default { id: 'settings', text: TEXT, pages: [], actions: ACTION_MAP, onLoad };
export { actions, TEXT };
