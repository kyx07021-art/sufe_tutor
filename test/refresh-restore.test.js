/**
 * v0.25.95（用户反馈「刷新不要回首页」）：刷新保持登录状态 + 页面停留（B4：直接 import auth flow ESM）。
 *
 * v2 形态：会话/页面/访客角色三态持久化在 core/state（loadSession/savePageState/getLastPage/
 * setLastGuestRole），恢复链入口 = auth flow 的 handleFeatureClick（loadSession → switchToRole 或
 * enterRolePreview → enterClient）。v2 无 v1 的 DOMContentLoaded 自动编排，测试用 handleFeatureClick
 * 作为「刷新恢复」的等价入口。
 *
 * 覆盖：
 *   - 有有效登录会话 + 页面停留 → 恢复用户与页面（不再落落地页）；
 *   - 访客角色 + 页面停留 → 恢复访客预览与该页；
 *   - selectPage 记录页面停留；exitCurrentIdentity 清访客标记（登出后刷新必回落地页）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { state } from '../src/client/core/state.js';
import { handleFeatureClick, exitCurrentIdentity } from '../src/client/features/auth/flow.js';
import { selectPage, stopBadgePoll } from '../src/client/core/router.js';
import { stopVersionProbe } from '../src/client/core/datahub.js';

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

function setup() {
  const dom = new JSDOM(SHELL_HTML, { url: 'http://localhost/', pretendToBeVisual: true });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.sessionStorage = dom.window.sessionStorage;
  state.user = null; state.authToken = null; state.view = 'landing'; state.page = null; state.guestRole = null;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/api/auth/me')) {
      return { ok: true, status: 200, json: async () => ({ user: { id: 1, username: 'qa_student', role: 'student', avatar: '' } }) };
    }
    if (u.includes('/api/batch')) return { ok: true, status: 200, json: async () => ({ results: [] }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  return dom;
}
async function settle() { await new Promise(r => setTimeout(r, 30)); } // /auth/me then 链收尾
function teardown() {
  stopBadgePoll();
  stopVersionProbe();
  delete globalThis.fetch;
  delete globalThis.document; delete globalThis.window;
  delete globalThis.localStorage; delete globalThis.sessionStorage;
}
const STUDENT = { id: 1, username: 'qa_student', role: 'student', avatar: '' };

test('有有效登录会话 + 页面停留：恢复用户与页面（不再落落地页）', async () => {
  setup();
  localStorage.setItem('sufe_session_student', JSON.stringify({ user: STUDENT, authToken: 'tk-1', expires: Date.now() + 3600000 }));
  localStorage.setItem('sufe_last_role', 'student');
  localStorage.setItem('sufe_last_page', 'my-demands');
  await handleFeatureClick('student'); // 刷新恢复链等价入口：loadSession → switchToRole → enterClient → /auth/me
  assert.equal(state.user && state.user.username, 'qa_student', '登录态恢复（不再访客/落地页）');
  assert.equal(state.user && state.user.role, 'student', '角色恢复');
  assert.equal(state.view, 'client', '直接进客户端');
  assert.equal(state.page, 'my-demands', '页面停留恢复（刷新前所在页）');
  assert.ok(document.getElementById('view-landing').classList.contains('hidden'), '落地页已隐藏');
  await settle();
  teardown();
});

test('访客角色 + 页面停留：恢复访客预览与该页', async () => {
  setup();
  localStorage.setItem('sufe_last_guest_role', 'teacher');
  localStorage.setItem('sufe_last_page', 'browse-demands');
  await handleFeatureClick('teacher'); // 无会话 → enterRolePreview → enterClient
  assert.equal(state.guestRole, 'teacher', '访客角色恢复');
  assert.equal(state.view, 'client', '访客直接进客户端');
  assert.equal(state.page, 'browse-demands', '访客页面停留恢复');
  assert.equal(state.user, null, '仍为未登录访客态');
  await settle();
  teardown();
});

test('selectPage 记录页面停留；exitCurrentIdentity 清访客标记（登出后刷新必回落地页）', async () => {
  setup();
  await handleFeatureClick('student');
  selectPage('browse-teachers');
  assert.equal(localStorage.getItem('sufe_last_page'), 'browse-teachers', 'selectPage 记录页面停留');
  assert.equal(localStorage.getItem('sufe_last_guest_role'), 'student', '访客角色已持久化');
  exitCurrentIdentity();
  assert.equal(localStorage.getItem('sufe_last_guest_role'), null, 'exit 清访客标记（登出后刷新回落地页）');
  await settle();
  teardown();
});
