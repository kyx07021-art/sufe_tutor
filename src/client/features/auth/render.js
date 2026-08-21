/**
 * auth feature renderer: login view, register view (student single form +
 * teacher 3-step wizard) and OTP field primitives. Templates carry data-action
 * keys only; root delegation in index.js resolves them (no inline handlers).
 */
import { CONFIG } from '../../../shared/config.js';
import { escHtml } from '../../core/dom.js';
import { TEXT } from '../../constants/text.js';
import { ROLES } from '../../../shared/enums.js';

export function loginViewHtml() {
  return `<div class="auth-view hidden" id="view-login">
  <div class="auth-card glass">
    <div class="auth-header">
      <h2 id="login-title">${escHtml(TEXT.AUTH_LOGIN_TITLE)}</h2>
      <p id="login-subtitle">${escHtml(TEXT.AUTH_LOGIN_SUB)}</p>
    </div>
    <form data-submit="auth.handleLogin">
      <div class="form-group">
        <label class="form-label">${escHtml(TEXT.LOGIN_IDENTIFIER_LABEL)}</label>
        <input type="text" class="form-input" id="login-identifier" placeholder="${escHtml(TEXT.LOGIN_IDENTIFIER_PLACEHOLDER)}"
          required autocomplete="username" data-input-action="auth.checkLoginUsername">
        <div class="login-username-hint" id="login-username-hint" aria-live="polite"></div>
      </div>
      <div id="login-password-group" class="hidden">
        <div class="form-group">
          <label class="form-label">${escHtml(TEXT.LOGIN_PASSWORD_LABEL)}</label>
          <input type="password" class="form-input" id="login-password" placeholder="${escHtml(TEXT.LOGIN_PASSWORD_REQUIRED)}"
            required autocomplete="current-password">
        </div>
        <label class="remember-me">
          <input type="checkbox" id="login-remember">
          <span>${escHtml(TEXT.LOGIN_REMEMBER)}</span>
        </label>
      </div>
      <div id="login-code-group" class="hidden">
        <div class="form-group">
          <label class="form-label">${escHtml(TEXT.CODE_LABEL)}</label>
          <div class="code-input-wrap">
            <input type="text" class="form-input" id="login-code" placeholder="${escHtml(TEXT.CODE_PLACEHOLDER)}"
              inputmode="numeric" autocomplete="one-time-code" maxlength="6">
            <button type="button" class="btn btn-sm code-send-btn glass glass--pressable" id="login-send"
              data-action="auth.sendCode" data-prefix="login" data-channel="auto">${escHtml(TEXT.CODE_SEND)}</button>
          </div>
          <p class="form-hint">${escHtml(TEXT.LOGIN_CODE_HINT)}</p>
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline glass glass--pressable" data-action="auth.back">${escHtml(TEXT.BTN_BACK)}</button>
        <button type="submit" class="btn glass glass--pressable" id="login-submit" data-action="auth.handleLogin">${escHtml(TEXT.BTN_LOGIN)}</button>
      </div>
    </form>
    <div class="auth-footer auth-footer--split">
      <a href="#" id="login-switch-mode" data-action="auth.toggleLoginMode">${escHtml(TEXT.LOGIN_SWITCH_CODE)}</a>
      <span class="sep">·</span>
      <a href="#" data-action="auth.viewRegister">${escHtml(TEXT.BTN_GO_REGISTER)}</a>
    </div>
  </div>
</div>`;
}

export function studentRegisterFormHtml() {
  return `<div class="form-group">
    <label class="form-label">${escHtml(TEXT.REG_USERNAME_LABEL)} <span class="req">*</span></label>
    <input type="text" class="form-input" id="register-username" placeholder="${escHtml(TEXT.REG_USERNAME_PLACEHOLDER)}" required>
  </div>
  <div class="form-group">
    <label class="form-label">${escHtml(TEXT.REG_PASSWORD_LABEL)} <span class="req">*</span></label>
    <input type="password" class="form-input" id="register-password" placeholder="${escHtml(TEXT.REG_PASSWORD_PLACEHOLDER)}" required>
  </div>
  <div class="form-group">
    <label class="form-label">${escHtml(TEXT.REG_PASSWORD2_LABEL)} <span class="req">*</span></label>
    <input type="password" class="form-input" id="register-password2" placeholder="${escHtml(TEXT.REG_PASSWORD2_PLACEHOLDER)}" required>
  </div>
  <div class="form-group">
    <label class="form-label">${escHtml(TEXT.REG_CONTACT_LABEL)} <span class="req">*</span></label>
    <input type="text" class="form-input" id="register-identifier" placeholder="${escHtml(TEXT.REG_CONTACT_PLACEHOLDER)}"
      autocomplete="email" data-input-action="auth.checkRegisterContact">
    <p class="form-hint">${escHtml(TEXT.REG_CONTACT_HINT)}</p>
  </div>
  <div id="register-code-group" class="hidden">
    ${codeFieldHtml({ prefix: 'register', channel: 'auto' })}
  </div>
  ${agreeRowsHtml()}
  <div class="form-actions">
    <button type="button" class="btn btn-outline glass glass--pressable" data-action="auth.backLanding">${escHtml(TEXT.BTN_BACK_LANDING)}</button>
    <button type="submit" class="btn glass glass--pressable" id="register-submit" data-action="auth.handleRegister">${escHtml(TEXT.BTN_REGISTER)}</button>
  </div>`;
}

