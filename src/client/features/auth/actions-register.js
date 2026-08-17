/**
 * auth feature register actions: student single form, teacher 3-step wizard
 * (invite -> account -> contact verification), submit and validation.
 */
import { CONFIG, INVITE_GATE_DORMANT } from '../../../shared/config.js';
import { TEXT } from './text.js';
import { state, saveSession, getDeviceId } from '../../core/state.js';
import { api } from '../../core/api.js';
import { showToast, btnLoading, btnDone, withCaptcha } from '../../core/ui.js';
import { studentRegisterFormHtml, teacherWizardHtml } from './render.js';
import { classifyIdentifier } from './actions-otp.js';
import { afterAuthSuccess } from './flow.js';

let _regStep = 0;
let studentGroupTemplate = null;

const $ = id => typeof document !== 'undefined' ? document.getElementById(id) : null;

export function switchRegisterRole(role) {
  const roleEl = $('register-role');
  if (roleEl) roleEl.value = role;
  document.querySelectorAll('#register-role-tabs .seg-tab').forEach(t => t.classList.toggle('active', t.dataset.role === role));
  const studentGroup = $('student-reg-group');
  const wizardRoot = $('teacher-wizard-root');
  if (!studentGroup || !wizardRoot) return;
  if (role === 'teacher') {
    if (!studentGroupTemplate) studentGroupTemplate = studentGroup.innerHTML;
    studentGroup.innerHTML = '';
    renderTeacherWizard();
  } else {
    studentGroup.innerHTML = studentGroupTemplate || studentRegisterFormHtml();
    wizardRoot.classList.add('hidden');
    wizardRoot.innerHTML = '';
  }
}

export function renderTeacherWizard() {
  const root = $('teacher-wizard-root');
  if (!root) return;
  _regStep = 0;
  state.validatedInviteCode = null;
  root.classList.remove('hidden');
  root.innerHTML = teacherWizardHtml();
  regWizardGoTo(0);
}

export function regWizardGoTo(idx) {
  _regStep = idx;
  if (typeof document === 'undefined') return;
  const track = $('reg-w-track');
  if (track) track.style.setProperty('--dw-step-active', String(idx));
  document.querySelectorAll('#reg-w-track .dw-step').forEach(el =>
    el.classList.toggle('dw-step--active', +el.dataset.step === idx + 1));
  document.querySelectorAll('#reg-w-stepper .dw-step-chip').forEach((c, i) => {
    c.classList.toggle('active', i === idx);
    c.classList.toggle('done', i < idx);
  });
}

export async function regWizardNext() {
  if (_regStep === 0) {
    const code = (($('reg-invite-code') || {}).value || '').trim();
    if (!code) { showToast(TEXT.VALIDATE_INVITE_REQUIRED, 'error'); return; }
    const btn = $('reg-step1-next');
    btnLoading(btn, TEXT.LOADING_VERIFY);
    try {
      const r = await api('/api/auth/check-invite', { method: 'POST', body: { code } });
      if (r && r.ok) {
        state.validatedInviteCode = code;
        showToast(TEXT.SUCCESS_INVITE_CONFIRMED, 'success');
        regWizardGoTo(1);
      }
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btnDone(btn, TEXT.BTN_NEXT_STEP);
    }
    return;
  }
  if (_regStep === 1) {
    const username = $('register-username').value.trim();
    const password = $('register-password').value;
    const password2 = $('register-password2').value;
    const ident = (($('register-identifier') || {}).value || '').trim();
    if (!username || username.length < CONFIG.USERNAME_MIN || username.length > CONFIG.USERNAME_MAX) {
      showToast(TEXT.USERNAME_LENGTH_ERR, 'error'); return;
    }
    if (password.length < 6) { showToast(TEXT.VALIDATE_PASSWORD, 'error'); return; }
    if (password !== password2) { showToast(TEXT.VALIDATE_PASSWORD_MISMATCH, 'error'); return; }
    const kind = classifyIdentifier(ident);
    if (kind !== 'phone' && kind !== 'email') { showToast(TEXT.CRED_IDENT_INVALID, 'error'); return; }
    regWizardGoTo(2);
  }
}

export function regWizardBack() { if (_regStep > 0) regWizardGoTo(_regStep - 1); }

export function handleRegister(e) {
  if (e && e.preventDefault) e.preventDefault();
  const username = $('register-username').value.trim();
  const password = $('register-password').value;
  const password2 = $('register-password2').value;
  const role = $('register-role').value;

  if (password !== password2) {
    showToast(TEXT.VALIDATE_PASSWORD_MISMATCH, 'error');
    return;
  }
  const agreeAgreement = $('agree-agreement') && $('agree-agreement').checked;
  const agreePrivacy = $('agree-privacy') && $('agree-privacy').checked;
  if (!agreeAgreement || !agreePrivacy) {
    showToast(TEXT.AGREE_REQUIRED, 'error');
    return;
  }
  if (role === 'teacher' && !INVITE_GATE_DORMANT && !state.validatedInviteCode) {
    showToast(TEXT.VALIDATE_INVITE_FIRST, 'error');
    regWizardGoTo(0);
    return;
  }
  const ident = (($('register-identifier') || {}).value || '').trim();
  const code = (($('register-code') || {}).value || '').trim();
  const kind = classifyIdentifier(ident);
  if (!ident || !code) {
    showToast(TEXT.REGISTER_CONTACT_REQUIRED, 'error');
    return;
  }
  if (kind !== 'phone' && kind !== 'email') {
    showToast(TEXT.CRED_IDENT_INVALID, 'error');
    return;
  }
  withCaptcha(() => doRegister(username, password, role, agreeAgreement, agreePrivacy, { ident, code, kind }));
}

export async function doRegister(username, password, role, agreeAgreement, agreePrivacy, contact) {
  try {
    const btn = $('register-submit');
    btnLoading(btn, TEXT.LOADING_REGISTER);
    const body = { username, password, role, deviceId: getDeviceId(), agreeAgreement, agreePrivacy };
    if (role === 'teacher' && state.validatedInviteCode) body.inviteCode = state.validatedInviteCode;
    if (contact.kind === 'phone') {
      body.phone = contact.ident.startsWith('+') ? contact.ident : '+86' + contact.ident;
      body.code = contact.code;
      body.otpChannel = 'sms';
    } else {
      body.email = contact.ident;
      body.code = contact.code;
      body.otpChannel = 'email';
    }
    const data = await api('/api/auth/register', { method: 'POST', body });
    state.user = data.user;
    state.authToken = data.authToken || null;
    if (role === 'teacher') state.validatedInviteCode = null;
    saveSession(false);
    afterAuthSuccess(true).catch(err => console.warn('afterAuthSuccess', err));
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    const btn = $('register-submit');
    btnDone(btn, TEXT.BTN_REGISTER);
  }
}
