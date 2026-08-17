/**
 * settings feature actions: account settings, privacy, username, avatar, devices, deactivate.
 */
import { TEXT } from './text.js';
import { state } from '../../core/state.js';
import { api } from '../../core/api.js';
import { dhGet, invalidate } from '../../core/datahub.js';
import { openModal, closeModal, showToast, confirm, withCaptcha, btnLoading, btnDone } from '../../core/ui.js';
import { escHtml } from '../../core/dom.js';
import { renderDeviceRow, renderAvatarPreview } from './render.js';

export function enterAccountSettings() {
  loadUsernameStatus();
  loadMyCreds();
  loadPrivacySettings();
}

export async function loadUsernameStatus() {
  try {
    const data = await api('/api/user/username/status', { method: 'GET' });
    const el = document.getElementById('username-status');
    if (el) el.textContent = data.status || '';
  } catch { /* silent */ }
}

export async function loadMyCreds() {
  try {
    const data = await api('/api/user/creds', { method: 'GET' });
    const el = document.getElementById('my-creds') || document.getElementById('settings-phone-val')?.parentElement || null;
    if (el) el.textContent = [data.phone, data.email].filter(Boolean).join(' / ');
  } catch { /* silent */ }
}

export async function loadPrivacySettings() {
  try {
    const data = await dhGet('/api/privacy-settings', { domain: 'account' });
    const el = document.getElementById('privacy-settings') || document.getElementById('privacy-settings-list');
    if (el) {
      const role = state.user && state.user.role;
      const profileHtml = role === 'teacher' ? `<label class="checkbox-item"><input type="checkbox" data-settings-privacy="allowGuestProfile"${data.allowGuestProfile ? ' checked' : ''}>${TEXT.SETTINGS_PRIVACY_PROFILE_LABEL}</label>` : '';
      const demandHtml = role === 'student' ? `<label class="checkbox-item"><input type="checkbox" data-settings-privacy="allowGuestDemand"${data.allowGuestDemand ? ' checked' : ''}>${TEXT.SETTINGS_PRIVACY_DEMAND_LABEL}</label>` : '';
      el.innerHTML = profileHtml + demandHtml;
    }
  } catch { /* silent */ }
}

export async function setPrivacyField(key, value) {
  try {
    await api('/api/privacy-settings', { method: 'POST', body: { [key]: value ? 1 : 0 } });
    showToast(TEXT.SETTINGS_SAVED);
  } catch (err) { showToast(err.message); }
}

export function openUsernameChangeModal() {
  openModal({ title: TEXT.SETTINGS_USERNAME_TITLE, body: `<div class="form-group"><label>${TEXT.LABEL_NEW_USERNAME}</label><input id="new-username" class="form-input"></div>`, footer: `<button type="button" class="btn btn-outline glass glass--pressable" data-action="settings.closeModal">${TEXT.BTN_CANCEL}</button><button type="button" class="btn glass glass--pressable" data-action="settings.submitUsername">${TEXT.BTN_SAVE}</button>` });
}

export function confirmUsernameChange() { /* alias for submitUsername */ }
export async function submitUsernameChange() { return submitUsername(); }

export async function submitUsername() {
  const username = document.getElementById('new-username')?.value.trim();
  if (!username) return;
  try {
    confirm({ title: TEXT.SETTINGS_USERNAME_TITLE, message: TEXT.SETTINGS_USERNAME_CONFIRM, needReAuth: true, onConfirm: async capToken => {
      withCaptcha(async () => {
        await api('/api/user/username', { method: 'POST', body: { newUsername: username, capToken } });
        closeModal(); showToast(TEXT.SETTINGS_USERNAME_CHANGED); invalidate('account'); loadUsernameStatus();
      });
    }});
  } catch (err) { showToast(err.message); }
}

export function openDeviceManager() {
  api('/api/auth/sessions', { method: 'GET' }).then(data => {
    openModal({ title: TEXT.SETTINGS_DEVICES_TITLE, body: `<div id="device-list">${(data.sessions || []).map(renderDeviceRow).join('')}</div>`, footer: `<button type="button" class="btn btn-outline glass glass--pressable" data-action="settings.closeModal">${TEXT.BTN_CLOSE}</button>` });
  }).catch(err => showToast(err.message));
}

export function renderDeviceList() { /* handled in openDeviceManager */ }

export async function revokeDeviceSession(sessionId) {
  confirm({ title: TEXT.SETTINGS_DEVICES_TITLE, message: TEXT.SETTINGS_DEVICE_REVOKE_CONFIRM, onConfirm: async () => {
    try {
      await api('/api/auth/sessions/revoke', { method: 'POST', body: { sessionId } });
      showToast(TEXT.SETTINGS_DEVICE_REVOKED); openDeviceManager();
    } catch (err) { showToast(err.message); }
  }});
}

export function openDeactivateModal() {
  openModal({ title: TEXT.SETTINGS_DEACTIVATE_TITLE, body: `<p class="danger-warn">${TEXT.SETTINGS_DEACTIVATE_WARN}</p>`, footer: `<button type="button" class="btn btn-outline glass glass--pressable" data-action="settings.closeModal">${TEXT.BTN_CANCEL}</button><button type="button" class="btn btn-danger glass glass--pressable" data-action="settings.deactivate">${TEXT.BTN_CONTINUE}</button>` });
}

export function confirmDeactivateAccount() {
  confirm({ title: TEXT.SETTINGS_DEACTIVATE_TITLE, message: TEXT.SETTINGS_DEACTIVATE_CONFIRM, needReAuth: true, onConfirm: async capToken => {
    try { await api('/api/user/deactivate', { method: 'POST', body: { capToken } }); showToast(TEXT.SETTINGS_DEACTIVATED); } catch (err) { showToast(err.message); }
  }});
}

export function handleAvatarUpload(input) {
  const file = input && input.files && input.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { showToast(TEXT.SETTINGS_AVATAR_INVALID, 'error'); return; }
  const reader = new FileReader();
  reader.onload = () => {
    openModal({ title: TEXT.SETTINGS_AVATAR_TITLE, body: renderAvatarPreview(reader.result), footer: `<button type="button" class="btn btn-outline glass glass--pressable" data-action="settings.closeModal">${TEXT.BTN_CANCEL}</button><button type="button" class="btn glass glass--pressable" data-action="settings.saveAvatar">${TEXT.BTN_SAVE}</button>` });
    window._avatarDataUrl = reader.result;
  };
  reader.readAsDataURL(file);
}

export async function saveAvatar() {
  try {
    await api('/api/user/avatar', { method: 'POST', body: { avatar: window._avatarDataUrl } });
    closeModal(); showToast(TEXT.SETTINGS_AVATAR_SAVED); invalidate('account');
  } catch (err) { showToast(err.message); }
}

export function setThemePref() {}
export function setOrbPref() {}
export function setUiScaleFromSlider() {}
export function commitUiScaleFromSlider() {}
export function bindUiScaleSlider() {}
export function renderProfileCredentialCtl() {}
export function handleCredentialPicked() {}
export function viewProfileCredential() {}
export function confirmLogout() {}

export function closeModalAction() { closeModal(); }
