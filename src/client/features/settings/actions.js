/**
 * settings feature actions: account settings, privacy, username, avatar, devices, deactivate.
 */
import { CONFIG } from '../../../shared/config.js';
import { TEXT } from '../../constants/text.js';
import { ROLES } from '../../../shared/enums.js'; // Z-16-F5: roles via shared enums
import { state, getThemePref, getUiScale, uiScaleFillPct, setUiScaleLive, commitUiScale, getOrbPref } from '../../core/state.js';
import { api } from '../../core/api.js';
import { dhGet, invalidate } from '../../core/datahub.js';
import { renderSidebar } from '../../core/router.js'; // Q-4b-M2：用户名/头像修改后刷新侧栏（state.user 同步）
import { openModal, closeModal, showToast, confirm, withCaptcha, btnLoading, btnDone, bindCountdown } from '../../core/ui.js';
import { setStylePref as applyStylePref, setThemePref as applyThemePref, setOrbPref as applyOrbPref, getStylePref } from '../../core/appearance.js';
import { escHtml, renderAvatarHtml, loaderHtml } from '../../core/dom.js';
import { renderDeviceRow, renderAvatarPreview } from './render.js';
import { handleLogout } from '../auth/actions.js';

export function enterAccountSettings() {
  const u = state.user;
  const content = document.getElementById('account-settings-content');
  if (content && u) {
    const themePref = getThemePref();
    const stylePref = getStylePref();
    const orbPref = getOrbPref();
    const uiScaleVal = getUiScale();
    const themeOpts = [['light', TEXT.THEME_LIGHT], ['dark', TEXT.THEME_DARK], ['system', TEXT.THEME_SYSTEM]].map(([k, label]) =>
      `<button type="button" class="theme-opt glass glass--pressable${themePref === k ? ' theme-opt--on' : ''}" data-pref="${k}" data-action="settings.theme">${label}</button>`).join('');
    const styleOpts = [['liquid', TEXT.STYLE_LIQUID], ['flat', TEXT.STYLE_FLAT]].map(([k, label]) =>
      `<button type="button" class="style-opt glass glass--pressable${stylePref === k ? ' style-opt--on' : ''}" data-pref="${k}" data-action="settings.style">${label}</button>`).join('');
    const orbOpts = [['vivid', TEXT.ORB_MODE_VIVID], ['elegant', TEXT.ORB_MODE_ELEGANT], ['hidden', TEXT.ORB_MODE_HIDDEN]].map(([k, label]) =>
      `<button type="button" class="orb-opt glass glass--pressable${orbPref === k ? ' orb-opt--on' : ''}" data-pref="${k}" data-action="settings.orb">${label}</button>`).join('');
    content.innerHTML = `
      <div class="settings-section-title">${TEXT.SETTINGS_ACCOUNT_TITLE}</div>
      <div class="settings-row settings-row--avatar">
        <div>
          <div class="settings-label">${TEXT.SETTINGS_AVATAR}</div>
          <label class="btn btn-outline btn-sm glass glass--pressable" for="avatar-file">${TEXT.BTN_UPLOAD_AVATAR}</label>
          <input type="file" id="avatar-file" accept="image/*" class="sr-file-input">
        </div>
        ${renderAvatarHtml(u.avatar, u.username, 'settings-avatar')}
      </div>
      <div class="settings-list">
        <div class="settings-row"><div><div class="settings-label">${TEXT.SETTINGS_USERNAME}</div><div class="settings-value">${escHtml(u.username)}</div></div><button type="button" class="btn btn-outline btn-sm glass glass--pressable" id="username-change-btn" data-action="settings.openUsernameChange">${TEXT.BTN_MODIFY}</button></div>
        <div class="settings-row"><div><div class="settings-label">${TEXT.SETTINGS_ROLE}</div><div class="settings-value">${escHtml(u.role)}</div></div></div>
        <div class="settings-row"><div><div class="settings-label">${TEXT.SETTINGS_PHONE}</div><div class="settings-value"><span id="settings-phone-val">${TEXT.SETTINGS_UNBOUND}</span></div></div><button type="button" class="btn btn-outline btn-sm glass glass--pressable" data-action="auth.openPhoneBind">${TEXT.BTN_MODIFY}</button></div>
        <div class="settings-row"><div><div class="settings-label">${TEXT.SETTINGS_EMAIL}</div><div class="settings-value"><span id="settings-email-val">${TEXT.SETTINGS_UNBOUND}</span></div></div><button type="button" class="btn btn-outline btn-sm glass glass--pressable" data-action="auth.openEmailBind">${TEXT.BTN_MODIFY}</button></div>
      </div>
      <div class="settings-section-title">${TEXT.SETTINGS_APPEARANCE_TITLE}</div>
      <div class="settings-list">
        <div class="settings-row"><div><div class="settings-label">${TEXT.SETTINGS_THEME_LABEL}</div><div class="settings-hint">${TEXT.SETTINGS_THEME_HINT}</div></div><div class="theme-opts">${themeOpts}</div></div>
        <div class="settings-row"><div><div class="settings-label">${TEXT.SETTINGS_STYLE_LABEL}</div><div class="settings-hint">${TEXT.SETTINGS_STYLE_HINT}</div></div><div class="style-opts">${styleOpts}</div></div>
        <div class="settings-row"><div><div class="settings-label">${TEXT.SETTINGS_ORB_LABEL}</div><div class="settings-hint">${TEXT.SETTINGS_ORB_HINT}${stylePref === 'flat' ? TEXT.SETTINGS_ORB_FLAT_HIDDEN : ''}</div></div><div class="orb-opts">${orbOpts}</div></div>
        <div class="settings-row ui-scale-row">
          <div><div class="settings-label">${TEXT.SETTINGS_UI_SCALE_LABEL}</div><div class="settings-hint">${TEXT.SETTINGS_UI_SCALE_HINT.replace('{min}', String(CONFIG.UI_SCALE_MIN)).replace('{max}', String(CONFIG.UI_SCALE_MAX)).replace('{def}', String(CONFIG.UI_SCALE_DEFAULT))}</div></div>
          <div class="ui-scale-control">
            <input type="range" class="ui-scale-slider" id="ui-scale-slider" min="${CONFIG.UI_SCALE_MIN}" max="${CONFIG.UI_SCALE_MAX}" step="${CONFIG.UI_SCALE_STEP}" value="${uiScaleVal}" aria-label="${TEXT.SETTINGS_UI_SCALE_LABEL}">
            <span class="ui-scale-val" id="ui-scale-val">${uiScaleVal}%</span>
          </div>
        </div>
      </div>
      <div class="settings-section-title">${TEXT.SETTINGS_PRIVACY_TITLE}</div>
      <div class="settings-list"><div id="privacy-settings-list"><div class="empty-state empty-state--small"><p>${loaderHtml('sm')}</p></div></div></div>
      <div class="settings-bottom-actions">
        <button type="button" class="btn btn-outline settings-devices-btn glass glass--pressable" data-action="settings.devices">${TEXT.SETTINGS_DEVICES}</button>
        <button type="button" class="btn settings-logout glass glass--pressable" data-action="settings.logout">${TEXT.BTN_LOGOUT}</button>
        ${u.role !== ROLES.ADMIN ? `<button type="button" class="btn btn-danger settings-deactivate-btn glass glass--pressable" data-action="settings.openDeactivate">${TEXT.SETTINGS_DEACTIVATE_TITLE}</button>` : ''}
      </div>`;
    bindUiScaleSlider();
  }
  loadUsernameStatus();
  loadMyCreds();
  loadPrivacySettings();
}

