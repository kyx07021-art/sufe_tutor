/**
 * W-5 settings.logout 交互链路回归（B4：直接 import settings ESM）。
 * 覆盖断线修复：confirmLogout 曾为空函数（ACTION_MAP 接线但点击无反应）。
 * 链路：confirmLogout → confirm 弹窗（确认文案 + 取消/退出按钮）→ 点确认 →
 * handleLogout（登出 API + 会话清空 + 弹窗关闭）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { confirmLogout } from '../src/client/features/settings/actions.js';
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
