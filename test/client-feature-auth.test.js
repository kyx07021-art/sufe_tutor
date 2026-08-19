/**
 * Auth feature migration gate: registry/DOM/render parity for login, register
 * wizard + OTP + bind, logout cleanup, captcha gating on sensitive actions,
 * and request-body contract cases (login deviceId / register email channel —
 * the vm-vs-ESM parity harness was removed with the vm classic-script loading).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { CONFIG } from '../src/shared/config.js';
import { TEXT as SHARED_TEXT } from '../src/client/constants/text.js';
import { state, registerLogoutReset } from '../src/client/core/state.js';
import { stopBadgePoll } from '../src/client/core/router.js';
import { stopVersionProbe } from '../src/client/core/datahub.js';
import { closeAllModals } from '../src/client/core/ui.js';
import authFeature from '../src/client/features/auth/index.js';
import settingsFeature from '../src/client/features/settings/index.js';
import * as auth from '../src/client/features/auth/actions.js';
import * as render from '../src/client/features/auth/render.js';
import { TEXT } from '../src/client/features/auth/text.js';
import { TEXT as SETTINGS_TEXT } from '../src/client/features/settings/text.js';

CONFIG.TOAST_MS = 10;
CONFIG.TOAST_FADE_MS = 1;

const rootFile = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const FEATURE_FILES = [
  'src/client/features/auth/index.js',
  'src/client/features/auth/render.js',
  'src/client/features/auth/actions.js',
  'src/client/features/auth/actions-register.js',
  'src/client/features/auth/actions-otp.js',
  'src/client/features/auth/flow.js',
  'src/client/features/auth/text.js',
];

const SHELL_HTML = `<!doctype html><html><body>
  <div id="view-landing" class="hidden"></div>
  <div id="view-client" class="client-shell hidden">
    <aside class="client-sidebar" id="client-sidebar">
      <div id="sidebar-user"></div><nav class="sidebar-nav" id="sidebar-nav"></nav><div id="sidebar-invite"></div>
    </aside>
    <main id="client-main"><div id="navbar-actions"></div></main>
  </div>
  <div id="modal-container"></div><div id="toast-container"></div>
</body></html>`;

function useDom(dom) {
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.sessionStorage = dom.window.sessionStorage;
}

function clearDomGlobals() {
  delete globalThis.document;
  delete globalThis.window;
  delete globalThis.localStorage;
  delete globalThis.sessionStorage;
}

function makeDom(html = SHELL_HTML) {
  const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
  useDom(dom);
  return dom;
}

function resetRuntime() {
  if (typeof document !== 'undefined') stopBadgePoll();
  stopVersionProbe();
  Object.assign(state, {
    user: null, authToken: null, view: 'landing', page: null,
    allTeachers: [], adminTeachers: [], intentTeachers: [], myReviewOnModal: null,
    myDemands: [], editingDemandId: null, adminPosts: [], adminContracts: [], myContracts: [],
    inviteTimerId: null, currentInviteCode: null, validatedInviteCode: null,
    guestRole: null, guestAuthMode: false,
  });
  auth.setAuthReturnPage(null);
}

function stopRuntimeTimers() {
  if (typeof document !== 'undefined') stopBadgePoll();
  stopVersionProbe();
}

function mountFeature(t) {
  const off = authFeature.onLoad();
  auth.refreshAuthHeader();
  t.after(() => {
    off();
    stopRuntimeTimers();
    clearDomGlobals();
  });
}

function canvasMock(dom) {
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({
    createLinearGradient: () => ({ addColorStop: () => {} }),
    fillRect: () => {}, fillStyle: '', save: () => {}, restore: () => {},
    globalCompositeOperation: '', strokeRect: () => {}, lineWidth: 0, strokeStyle: '',
    beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, closePath: () => {},
    arc: () => {}, rect: () => {}, stroke: () => {}, clearRect: () => {}, drawImage: () => {},
    fill: () => {}, // v1.4.17 parity: captcha destination-in/out fill (stub must mirror the call)
    getImageData: () => ({ data: new Uint8ClampedArray(6400) }),
  });
}

function installFetch(responder) {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const body = opts.body && typeof opts.body === 'string' ? JSON.parse(opts.body) : opts.body;
    calls.push({ url: u, opts, body });
    return { ok: true, status: 200, json: async () => responder(u, opts, body) };
  };
  return calls;
}

function defaultResponder(overrides = {}) {
  return (url, opts, body) => {
    if (overrides[url]) return overrides[url];
    if (url.includes('/api/batch')) {
      const gets = (body && body.gets) || [];
      return { results: gets.map(g => ({ path: g.path, status: 200, data: {} })) };
    }
    if (url.includes('/api/auth/check')) return { exists: true, role: 'student' };
    return {};
  };
}

function seedDevice(storage) {
  storage.setItem(CONFIG.DEVICE_ID_KEY, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
}

test('text parity: every auth key matches shared text.js / old static shell verbatim', () => {
  for (const [k, v] of Object.entries(TEXT)) {
    if (SHARED_TEXT[k] !== undefined) {
      if (Array.isArray(v)) assert.deepEqual(v, SHARED_TEXT[k], k);
      else assert.equal(v, SHARED_TEXT[k], k);
    }
  }
  // V-4-1h：v1 静态壳已删，登录/注册文案单源 = features/auth/render.js 渲染输出（V-2-4a 服务端文案同源）
  const shellHtml = render.loginViewHtml() + render.registerViewHtml();
  for (const v of [TEXT.LOGIN_IDENTIFIER_LABEL, TEXT.LOGIN_PASSWORD_LABEL, TEXT.LOGIN_REMEMBER,
    TEXT.LOGIN_CODE_HINT, TEXT.BTN_BACK, TEXT.BTN_GO_REGISTER, TEXT.REGISTER_TITLE, TEXT.REGISTER_SUB,
    TEXT.REG_ROLE_STUDENT, TEXT.REG_ROLE_TEACHER, TEXT.REGISTER_HAVE_ACCOUNT, TEXT.REGISTER_GO_LOGIN]) {
    assert.ok(shellHtml.includes(v), v);
  }
});

test('login five-in-one DOM: unique identifier + password/code groups + switch + send', () => {
  const html = render.loginViewHtml();
  for (const id of ['login-identifier', 'login-password-group', 'login-code-group', 'login-remember',
    'login-code', 'login-send', 'login-switch-mode', 'login-submit']) assert.ok(html.includes(`id="${id}"`), id);
  assert.ok(!html.includes('id="login-username"'));
  assert.ok(html.includes('data-action="auth.sendCode"'));
  assert.ok(html.includes('data-prefix="login"'));
  assert.ok(!/onclick=/.test(html) && !/style=/.test(html) && !/fetch\(/.test(html));
});

test('feature boundaries: <=300 lines, zero inline handlers/styles/fetch/Chinese outside text.js', () => {
  for (const f of FEATURE_FILES) {
    const s = rootFile(f);
    const rel = f.replaceAll('\\', '/');
    assert.ok(s.split('\n').length <= 300, `${rel} <= 300 lines`);
    assert.ok(!/onclick=/.test(s), `${rel} no onclick`);
    assert.ok(!/style=/.test(s), `${rel} no style=`);
    assert.ok(!/fetch\(/.test(s), `${rel} no fetch`);
    if (!rel.endsWith('/text.js')) assert.ok(!/[\u4e00-\u9fff]/.test(s), `${rel} no Chinese literals`);
  }
});

test('registry onLoad mounts views and delegates data-action + input + submit', async (t) => {
  resetRuntime();
  const dom = makeDom();
  mountFeature(t);
  assert.equal(authFeature.id, 'auth');
  assert.deepEqual(authFeature.pages, []);
  assert.equal(typeof authFeature.actions['auth.handleLogin'], 'function');

  assert.ok(document.getElementById('view-login'));
  assert.ok(document.getElementById('view-register').classList.contains('hidden'));

  document.querySelector('[data-action="auth.viewRegister"]').click();
  assert.equal(state.view, 'register');
  assert.ok(!document.getElementById('view-register').classList.contains('hidden'));

  document.querySelector('#register-role-tabs [data-role="teacher"]').click();
  assert.equal(document.getElementById('register-role').value, 'teacher');
  assert.ok(document.getElementById('teacher-wizard-root').innerHTML.includes('reg-invite-code'));
  assert.equal(document.querySelectorAll('#reg-w-track .dw-step').length, 3);

  document.getElementById('login-identifier').value = '13800138000';
  document.getElementById('login-identifier').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, CONFIG.LOGIN_CHECK_DEBOUNCE_MS + 20));
  assert.ok(document.getElementById('login-submit').disabled, 'submit stays disabled until account probe passes');
});

test('login success: state/authToken set, client switched, remember-session persisted', async (t) => {
  resetRuntime();
  makeDom();
  mountFeature(t);
  const calls = installFetch(defaultResponder({
    '/api/auth/login': { user: { id: 1, username: 'alice', role: 'student' }, authToken: 'tok-login' },
  }));
  document.getElementById('login-identifier').value = 'alice';
  document.getElementById('login-password').value = 'pw123456';
  document.getElementById('login-remember').checked = true;

  await auth.doLogin('alice');

  assert.equal(state.user.role, 'student');
  assert.equal(state.authToken, 'tok-login');
  assert.equal(state.view, 'client');
  assert.equal(state.guestAuthMode, false);
  assert.equal(calls.find(c => c.url === '/api/auth/login').body.password, 'pw123456');
  const saved = JSON.parse(localStorage.getItem('sufe_session_student'));
  assert.equal(saved.authToken, 'tok-login');
  assert.ok(saved.expires > Date.now());
  stopRuntimeTimers();
});

test('teacher register wizard: role switch + invite validation + step validation', async (t) => {
  resetRuntime();
  makeDom();
  mountFeature(t);
  const calls = installFetch(defaultResponder({
    '/api/auth/check-invite': { ok: true },
  }));

  auth.switchRegisterRole('teacher');
  assert.equal(document.getElementById('student-reg-group').innerHTML, '', 'student form cleared to avoid hidden-field submit');
  assert.ok(!document.getElementById('teacher-wizard-root').classList.contains('hidden'));

  document.getElementById('reg-invite-code').value = 'INV12345';
  await auth.regWizardNext();
  assert.equal(state.validatedInviteCode, 'INV12345');
  assert.ok(document.querySelector('#reg-w-track .dw-step[data-step="2"]').classList.contains('dw-step--active'));
  assert.equal(calls.find(c => c.url === '/api/auth/check-invite').body.code, 'INV12345');

  document.getElementById('register-username').value = 'tutor1';
  document.getElementById('register-password').value = 'pw123456';
  document.getElementById('register-password2').value = 'pw123456';
  document.getElementById('register-identifier').value = '13800138000';
  auth.regWizardNext();
  assert.ok(document.querySelector('#reg-w-track .dw-step[data-step="3"]').classList.contains('dw-step--active'));
  auth.switchRegisterRole('student');
  assert.ok(document.getElementById('register-username'), 'student form restored');
  assert.equal(document.getElementById('register-role').value, 'student');
});

test('OTP: classify/cooldown text, phone register scene and email login scene', async (t) => {
  resetRuntime();
  makeDom();
  mountFeature(t);
  const calls = installFetch(defaultResponder({ '/api/auth/otp/request': {} }));

  assert.equal(auth.classifyIdentifier('13800138000'), 'phone');
  assert.equal(auth.classifyIdentifier('+8613800138000'), 'phone');
  assert.equal(auth.classifyIdentifier('a@b.com'), 'email');
  assert.equal(auth.classifyIdentifier('alice'), 'username');

  document.getElementById('register-identifier').value = '13800138000';
  auth.checkRegisterContact();
  assert.ok(!document.getElementById('register-code-group').classList.contains('hidden'));
  assert.equal(document.getElementById('register-code-label').textContent, TEXT.OTP_PHONE_LABEL);

  await auth.requestOtpCode('register', 'auto');
  const regCall = calls.find(c => c.url === '/api/auth/otp/request');
  assert.deepEqual(regCall.body, { channel: 'sms', target: '+8613800138000', scene: TEXT.OTP_SCENE_REGISTER });
  assert.equal(document.getElementById('register-send').disabled, true);
  assert.ok(document.getElementById('register-send').textContent.includes('后重发'));
  auth.otpExhaustedReset('register');
  assert.equal(document.getElementById('register-send').disabled, false);
  assert.equal(document.getElementById('register-send').textContent, TEXT.CODE_SEND);

  document.getElementById('login-identifier').value = 'tutor@example.com';
  await auth.requestOtpCode('login', 'sms');
  const loginCall = calls.find(c => c.url === '/api/auth/otp/request' && c.body.channel === 'email');
  assert.deepEqual(loginCall.body, { channel: 'email', target: 'tutor@example.com', scene: TEXT.OTP_SCENE_LOGIN });
  auth.otpExhaustedReset('login');
});

test('register success: body contract, session + client switch, invite cleared', async (t) => {
  resetRuntime();
  makeDom();
  mountFeature(t);
  const calls = installFetch(defaultResponder({
    '/api/auth/register': { user: { id: 2, username: 'tutor1', role: 'teacher' }, authToken: 'tok-reg' },
  }));
  state.validatedInviteCode = 'INV12345';
  document.getElementById('register-submit').textContent = TEXT.BTN_REGISTER;

  await auth.doRegister('tutor1', 'pw123456', 'teacher', true, true,
    { ident: '+8613800138000', code: '123456', kind: 'phone' });

  const body = calls.find(c => c.url === '/api/auth/register').body;
  assert.equal(body.username, 'tutor1');
  assert.equal(body.role, 'teacher');
  assert.equal(body.inviteCode, 'INV12345');
  assert.equal(body.phone, '+8613800138000');
  assert.equal(body.otpChannel, 'sms');
  assert.equal(body.agreeAgreement, true);
  assert.equal(body.agreePrivacy, true);
  assert.equal(body.deviceId, localStorage.getItem(CONFIG.DEVICE_ID_KEY));
  assert.equal(state.user.role, 'teacher');
  assert.equal(state.authToken, 'tok-reg');
  assert.equal(state.validatedInviteCode, null);
  assert.equal(state.view, 'client');
  stopRuntimeTimers();
});

test('logout cleanup: api logout, reset registry, state/arrays/session cleared, landing view', async (t) => {
  resetRuntime();
  makeDom();
  mountFeature(t);
  const calls = installFetch(defaultResponder({ '/api/auth/logout': {} }));
  let resets = 0;
  registerLogoutReset(() => { resets++; });
  state.user = { id: 1, username: 'alice', role: 'student' };
  state.authToken = 'tok-logout';
  state.allTeachers = [1];
  state.myDemands = [2];
  state.adminContracts = [3];
  localStorage.setItem('sufe_session_student', JSON.stringify({ authToken: 'tok-logout' }));
  sessionStorage.setItem('sufe_session_student', JSON.stringify({ authToken: 'tok-logout' }));

  auth.handleLogout();

  assert.equal(calls.filter(c => c.url === '/api/auth/logout').length, 1);
  assert.equal(resets, 1);
  assert.equal(state.user, null);
  assert.equal(state.authToken, null);
  assert.deepEqual(state.allTeachers, []);
  assert.deepEqual(state.myDemands, []);
  assert.deepEqual(state.adminContracts, []);
  assert.equal(state.view, 'landing');
  assert.equal(localStorage.getItem('sufe_session_student'), null);
  assert.equal(sessionStorage.getItem('sufe_session_student'), null);
  assert.equal(document.getElementById('modal-container').innerHTML, '');
});

test('phone/email bind: production-shape settings DOM + click delegation + doBind + masked update', async (t) => {
  resetRuntime();
  makeDom();
  mountFeature(t);
  // 六轮审计：裸 span 替身 + 未装 settings feature → 测试绿掩盖生产断。本轮：
  // SHELL_HTML 裸 span 已删（文档序唯一 span 来自模板）、settings feature 真实安装、
  // 绑定入口用真实 click 走 document 委托（auth/settings 两监听并存验证无互扰）
  const offSettings = settingsFeature.onLoad();
  t.after(() => offSettings());
  document.body.insertAdjacentHTML('beforeend', '<div id="account-settings-content"></div>');
  state.user = { id: 1, role: 'student', username: 'u_front' };
  const { enterAccountSettings } = await import('../src/client/features/settings/actions.js');
  enterAccountSettings();
  await new Promise(r => setTimeout(r, 0)); // loadMyCreds（dhGet account 域）完成
  const calls = installFetch(defaultResponder({
    '/api/auth/phone/bind': { message: '', phone: '138****8000' },
    '/api/auth/email/bind': { message: '', email: 't***@example.com' },
  }));
  const content = document.getElementById('account-settings-content');

  // 生产形状：span 必须来自模板（SHELL_HTML 裸 span 已删，getElementById 命中的
  // 就是模板内节点——loadMyCreds 摧毁 span / doBind 写错节点都会让断言变红）
  assert.ok(document.getElementById('settings-phone-val'), '电话 span 存活（模板内唯一）');
  assert.ok(document.getElementById('settings-email-val'), '邮箱 span 存活（模板内唯一）');
  assert.equal(document.getElementById('settings-phone-val').textContent, SETTINGS_TEXT.SETTINGS_UNBOUND, '初始未绑定占位');
  assert.equal(document.getElementById('settings-email-val').textContent, SETTINGS_TEXT.SETTINGS_UNBOUND, '邮箱行独立占位（v1 分行显示）');

  // 绑定入口：模板按钮 + 真实 click 委托（六轮审计：曾整链不可达）
  assert.ok(content.querySelector('[data-action="auth.openPhoneBind"]'), '电话修改按钮在模板');
  assert.ok(content.querySelector('[data-action="auth.openEmailBind"]'), '邮箱修改按钮在模板');
  assert.ok(content.querySelector('[data-action="settings.openUsernameChange"]'), '用户名修改按钮在模板');
  assert.ok(content.querySelector('#avatar-file') && content.querySelector('label[for="avatar-file"]'), '头像上传行在模板（v1 parity）');
  content.querySelector('[data-action="auth.openPhoneBind"]').click();
  await new Promise(r => setTimeout(r, 0));
  assert.ok(document.getElementById('modal-container').textContent.includes(TEXT.BIND_PHONE_TITLE), '真实点击打开电话绑定浮窗');
  document.getElementById('modal-container').innerHTML = '';
  content.querySelector('[data-action="auth.openEmailBind"]').click();
  await new Promise(r => setTimeout(r, 0));
  assert.ok(document.getElementById('modal-container').textContent.includes(TEXT.BIND_EMAIL_TITLE), '真实点击打开邮箱绑定浮窗');
  document.getElementById('modal-container').innerHTML = '';

  auth.openPhoneBindModal();
  assert.ok(document.getElementById('modal-container').textContent.includes(TEXT.BIND_PHONE_TITLE));
  document.getElementById('bind-phone').value = '13800138000';
  document.getElementById('bind-code').value = '123456';
  await auth.doBind('phone', true, '+8613800138000', '123456');
  assert.deepEqual(calls.find(c => c.url === '/api/auth/phone/bind').body,
    { phone: '+8613800138000', code: '123456' });
  assert.equal(document.getElementById('settings-phone-val').textContent, '138****8000', '直写落在模板内存活 span 上');
  assert.equal(document.getElementById('settings-email-val').textContent, SETTINGS_TEXT.SETTINGS_UNBOUND, '未绑的邮箱行保持占位');

  auth.openEmailBindModal();
  document.getElementById('bind-email').value = 'tutor@example.com';
  document.getElementById('bind-code').value = '654321';
  await auth.doBind('email', false, 'tutor@example.com', '654321');
  assert.deepEqual(calls.find(c => c.url === '/api/auth/email/bind').body,
    { email: 'tutor@example.com', code: '654321' });
  assert.equal(document.getElementById('settings-email-val').textContent, 't***@example.com', '邮箱直写生效');
  assert.equal(document.getElementById('settings-phone-val').textContent, '138****8000', '电话行不被连带改动');
});

test('withCaptcha gates login/register/bind before any sensitive request', async (t) => {
  resetRuntime();
  makeDom();
  mountFeature(t);
  canvasMock(globalThis.window);
  const calls = installFetch(defaultResponder());

  document.getElementById('login-identifier').value = 'alice';
  document.getElementById('login-password').value = 'pw123456';
  await auth.handleLogin({ preventDefault() {} });
  assert.ok(document.getElementById('captcha-canvas'), 'login opens captcha first');
  assert.equal(calls.some(c => c.url === '/api/auth/login'), false);
  closeAllModals();

  document.getElementById('register-username').value = 'student1';
  document.getElementById('register-password').value = 'pw123456';
  document.getElementById('register-password2').value = 'pw123456';
  document.getElementById('register-identifier').value = 'student@example.com';
  document.getElementById('register-code').value = '123456';
  document.getElementById('agree-agreement').checked = true;
  document.getElementById('agree-privacy').checked = true;
  auth.handleRegister({ preventDefault() {} });
  assert.ok(document.getElementById('captcha-canvas'), 'register opens captcha first');
  assert.equal(calls.some(c => c.url === '/api/auth/register'), false);
  closeAllModals();

  auth.openPhoneBindModal();
  document.getElementById('bind-phone').value = '13800138000';
  document.getElementById('bind-code').value = '123456';
  auth.submitBind('phone');
  assert.ok(document.getElementById('captcha-canvas'), 'bind opens captcha first');
  assert.equal(calls.some(c => c.url === '/api/auth/phone/bind'), false);
  closeAllModals();
});

// Request-body contract cases (v1-parity kept as direct ESM assertions — the vm
// classic-script side is gone with B4). The OTP +86 normalization / scene body is
// covered by the "OTP: classify/cooldown..." test above; these two add the login
// deviceId and the register email-channel bodies.

test('request body contract: password login carries identifier + deviceId', async (t) => {
  resetRuntime();
  makeDom();
  mountFeature(t);
  seedDevice(globalThis.localStorage);
  const calls = installFetch(defaultResponder({
    '/api/auth/login': { user: { id: 1, username: 'alice', role: 'student' }, authToken: 'tok-login' },
  }));
  document.getElementById('login-identifier').value = 'alice';
  document.getElementById('login-password').value = 'pw123456';
  document.getElementById('login-remember').checked = true;

  await auth.doLogin('alice');

  const body = calls.find(c => c.url === '/api/auth/login').body;
  assert.equal(body.identifier, 'alice');
  assert.equal(body.password, 'pw123456');
  assert.equal(body.deviceId, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'); // seeded device id (32 chars)
  stopRuntimeTimers();
});

test('request body contract: register email channel sends email + otpChannel', async (t) => {
  resetRuntime();
  makeDom();
  mountFeature(t);
  seedDevice(globalThis.localStorage);
  const calls = installFetch(defaultResponder({
    '/api/auth/register': { user: { id: 2, username: 'stu1', role: 'student' }, authToken: 'tok-reg' },
  }));

  await auth.doRegister('stu1', 'pw123456', 'student', true, true,
    { ident: 'stu@example.com', code: '123456', kind: 'email' });

  const body = calls.find(c => c.url === '/api/auth/register').body;
  assert.equal(body.username, 'stu1');
  assert.equal(body.email, 'stu@example.com');
  assert.equal(body.code, '123456');
  assert.equal(body.otpChannel, 'email');
  assert.equal(body.deviceId, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  stopRuntimeTimers();
});