// getStylePref re-exported from core/appearance.js (single source; local duplicate removed)
export { getStylePref };

export async function loadUsernameStatus() {
  // v1 parity (app-pages.js): username 7-day cooldown shows on the modify button —
  // dhGet through the account domain (session cache, invalidate('account') refetches)
  const btn = document.getElementById('username-change-btn');
  if (!btn) return;
  try {
    const d = await dhGet('/api/user/username/status', { domain: 'account' });
    if (!document.getElementById('username-change-btn')) return; // left the page
    // defensive: canChange true or an invalid/absent cooldownMs → keep the button
    // enabled without a countdown (mock/abnormal responses must not brick it)
    if (d.canChange === true || !isFinite(Number(d.cooldownMs)) || Number(d.cooldownMs) <= 0) return;
    bindCountdown(btn, { endAt: Date.now() + Number(d.cooldownMs), runningText: TEXT.USERNAME_COOLDOWN_BTN, onDone: () => { btn.textContent = TEXT.BTN_MODIFY; } });
  } catch { /* network blip: button stays enabled, server enforces the cooldown */ }
}

export async function loadMyCreds() {
  // v1 parity (app-pages.js): write each span's textContent separately — writing
  // the parent would destroy the spans the OTP-bind flow writes into afterwards
  const phoneEl = document.getElementById('settings-phone-val');
  const emailEl = document.getElementById('settings-email-val');
  if (!phoneEl && !emailEl) return;
  try {
    const d = await dhGet('/api/user/creds', { domain: 'account' });
    if (!document.getElementById('settings-phone-val') && !document.getElementById('settings-email-val')) return; // left the page
    if (phoneEl) phoneEl.textContent = d.phone || TEXT.SETTINGS_UNBOUND;
    if (emailEl) emailEl.textContent = d.email || TEXT.SETTINGS_UNBOUND;
  } catch { /* network blip: keep the placeholder */ }
}

