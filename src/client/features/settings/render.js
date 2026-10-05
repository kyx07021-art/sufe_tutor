/**
 * settings feature renderers.
 */
import { escHtml } from '../../core/dom.js';
import { TEXT } from '../../constants/text.js';
export function renderDeviceRow(s) {
  return `<div class="list-card glass device-row"><span>${escHtml(s.label || '')}</span><button type="button" class="btn btn-sm btn-outline glass glass--pressable" data-action="settings.revokeDevice" data-id="${escHtml(s.session_id)}">${TEXT.BTN_REVOKE}</button></div>`;
}
export function renderAvatarPreview(dataUrl) {
  return `<div class="avatar-preview"><img src="${escHtml(dataUrl)}" alt="avatar"></div>`;
}