export function registerViewHtml() {
  return `<div class="auth-view hidden" id="view-register">
  <div class="auth-card glass">
    <div class="auth-header">
      <h2>${escHtml(TEXT.REGISTER_TITLE)}</h2>
      <p>${escHtml(TEXT.REGISTER_SUB)}</p>
    </div>
    <div class="seg-tabs seg-tabs--role glass glass--solid" id="register-role-tabs">
      <button type="button" class="seg-tab glass active" data-role="${ROLES.STUDENT}" data-action="auth.switchRegisterRole">${escHtml(TEXT.REG_ROLE_STUDENT)}</button>
      <button type="button" class="seg-tab glass" data-role="${ROLES.TEACHER}" data-action="auth.switchRegisterRole">${escHtml(TEXT.REG_ROLE_TEACHER)}</button>
    </div>
    <form data-submit="auth.handleRegister">
      <input type="hidden" id="register-role" value="${ROLES.STUDENT}">
      <div id="student-reg-group">
        ${studentRegisterFormHtml()}
      </div>
      <div id="teacher-wizard-root" class="hidden"></div>
    </form>
    <div class="auth-footer">${escHtml(TEXT.REGISTER_HAVE_ACCOUNT)}<a href="#" data-action="auth.viewLogin">${escHtml(TEXT.REGISTER_GO_LOGIN)}</a></div>
  </div>
</div>`;
}

export function teacherWizardHtml() {
  return `<div class="dw-stepper" id="reg-w-stepper">
    ${TEXT.REG_WIZARD_STEPS.map((s, i) =>
      `<div class="dw-step-chip" data-step="${i + 1}" title="${escHtml(s)}"><span class="dw-step-chip-dot"></span><span class="dw-step-chip-label">${escHtml(s)}</span></div>`).join('')}
  </div>
  <div class="dw-steps-viewport"><div class="dw-steps-track" id="reg-w-track">
    <div class="dw-step" data-step="1">
      <div class="form-group">
        <label class="form-label">${escHtml(TEXT.REG_INVITE_LABEL)} <span class="req">*</span></label>
        <input type="text" class="form-input" id="reg-invite-code" placeholder="${escHtml(TEXT.REG_INVITE_PLACEHOLDER)}" maxlength="${CONFIG.INVITE_CODE_LEN}">
        <p class="form-hint">${escHtml(TEXT.REG_INVITE_HINT)}</p>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline glass glass--pressable" data-action="auth.backLanding">${escHtml(TEXT.BTN_BACK_LANDING)}</button>
        <button type="button" class="btn glass glass--pressable" id="reg-step1-next" data-action="auth.wizardNext">${escHtml(TEXT.BTN_NEXT_STEP)}</button>
      </div>
    </div>
    <div class="dw-step" data-step="2">
      <div class="form-group">
        <label class="form-label">${escHtml(TEXT.REG_USERNAME_LABEL)} <span class="req">*</span></label>
        <input type="text" class="form-input" id="register-username" placeholder="${escHtml(TEXT.REG_USERNAME_PLACEHOLDER)}" required>
      </div>
      <div class="form-group">
        <label class="form-label">${escHtml(TEXT.REG_PASSWORD_LABEL)} <span class="req">*</span></label>
        <input type="password" class="form-input" id="register-password" placeholder="${escHtml(TEXT.REG_PASSWORD_PLACEHOLDER)}" required>
      </div>
      <div class="form-group">
        <label class="form-label">${escHtml(TEXT.REG_PASSWORD2_LABEL)} <span class="req">*</span></label>
        <input type="password" class="form-input" id="register-password2" placeholder="${escHtml(TEXT.REG_PASSWORD2_PLACEHOLDER)}" required>
      </div>
      <div class="form-group">
        <label class="form-label">${escHtml(TEXT.REG_CONTACT_LABEL)} <span class="req">*</span></label>
        <input type="text" class="form-input" id="register-identifier" placeholder="${escHtml(TEXT.REG_CONTACT_PLACEHOLDER)}"
          autocomplete="email" data-input-action="auth.checkRegisterContact">
        <p class="form-hint">${escHtml(TEXT.REG_CONTACT_HINT)}</p>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline glass glass--pressable" data-action="auth.wizardBack">${escHtml(TEXT.BTN_PREV_STEP)}</button>
        <button type="button" class="btn glass glass--pressable" id="reg-step2-next" data-action="auth.wizardNext">${escHtml(TEXT.BTN_NEXT_STEP)}</button>
      </div>
    </div>
    <div class="dw-step" data-step="3">
      <div id="register-code-group">
        ${codeFieldHtml({ prefix: 'register', channel: 'auto', label: TEXT.CODE_LABEL })}
      </div>
      ${agreeRowsHtml()}
      <div class="form-actions">
        <button type="button" class="btn btn-outline glass glass--pressable" data-action="auth.wizardBack">${escHtml(TEXT.BTN_PREV_STEP)}</button>
        <button type="submit" class="btn glass glass--pressable" id="register-submit" data-action="auth.handleRegister">${escHtml(TEXT.BTN_REGISTER)}</button>
      </div>
    </div>
  </div></div>`;
}

