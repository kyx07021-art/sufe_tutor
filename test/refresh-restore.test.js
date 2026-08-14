/**
 * v0.25.95（用户反馈「刷新不要回首页」）：刷新保持登录状态 + 页面停留，逻辑融进网络层主架构——
 * 会话/页面/访客角色三态持久化在 app-state 会话层（loadSession/savePageState/getLastPage/
 * setLastGuestRole/getLastGuestRole），boot（app-shell DOMContentLoaded）按 登录会话 → 访客角色 →
 * 落地页 顺序编排恢复，进入复用 app-auth（switchToRole/enterRolePreview）。
 *
 * 覆盖：
 *   - 有有效登录会话 + 页面停留 → 刷新后进客户端、恢复用户与页面（不再落落地页）；
 *   - 访客角色 + 页面停留 → 刷新后恢复访客预览与该页；
 *   - selectPage 记录页面停留；exitCurrentIdentity 清访客标记（登出后刷新必回落地页）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const FILES = [
  'constants.js', 'region-data.js', 'app-display.js', 'app-state.js', 'app-api.js',
  'app-datahub.js', 'app-anim.js', 'app-ui.js', 'app-otp.js', 'app-captcha.js', 'app-onboard.js', 'app-region.js',
  'app-posts.js', 'app-chat.js', 'app-contracts.js', 'app-chart.js', 'app-admin.js',
  'app-demands.js', 'app-teachers.js', 'app-style.js', 'app-pages.js', 'app-shell.js', 'app-auth.js',
];

function makeCtx() {
  const html = readFileSync('./index.html', 'utf8')
    .replace(/<script src="\/app-[a-z-]+\.js"><\/script>/g, '');
  const dom = new JSDOM(html, {
    url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'dangerously',
  });
  const w = dom.window;
  w.HTMLCanvasElement.prototype.getContext = function () { // jsdom 无 canvas：patch 链式 2d 替身（app-captcha 进 boot FILES 后 vm 测试走到 canvas 路径）
    const mk = () => new Proxy(() => {}, { get: (t, k) => (k === 'canvas' ? {} : mk()), apply: () => mk() });
    return mk();
  };
  const errors = [];
  w.addEventListener('error', (e) => errors.push('window.onerror: ' + (e.message || e)));
  const ctx = vm.createContext({
    window: w, document: w.document,
    getComputedStyle: w.getComputedStyle.bind(w),
    localStorage: w.localStorage, sessionStorage: w.sessionStorage,
    console, fetch: async (url) => {
      const u = String(url);
      if (u.includes('/api/auth/me')) {
        return { ok: true, status: 200, json: async () => ({ user: { id: 1, username: 'qa_student', role: 'student', avatar: '' } }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    },
    setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout,
    setInterval: () => 1, clearInterval: () => {}, // 桩掉轮询计时器防测试挂起（徽标/版本探测非本测试目标）
    Request: globalThis.Request, AbortController: globalThis.AbortController,
    MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
    Image: class { set src(v) { this._s = v; } },
    requestAnimationFrame: (cb) => setTimeout(cb, 16), cancelAnimationFrame: () => {},
    matchMedia: () => ({ matches: false, addEventListener: () => {} }),
  });
  for (const f of FILES) vm.runInContext(readFileSync('./' + f, 'utf8'), ctx, { filename: f });
  vm.runInContext(`if (typeof openCaptchaModal === 'function') { const _ocm = openCaptchaModal; openCaptchaModal = (o) => { if (o && o.onPass) o.onPass(); }; }`, ctx); // vm 测试直通拼图（生产走真验证）
  vm.runInContext('window.APP_CONSTANTS = globalThis.APP_CONSTANTS;', ctx);
  return { dom, ctx, errors };
}

const boot = async (ctx) => new Promise(res => {
  vm.runInContext(`document.dispatchEvent(new window.Event('DOMContentLoaded'))`, ctx);
  setTimeout(res, 350); // 等 /auth/me + enterClient 异步完成
});

test('有有效登录会话 + 页面停留：刷新后进客户端、恢复用户与页面（不再落落地页）', async () => {
  const { dom, ctx, errors } = makeCtx();
  // 预置会话（sufe_session_student 有效）+ 上次角色 + 页面停留
  vm.runInContext(`
    localStorage.setItem('sufe_session_student', JSON.stringify({
      user: { id: 1, username: 'qa_student', role: 'student', avatar: '' },
      authToken: 'tk-1', expires: Date.now() + 3600000 }));
    localStorage.setItem('sufe_last_role', 'student');
    localStorage.setItem('sufe_last_page', 'my-demands');
  `, ctx);
  await boot(ctx);
  const st = vm.runInContext(`({ user: state.user && state.user.username, role: state.user && state.user.role,
    view: state.view, page: state.page, landingHidden: document.getElementById('view-landing').classList.contains('hidden') })`, ctx);
  assert.deepEqual(errors, [], '启动无异常：\n' + errors.join('\n'));
  assert.equal(st.user, 'qa_student', '登录态恢复（不再访客/落地页）');
  assert.equal(st.role, 'student', '角色恢复');
  assert.equal(st.view, 'client', '直接进客户端');
  assert.equal(st.page, 'my-demands', '页面停留恢复（刷新前所在页）');
  assert.ok(st.landingHidden, '落地页已隐藏');
});

test('访客角色 + 页面停留：刷新后恢复访客预览与该页', async () => {
  const { ctx, errors } = makeCtx();
  vm.runInContext(`
    localStorage.setItem('sufe_last_guest_role', 'teacher');
    localStorage.setItem('sufe_last_page', 'browse-demands');
  `, ctx);
  await boot(ctx);
  const st = vm.runInContext(`({ guestRole: state.guestRole, view: state.view, page: state.page, user: state.user })`, ctx);
  assert.deepEqual(errors, [], '启动无异常：\n' + errors.join('\n'));
  assert.equal(st.guestRole, 'teacher', '访客角色恢复');
  assert.equal(st.view, 'client', '访客直接进客户端');
  assert.equal(st.page, 'browse-demands', '访客页面停留恢复');
  assert.equal(st.user, null, '仍为未登录访客态');
});

test('selectPage 记录页面停留；exitCurrentIdentity 清访客标记（登出后刷新必回落地页）', async () => {
  const { ctx } = makeCtx();
  // 记录：进访客预览后切页
  vm.runInContext(`enterRolePreview('student'); selectPage('browse-teachers');`, ctx);
  assert.equal(vm.runInContext(`localStorage.getItem('sufe_last_page')`, ctx), 'browse-teachers', 'selectPage 记录页面停留');
  assert.equal(vm.runInContext(`localStorage.getItem('sufe_last_guest_role')`, ctx), 'student', '访客角色已持久化');
  // 登出/清身份 → 访客标记清空
  vm.runInContext(`exitCurrentIdentity();`, ctx);
  assert.equal(vm.runInContext(`localStorage.getItem('sufe_last_guest_role')`, ctx), null, 'exit 清访客标记（登出后刷新回落地页）');
});