export async function loadPrivacySettings() {
  try {
    const data = await dhGet('/api/privacy-settings', { domain: 'account' });
    const el = document.getElementById('privacy-settings') || document.getElementById('privacy-settings-list');
    if (el) {
      const role = state.user && state.user.role;
      const profileHtml = role === ROLES.TEACHER ? `<label class="checkbox-item"><input type="checkbox" data-settings-privacy="allowGuestProfile"${data.allowGuestProfile ? ' checked' : ''}>${TEXT.SETTINGS_PRIVACY_PROFILE_LABEL}</label>` : '';
      const demandHtml = role === ROLES.STUDENT ? `<label class="checkbox-item"><input type="checkbox" data-settings-privacy="allowGuestDemand"${data.allowGuestDemand ? ' checked' : ''}>${TEXT.SETTINGS_PRIVACY_DEMAND_LABEL}</label>` : '';
      el.innerHTML = profileHtml + demandHtml;
    }
  } catch { /* silent */ }
}

export async function setPrivacyField(key, value) {
  try {
    await api('/api/privacy-settings', { method: 'POST', body: { [key]: value ? 1 : 0 } });
    invalidate('account'); // Q-3b-F4: /api/privacy-settings caches under domain 'account' and the server never bumps it; without invalidate the toggle reverts to the old value after leaving/re-entering settings (the 60s TTL is also masked by dhTouchAll -> stale forever)
    showToast(TEXT.SETTINGS_SAVED);
  } catch (err) { showToast(err.message); }
}

export function openUsernameChangeModal() {
  openModal({ title: TEXT.SETTINGS_USERNAME_TITLE, body: `<div class="form-group"><label>${TEXT.LABEL_NEW_USERNAME}</label><input id="new-username" class="form-input"></div>`, footer: `<button type="button" class="btn btn-outline glass glass--pressable" data-action="settings.closeModal">${TEXT.BTN_CANCEL}</button><button type="button" class="btn glass glass--pressable" data-action="settings.submitUsername">${TEXT.BTN_SAVE}</button>` });
}

export async function submitUsername() {
  const username = document.getElementById('new-username')?.value.trim();
  if (!username) return;
  try {
    confirm({ title: TEXT.SETTINGS_USERNAME_TITLE, message: TEXT.SETTINGS_USERNAME_CONFIRM, needReAuth: true, onConfirm: async capToken => {
      withCaptcha(async () => {
        await api('/api/user/username', { method: 'POST', body: { newUsername: username, capToken } });
        closeModal(); showToast(TEXT.SETTINGS_USERNAME_CHANGED); invalidate('account'); loadUsernameStatus();
        if (state.user) { state.user.username = username; renderSidebar(); } // Q-4b-M2：改用户名后同步 state.user + 侧栏（原陈旧到下次登录）
      });
    }});
  } catch (err) { showToast(err.message); }
}

