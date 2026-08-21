/**
 * settings feature registry: account-settings page.
 */
import { TEXT } from '../../constants/text.js';
import { ROLES } from '../../../shared/enums.js';
import { registerPage } from '../../core/router.js';
import * as actions from './actions.js';
const ACTION_MAP = {
  'settings.closeModal': actions.closeModalAction,
  'settings.openUsernameChange': actions.openUsernameChangeModal,
  'settings.submitUsername': actions.submitUsername,
  'settings.revokeDevice': el => actions.revokeDeviceSession(el.dataset.id),
  'settings.saveAvatar': actions.saveAvatar,
  'settings.deactivate': actions.confirmDeactivateAccount,
  'settings.theme': el => actions.setThemePref(el.dataset.pref),
  'settings.style': el => actions.setStylePref(el.dataset.pref),
  'settings.orb': el => actions.setOrbPref(el.dataset.pref),
  'settings.devices': actions.openDeviceManager,
  'settings.logout': actions.confirmLogout,
  'settings.openDeactivate': actions.openDeactivateModal, // Z-11-F3: deactivate entry (bottom danger button -> reauth modal)
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
  if (!el) return;
  if (el.id === 'avatar-file') { actions.handleAvatarUpload(el); return; } // v1 onchange parity
  if (el.dataset && el.dataset.settingsPrivacy) actions.setPrivacyField(el.dataset.settingsPrivacy, el.checked ? 1 : 0);
}
function onLoad() {
  if (installed || typeof document === 'undefined') return () => {};
  installed = true;
  registerPage({ id: 'account-settings', roles: Object.values(ROLES), label: TEXT.PAGE_ACCOUNT_SETTINGS, desc: TEXT.PAGE_ACCOUNT_SETTINGS_DESC, auth: true, enter: () => actions.enterAccountSettings() });
  document.addEventListener('click', onActionClick);
  document.addEventListener('change', onChange);
  return () => { if (typeof document !== 'undefined') { document.removeEventListener('click', onActionClick); document.removeEventListener('change', onChange); } installed = false; };
}
export default { id: 'settings', text: TEXT, pages: [], actions: ACTION_MAP, onLoad };
export { actions, TEXT };
