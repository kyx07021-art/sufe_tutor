/**
 * W-5 settings.logout 交互链路回归（B4：直接 import settings ESM）。
 * 覆盖断线修复：confirmLogout 曾为空函数（ACTION_MAP 接线但点击无反应）。
 * 链路：confirmLogout → confirm 弹窗（确认文案 + 取消/退出按钮）→ 点确认 →
 * handleLogout（登出 API + 会话清空 + 弹窗关闭）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { confirmLogout, openDeactivateModal, enterAccountSettings, confirmDeactivateAccount } from '../src/client/features/settings/actions.js';
import { state } from '../src/client/core/state.js';

function setup() {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="modal-container"></div><div id="toast-container"></div><div id="my-chats-list"></div></body></html>', { url: 'http://localhost/' });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.sessionStorage = dom.window.sessionStorage;
  globalThis.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return []; } };
  state.user = { id: 1, role: 'student', username: '甲' };
  state.authToken = 'tok-logout';
  return dom;
}
function teardown() {
  delete globalThis.document; delete globalThis.window;
  delete globalThis.localStorage; delete globalThis.sessionStorage; delete globalThis.MutationObserver;
}

test('confirmLogout：弹窗含确认文案与退出按钮，确认后走 handleLogout 链路', async () => {
  const dom = setup();
  let logoutCalled = 0;
  globalThis.fetch = async (url) => {
    if (String(url) === '/api/auth/logout') logoutCalled++;
    return { ok: true, status: 200, json: async () => ({}) };
  };
  confirmLogout();
  const modal = dom.window.document.querySelector('.modal');
  assert.ok(modal, '弹窗出现');
  assert.ok(modal.textContent.includes('退出后需要重新登录'), '确认文案在弹窗');
  const cancelBtn = modal.querySelector('[data-action="ui.closeModal"]');
  const okBtn = modal.querySelector('[data-action="ui.runPendingConfirm"]');
  assert.ok(cancelBtn && okBtn, '取消/退出两按钮在');
  assert.ok(okBtn.textContent.includes('退出登录'), '确认按钮文案 = 退出登录');
  okBtn.click();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(logoutCalled, 1, '登出 API 被调一次');
  assert.equal(state.user, null, '会话 user 清空');
  assert.equal(state.authToken, null, 'authToken 清空');
  assert.equal(dom.window.document.querySelector('.modal'), null, '弹窗已关闭');
  delete globalThis.fetch; teardown();
});

test('confirmLogout：点取消不登出（弹窗关闭、状态保留）', async () => {
  const dom = setup();
  let logoutCalled = 0;
  globalThis.fetch = async (url) => {
    if (String(url) === '/api/auth/logout') logoutCalled++;
    return { ok: true, status: 200, json: async () => ({}) };
  };
  confirmLogout();
  const cancelBtn = dom.window.document.querySelector('[data-action="ui.closeModal"]');
  assert.ok(cancelBtn, '取消按钮在');
  cancelBtn.click();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(logoutCalled, 0, '取消不发登出请求');
  assert.ok(state.user && state.authToken, '会话状态保留');
  assert.equal(dom.window.document.querySelector('.modal'), null, '弹窗已关闭');
  delete globalThis.fetch; teardown();
});

// ===== Z-11-F3：注销账户 UI 入口（原 openDeactivateModal 零触发点，弹窗不可达）=====
test('enterAccountSettings：非管理员渲染注销按钮（data-action=settings.openDeactivate）', async () => {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="account-settings-content"></div></body></html>', { url: 'http://localhost/' });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.sessionStorage = dom.window.sessionStorage;
  globalThis.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return []; } };
  state.user = { id: 7, role: 'student', username: '注销测试' };
  state.authToken = 'tok-deact';
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
  enterAccountSettings();
  await new Promise(r => setTimeout(r, 0));
  const btn = dom.window.document.querySelector('[data-action="settings.openDeactivate"]');
  assert.ok(btn, '注销按钮已渲染');
  assert.ok(btn.classList.contains('btn-danger'), '危险样式');
  assert.ok(btn.textContent.includes('注销账户'), '按钮文案');
  delete globalThis.fetch;
  delete globalThis.document; delete globalThis.window;
  delete globalThis.localStorage; delete globalThis.sessionStorage; delete globalThis.MutationObserver;
});

test('enterAccountSettings：管理员不渲染注销按钮（服务端禁 admin 注销）', async () => {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="account-settings-content"></div></body></html>', { url: 'http://localhost/' });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.sessionStorage = dom.window.sessionStorage;
  globalThis.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return []; } };
  state.user = { id: 8, role: 'admin', username: '管理员' };
  state.authToken = 'tok-admin';
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
  enterAccountSettings();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(dom.window.document.querySelector('[data-action="settings.openDeactivate"]'), null, '管理员无注销按钮');
  delete globalThis.fetch;
  delete globalThis.document; delete globalThis.window;
  delete globalThis.localStorage; delete globalThis.sessionStorage; delete globalThis.MutationObserver;
});

test('openDeactivateModal：弹窗含警告 + 取消/继续按钮，继续走 confirmDeactivateAccount 二次认证', () => {
  const dom = setup();
  openDeactivateModal();
  const modal = dom.window.document.querySelector('.modal');
  assert.ok(modal, '注销弹窗出现');
  assert.ok(modal.textContent.includes('注销后账号将被墓碑化'), '警告文案在弹窗');
  const cancelBtn = modal.querySelector('[data-action="settings.closeModal"]');
  const contBtn = modal.querySelector('[data-action="settings.deactivate"]');
  assert.ok(cancelBtn && contBtn, '取消/继续两按钮在');
  assert.ok(contBtn.classList.contains('btn-danger'), '继续按钮危险样式');
  teardown();
});

// Q-4b-M1：注销成功后必须登出（handleLogout 清态回 landing）——服务端已置 deactivated 拒令牌，
// 本地若停留已登录 UI，陈旧登录态直到下次 API 401 才清（UX 缺陷）。变异：删 handleLogout() → 红。
test('confirmDeactivateAccount：二次认证成功后注销 + 自动登出（Q-4b-M1）', async () => {
  const dom = setup();
  let deactivateCalled = 0, logoutCalled = 0;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.endsWith('/api/auth/re-auth')) return { ok: true, status: 200, json: async () => ({ capToken: 'cap-deact' }) };
    if (u.endsWith('/api/user/deactivate')) { deactivateCalled++; return { ok: true, status: 200, json: async () => ({ ok: true }) }; }
    if (u.endsWith('/api/auth/logout')) { logoutCalled++; return { ok: true, status: 200, json: async () => ({}) }; }
    return { ok: true, status: 200, json: async () => ({}) };
  };
  confirmDeactivateAccount();
  const pw = dom.window.document.getElementById('reauth-password');
  assert.ok(pw, '二次认证密码输入出现');
  pw.value = 'pass123456';
  dom.window.document.querySelector('[data-action="ui.runReAuth"]').click();
  await new Promise(r => setTimeout(r, 100)); // 覆盖 confirm 的 REAUTH_FOCUS_MS=50 聚焦 setTimeout（teardown 前触发，防 document 已删报错）
  assert.equal(deactivateCalled, 1, '注销 API 被调一次');
  assert.equal(logoutCalled, 1, '注销成功后登出 API 被调一次（陈旧登录态根治）');
  assert.equal(state.user, null, '会话 user 清空');
  assert.equal(state.authToken, null, 'authToken 清空');
  delete globalThis.fetch; teardown();
});