export function openDeviceManager() {
  api('/api/auth/sessions', { method: 'GET' }).then(data => {
    openModal({ title: TEXT.SETTINGS_DEVICES_TITLE, body: `<div id="device-list">${(data.sessions || []).map(renderDeviceRow).join('')}</div>`, footer: `<button type="button" class="btn btn-outline glass glass--pressable" data-action="settings.closeModal">${TEXT.BTN_CLOSE}</button>` });
  }).catch(err => showToast(err.message));
}

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
    try { await api('/api/user/deactivate', { method: 'POST', body: { capToken } }); showToast(TEXT.SETTINGS_DEACTIVATED); handleLogout(); } catch (err) { showToast(err.message); } // Q-4b-M1：注销成功后登出——服务端已置 deactivated 拒令牌，本地须清态回 landing（否则停留已登录陈旧 UI，下次 API 才 401）
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
    if (state.user) { state.user.avatar = window._avatarDataUrl; renderSidebar(); } // Q-4b-M2：改头像后同步 state.user + 侧栏（原陈旧到下次登录）
  } catch (err) { showToast(err.message); }
}

export function setThemePref(pref) { return applyThemePref(pref); }
export function setStylePref(pref) { return applyStylePref(pref); }
export function setOrbPref(pref) { return applyOrbPref(pref); }

export function setUiScaleFromSlider(el) {
  if (!el) return;
  const v = setUiScaleLive(+el.value);
  const valEl = document.getElementById('ui-scale-val');
  if (valEl) valEl.textContent = v + '%';
  el.style.setProperty('--ui-fill', uiScaleFillPct(v) + '%');
}
export function commitUiScaleFromSlider(el) {
  if (!el) return;
  const v = commitUiScale(+el.value);
  const valEl = document.getElementById('ui-scale-val');
  if (valEl) valEl.textContent = v + '%';
  el.style.setProperty('--ui-fill', uiScaleFillPct(v) + '%');
}
export function bindUiScaleSlider() {
  const slider = document.getElementById('ui-scale-slider');
  if (!slider || slider.dataset.pointerBound) return;
  slider.dataset.pointerBound = '1';
  // fill % via CSS variable (template has zero inline style attribute; init = current value)
  slider.style.setProperty('--ui-fill', uiScaleFillPct(getUiScale()) + '%');
  const span = CONFIG.UI_SCALE_MAX - CONFIG.UI_SCALE_MIN;
  let drag = null;
  const refreshLabel = (el, c) => {
    el.value = c;
    el.style.setProperty('--ui-fill', uiScaleFillPct(c) + '%');
    const valEl = document.getElementById('ui-scale-val');
    if (valEl) valEl.textContent = c + '%';
  };
  slider.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    drag = { startX: e.clientX, startVal: +slider.value, trackW: slider.clientWidth || 1 };
    try { slider.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    e.preventDefault();
  });
  slider.addEventListener('pointermove', e => {
    if (!drag) return;
    const raw = drag.startVal + ((e.clientX - drag.startX) / drag.trackW) * span;
    refreshLabel(slider, setUiScaleLive(raw));
  });
  const endDrag = e => {
    if (!drag) return;
    const c = commitUiScale(+slider.value);
    refreshLabel(slider, c);
    if (slider.hasPointerCapture && slider.hasPointerCapture(e.pointerId)) slider.releasePointerCapture(e.pointerId);
    drag = null;
  };
  slider.addEventListener('pointerup', endDrag);
  slider.addEventListener('pointercancel', endDrag);
  slider.addEventListener('input', () => setUiScaleFromSlider(slider));
  slider.addEventListener('change', () => commitUiScaleFromSlider(slider));
  if (typeof window !== 'undefined') {
    window.addEventListener('sufe:ui-scale', () => {
      const synced = getUiScale();
      if (drag) drag.startVal = synced;
      refreshLabel(slider, synced);
    });
  }
}
// Dormant (B5 pending): v1 app-pages.js:442-460 implemented the CHSI screenshot
// upload control (render control / pick file / view image). v2 migration not yet
// landed — these stubs keep the interface slots for that feature.
export function renderProfileCredentialCtl() {}
export function handleCredentialPicked() {}
export function viewProfileCredential() {}

export function confirmLogout() {
  confirm({
    message: TEXT.CONFIRM_LOGOUT,
    okText: TEXT.BTN_LOGOUT,
    onConfirm: () => handleLogout(),
  });
}

export function closeModalAction() { closeModal(); }
