/**
 * auth feature OTP actions: identifier classification, request-code channel
 * inference, register contact reveal, phone/email bind modals and submits.
 * Network access goes exclusively through core api().
 */
import { CONFIG } from '../../../shared/config.js';
import { TEXT } from '../../constants/text.js';
import { invalidate } from '../../core/state.js';
import { api } from '../../core/api.js';
import { showToast, btnLoading, btnDone, bindCountdown, withCaptcha, openModal, closeModal } from '../../core/ui.js';
import { phoneFieldHtml, emailFieldHtml, codeFieldHtml, bindModalFooter } from './render.js';

const _otpCountdownStops = {};

export function validatePhone(target) {
  const s = String(target || '').trim();
  return CONFIG.PHONE_REGIONS.some(r => s.startsWith(r.prefix) && r.pattern.test(s.slice(r.prefix.length)));
}

export function validateEmail(s) {
  return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(String(s || '').trim());
}

export function classifyIdentifier(identifier) {
  const s = String(identifier || '').trim();
  if (!s) return null;
  if (s.includes('@')) return 'email';
  if (validatePhone(s)) return 'phone';
  const cn = CONFIG.PHONE_REGIONS.find(r => r.prefix === '+86');
  if (cn && cn.pattern.test(s)) return 'phone';
  return 'username';
}

function normalizePhone(ident) {
  return ident.startsWith('+') ? ident : '+86' + ident;
}

export function otpExhaustedReset(prefix) {
  const stop = _otpCountdownStops[prefix];
  if (typeof stop === 'function') { stop(); delete _otpCountdownStops[prefix]; }
  const btn = typeof document !== 'undefined' ? document.getElementById(`${prefix}-send`) : null;
  if (btn) { btn.disabled = false; btn.textContent = TEXT.CODE_SEND; }
}

export async function requestOtpCode(prefix, channel) {
  if (typeof document === 'undefined') return;
  const sendBtn = document.getElementById(`${prefix}-send`);
  const codeEl = document.getElementById(`${prefix}-code`);
  if (!sendBtn || sendBtn.disabled) return;
  let target = '';
  if (prefix === 'login' || prefix === 'register') {
    const ident = ((document.getElementById(`${prefix}-identifier`) || {}).value || '').trim();
    const kind = classifyIdentifier(ident);
    if (kind === 'email') { channel = 'email'; target = ident; }
    else if (kind === 'phone') { channel = 'sms'; target = normalizePhone(ident); }
    else { showToast(TEXT.CRED_IDENT_INVALID, 'error'); return; }
  } else if (channel === 'email') {
    const el = document.getElementById(`${prefix}-email`);
    target = el ? el.value.trim() : '';
  } else {
    const el = document.getElementById(`${prefix}-phone`);
    target = '+86' + (el ? el.value.trim() : '');
  }
  if (!target) { showToast(channel === 'email' ? TEXT.EMAIL_PLACEHOLDER : TEXT.PHONE_PLACEHOLDER, 'error'); return; }
  const valid = channel === 'email' ? validateEmail(target) : validatePhone(target);
  if (!valid) {
    showToast(channel === 'email' ? TEXT.CRED_FORMAT_EMAIL : TEXT.CRED_FORMAT_PHONE, 'error');
    return;
  }
  sendBtn.disabled = true;
  try {
    await api('/api/auth/otp/request', {
      method: 'POST',
      body: {
        channel: channel === 'email' ? 'email' : 'sms',
        target,
        scene: prefix === 'bind' ? TEXT.OTP_SCENE_BIND : prefix === 'register' ? TEXT.OTP_SCENE_REGISTER : TEXT.OTP_SCENE_LOGIN,
      },
    });
    showToast(TEXT.CODE_SENT, 'success');
    if (codeEl && typeof codeEl.focus === 'function') codeEl.focus();
    _otpCountdownStops[prefix] = bindCountdown(sendBtn, { endAt: Date.now() + CONFIG.OTP_RESEND_SEC * 1000, runningText: TEXT.CODE_SEND_AGAIN });
  } catch (err) {
    sendBtn.disabled = false;
    showToast(err.message, 'error');
  }
}

export function checkRegisterContact() {
  if (typeof document === 'undefined') return;
  const el = document.getElementById('register-identifier');
  const group = document.getElementById('register-code-group');
  const label = document.getElementById('register-code-label');
  if (!group || !label) return;
  const kind = classifyIdentifier(el ? el.value : '');
  if (kind === 'phone' || kind === 'email') {
    group.classList.remove('hidden');
    label.textContent = kind === 'phone' ? TEXT.OTP_PHONE_LABEL : TEXT.OTP_EMAIL_LABEL;
  } else {
    group.classList.add('hidden');
  }
}

export function openPhoneBindModal() {
  openModal({
    title: TEXT.BIND_PHONE_TITLE,
    cls: 'modal--bind',
    body: phoneFieldHtml({ prefix: 'bind' }) + codeFieldHtml({ prefix: 'bind', channel: 'sms' }),
    footer: bindModalFooter('phone'),
  });
}

export function openEmailBindModal() {
  openModal({
    title: TEXT.BIND_EMAIL_TITLE,
    cls: 'modal--bind',
    body: emailFieldHtml({ prefix: 'bind' }) + codeFieldHtml({ prefix: 'bind', channel: 'email' }),
    footer: bindModalFooter('email'),
  });
}

export function submitBind(kind) {
  const isPhone = kind === 'phone';
  let target = '';
  if (isPhone) {
    const el = typeof document !== 'undefined' ? document.getElementById('bind-phone') : null;
    target = '+86' + (el ? el.value.trim() : '');
    if (!validatePhone(target)) { showToast(TEXT.CRED_FORMAT_PHONE, 'error'); return; }
  } else {
    const el = typeof document !== 'undefined' ? document.getElementById('bind-email') : null;
    target = el ? el.value.trim() : '';
    if (!validateEmail(target)) { showToast(TEXT.CRED_FORMAT_EMAIL, 'error'); return; }
  }
  const code = typeof document !== 'undefined' ? document.getElementById('bind-code') : null;
  if (!code || !code.value.trim()) { showToast(TEXT.CODE_PLACEHOLDER, 'error'); return; }
  withCaptcha(() => doBind(kind, isPhone, target, code.value.trim()));
}

export async function doBind(kind, isPhone, target, code) {
  try {
    const btn = typeof document !== 'undefined'
      ? document.querySelector('#modal-container .modal-footer .btn:not(.btn-outline)') : null;
    btnLoading(btn, TEXT.BTN_BIND);
    const r = await api(`/api/auth/${isPhone ? 'phone' : 'email'}/bind`, {
      method: 'POST',
      body: isPhone ? { phone: target, code } : { email: target, code },
    });
    showToast(r.message || TEXT.OTP_BIND_DONE, 'success');
    closeModal();
    const mask = isPhone ? (r.phone || '') : (r.email || '');
    if (mask && typeof document !== 'undefined') {
      const el = document.getElementById(isPhone ? 'settings-phone-val' : 'settings-email-val');
      if (el) el.textContent = mask;
    }
    invalidate('account');
    // No extra refresh needed here: the bound value was already written to
    // #settings-phone-val / #settings-email-val above, and those spans stay alive
    // because loadMyCreds (settings feature) writes their textContent separately
    // instead of replacing their parent (v1 parity). invalidate('account') also
    // drops the dhGet cache entry so the next settings load refetches creds.
  } catch (err) {
    if (err && err.code === 'OTP_EXHAUSTED') otpExhaustedReset('bind');
    showToast(err.message, 'error');
  }
}
