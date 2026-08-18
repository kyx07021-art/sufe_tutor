/**
 * 用户反馈（2026-08-10）：主站登录教师 → 退登 → 主页点学生客户端入口 → 不自动登录学生、
 * 不进游客客户端、直接弹登录弹窗，且弹窗「返回」按钮没反应。
 *
 * 根因（v0.25.110 修复）：登出前停留在需登录页（如 account-settings），sufe_last_page 残留。
 * 访客进客户端按「上次停留页」恢复该页 → selectPage 触发 ensureAuth → 弹登录页；
 * 「返回」authGoBack 又恢复同一页 → 死循环，返回无效。
 * 修：访客恢复停留页须过 auth 门（只恢复 auth:false 的公开页）。
 *
 * B4：直接 import auth flow ESM。v2 无 v1 的 DOMContentLoaded 自动编排，测试用
 * handleFeatureClick 作为「刷新恢复」等价入口（同 refresh-restore.test.js）。
 *
 * 覆盖：
 *   1. 无学生会话点学生入口 → 学生访客客户端（browse-teachers），不弹登录；
 *   2. 有效学生会话点学生入口 → 自动登录学生客户端（switchToRole）；
 *   3. B1：/me 拒绝不覆盖登出（/me 在途时身份已被替换 → 拒绝回调不回落访客预览）；
 *   4. sufe_last_page 残留需登录页 → 访客不恢复，回落公开页（回归根因）；
 *   5. 登录页「返回」→ 离开登录页进客户端（不死循环）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { state, saveSession } from '../src/client/core/state.js';
import { handleFeatureClick, ensureAuth, authGoBack } from '../src/client/features/auth/flow.js';
import { stopBadgePoll } from '../src/client/core/router.js';
import { _dhResetForTests, stopVersionProbe } from '../src/client/core/datahub.js';

const SHELL_HTML = `<!doctype html><html><body>
  <div id="view-landing" class="hidden"></div>
  <div id="view-login" class="hidden"></div>
  <div id="view-register" class="hidden"></div>
  <div id="view-client" class="client-shell hidden">
    <aside class="client-sidebar" id="client-sidebar">
      <div id="sidebar-user"></div><nav class="sidebar-nav" id="sidebar-nav"></nav><div id="sidebar-invite"></div>
    </aside>
    <main id="client-main"><div id="navbar-actions"></div></main>
  </div>
  <div id="modal-container"></div><div id="toast-container"></div>
</body></html>`;

function setup({ apiHandlers = {} } = {}) {
  const dom = new JSDOM(SHELL_HTML, { url: 'http://localhost/', pretendToBeVisual: true });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.sessionStorage = dom.window.sessionStorage;
  globalThis.MutationObserver = dom.window.MutationObserver;
  state.user = null; state.authToken = null; state.view = 'landing'; state.page = null; state.guestRole = null; state.guestAuthMode = false;
  _dhResetForTests();
  const errors = [];
  globalThis.window.addEventListener('error', e => errors.push('window.onerror: ' + (e.message || e)));
  globalThis.fetch = async (url) => {
    const u = String(url);
    const h = apiHandlers[u] || apiHandlers['*'];
    if (h) return { ok: true, status: 200, json: async () => h() };
    if (u.includes('/api/batch')) return { ok: true, status: 200, json: async () => ({ results: [] }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  return { dom, errors };
}
async function settle() { await new Promise(r => setTimeout(r, 30)); } // /auth/me then 链收尾
function teardown() {
  stopBadgePoll();
  stopVersionProbe();
  delete globalThis.fetch;
  delete globalThis.document; delete globalThis.window;
  delete globalThis.localStorage; delete globalThis.sessionStorage;
  delete globalThis.MutationObserver;
}
const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));
const viewOf = () => {
  const v = id => { const e = document.getElementById(id); return e && !e.classList.contains('hidden'); };
  return v('view-landing') ? 'landing' : v('view-login') ? 'login' : v('view-client') ? 'client' : '?';
};

const STUDENT = { id: 39, username: 'qa_student', role: 'student', avatar: '' };

test('无学生会话点学生入口 → 学生访客客户端（browse-teachers），不弹登录', async () => {
  const { errors } = setup();
  handleFeatureClick('student');
  await tick(40);
  assert.equal(errors.length, 0, '无 JS 错误：' + errors.join('\n'));
  assert.equal(viewOf(), 'client', '点学生入口应进客户端而非登录页');
  assert.equal(state.guestRole, 'student', '学生访客态');
  await settle();
  teardown();
});

test('有效学生会话点学生入口 → 自动登录学生客户端（switchToRole）', async () => {
  const { errors } = setup({ apiHandlers: { '/api/auth/me': () => ({ user: STUDENT }) } });
  // 预置有效学生会话（「以前上过的学生账户」记住登录）
  state.user = STUDENT;
  state.authToken = 'stu-token';
  saveSession(true);
  state.user = null; state.authToken = null;
  handleFeatureClick('student');
  await tick(60);
  assert.equal(state.user && state.user.role, 'student', '应自动登录学生账户');
  assert.equal(viewOf(), 'client', '学生客户端视图');
  assert.equal(errors.length, 0, '无 JS 错误：' + errors.join('\n'));
  await settle();
  teardown();
});

test('B1 /me 拒绝不覆盖登出：/me 在途时身份已被替换 → 拒绝回调不回落访客预览', async () => {
  let rejectMe;
  const { errors } = setup({
    apiHandlers: { '/api/auth/me': () => new Promise((_, rej) => { rejectMe = rej; }) },
  });
  // 有效学生会话进客户端（switchToRole，/me 挂起中）
  state.user = STUDENT;
  state.authToken = 'stu-token';
  saveSession(true);
  state.user = null; state.authToken = null;
  handleFeatureClick('student');
  await tick(20);
  assert.equal(state.user && state.user.role, 'student', '已进学生客户端');
  // /me 在途期间用户登出（身份被清空）——过期拒绝回调不得把它拉回学生访客预览
  state.authToken = null; state.user = null;
  rejectMe(Object.assign(new Error('dead token'), { code: 401 }));
  await tick(30);
  assert.notEqual(state.guestRole, 'student', '拒绝回调不得覆盖已发生的登出（B1 身份守卫）');
  assert.equal(errors.length, 0, '无 JS 错误：' + errors.join('\n'));
  await settle();
  teardown();
});

test('sufe_last_page 残留需登录页：访客不恢复，回落公开页（v0.25.110 根因回归）', async () => {
  const { errors } = setup();
  // 模拟上一角色（教师）在 account-settings 登出 → 停留页残留
  localStorage.setItem('sufe_last_page', 'account-settings');
  handleFeatureClick('student');
  await tick(40);
  assert.equal(errors.length, 0, '无 JS 错误：' + errors.join('\n'));
  assert.equal(viewOf(), 'client', `点学生入口应进客户端而非登录页（实际=${viewOf()}）`);
  assert.equal(state.page, 'browse-teachers', '访客回落公开页（不恢复需登录停留页）');
  await settle();
  teardown();
});

test('登录页「返回」：离开登录页进客户端，不再被需登录停留页拦回（死循环修复）', async () => {
  const { errors } = setup();
  localStorage.setItem('sufe_last_page', 'account-settings'); // 上一角色残留
  state.view = 'landing';
  ensureAuth(); // 落地页触发登录通路
  await tick();
  assert.equal(viewOf(), 'login', 'ensureAuth 导向登录页');
  authGoBack();
  await tick(40);
  assert.equal(errors.length, 0, 'authGoBack 无 JS 错误：' + errors.join('\n'));
  assert.equal(viewOf(), 'client', `返回应离开登录页进客户端（实际=${viewOf()}）`);
  await settle();
  teardown();
});