function agreeRowsHtml() {
  return `<label class="agree-row">
    <input type="checkbox" id="agree-agreement" class="agree-check">
    <span class="agree-text">${escHtml(TEXT.AGREE_PREFIX)}<a href="#" class="agree-link" data-action="auth.openAgreement">${escHtml(TEXT.AGREE_LINK_AGREEMENT)}</a></span>
  </label>
  <label class="agree-row">
    <input type="checkbox" id="agree-privacy" class="agree-check">
    <span class="agree-text">${escHtml(TEXT.AGREE_PREFIX)}<a href="#" class="agree-link" data-action="auth.openPrivacy">${escHtml(TEXT.AGREE_LINK_PRIVACY)}</a></span>
  </label>`;
}

export function phoneFieldHtml({ prefix = 'bind', label = TEXT.PHONE_LABEL } = {}) {
  return `<div class="form-group">
    <label class="form-label">${escHtml(label)}</label>
    <input type="tel" class="form-input" id="${escHtml(prefix)}-phone" placeholder="${escHtml(TEXT.PHONE_PLACEHOLDER)}" inputmode="tel" autocomplete="tel">
  </div>`;
}

export function emailFieldHtml({ prefix = 'bind', label = TEXT.EMAIL_LABEL } = {}) {
  return `<div class="form-group">
    <label class="form-label">${escHtml(label)}</label>
    <input type="email" class="form-input" id="${escHtml(prefix)}-email" placeholder="${escHtml(TEXT.EMAIL_PLACEHOLDER)}" inputmode="email" autocomplete="email">
  </div>`;
}

export function codeFieldHtml({ prefix = 'bind', channel = 'sms', label = TEXT.CODE_LABEL } = {}) {
  return `<div class="form-group">
    <label class="form-label" id="${escHtml(prefix)}-code-label">${escHtml(label)}</label>
    <div class="code-input-wrap">
      <input type="text" class="form-input" id="${escHtml(prefix)}-code" placeholder="${escHtml(TEXT.CODE_PLACEHOLDER)}"
        inputmode="numeric" autocomplete="one-time-code" maxlength="6">
      <button type="button" class="btn btn-sm code-send-btn glass glass--pressable" id="${escHtml(prefix)}-send"
        data-action="auth.sendCode" data-prefix="${escHtml(prefix)}" data-channel="${escHtml(channel)}">${escHtml(TEXT.CODE_SEND)}</button>
    </div>
  </div>`;
}

export function bindModalFooter(kind) {
  return `<button type="button" class="btn btn-outline glass glass--pressable" data-action="auth.closeModal">${escHtml(TEXT.BTN_CANCEL)}</button>
    <button type="button" class="btn glass glass--pressable" data-action="auth.submit${kind === 'email' ? 'Email' : 'Phone'}Bind">${escHtml(TEXT.BTN_BIND)}</button>`;
}
