/**
 * Q-4b-M2：settings 头像修改后 state.user + 侧栏同步（原陈旧到下次登录）。
 * 服务端改持久层成功但客户端 state.user 不刷新 → 侧栏/设置行陈旧（接口形状不对称）。
 * 变异：删 renderSidebar()/state.user 赋值 → 红。
 *
 * AK-A1b：用户名改动的 reauth+captcha 用例已删（依赖已移除的 POST /api/captcha/verify 端点；
 * 旧 v2 前端登录会话流随该端点失效，归 NJ 合并期清理）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { saveAvatar, bindUiScaleSlider } from '../src/client/features/settings/actions.js';
import { state } from '../src/client/core/state.js';

function canvasStub() {
  const o = {};
  const mk = () => new Proxy(function () {}, {
    get: (t, k) => (k in o ? o[k] : mk()),
    set: (t, k, v) => { o[k] = v; return true; },
    apply: () => mk(),
  });
  return mk();
}

function setup(extraBody = '') {
  const dom = new JSDOM(`<!DOCTYPE html><html><body><div id="modal-container"></div><div id="sidebar-user"></div>${extraBody}</body></html>`, { url: 'http://localhost/', pretendToBeVisual: true });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.sessionStorage = dom.window.sessionStorage;
  globalThis.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return []; } };
  dom.window.HTMLCanvasElement.prototype.getContext = canvasStub;
  state.user = { id: 5, role: 'student', username: '旧名', avatar: '' };
  state.authToken = 'tok-u';
  return dom;
}
function teardown() {
  delete globalThis.document; delete globalThis.window;
  delete globalThis.localStorage; delete globalThis.sessionStorage; delete globalThis.MutationObserver;
}

test('改头像成功后 state.user.avatar 更新 + 侧栏重渲染（Q-4b-M2）', async () => {
  const dom = setup();
  const dataUrl = 'data:image/png;base64,AAA';
  globalThis.window._avatarDataUrl = dataUrl;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/api/user/avatar')) return { ok: true, status: 200, json: async () => ({ ok: true }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  saveAvatar();
  await new Promise(r => setTimeout(r, 30));
  assert.equal(state.user.avatar, dataUrl, 'state.user.avatar 已更新');
  assert.ok(dom.window.document.getElementById('sidebar-user').textContent.includes('旧名'), '侧栏重渲染保留用户名');
  delete globalThis.fetch; teardown();
});

test('Q-4b-M3：re-enter settings 页 window 监听只注册一次（原累积泄漏）', async () => {
  const dom = setup('<div id="account-settings-content"></div>');
  let uiScaleCount = 0;
  const origAdd = dom.window.addEventListener.bind(dom.window);
  dom.window.addEventListener = (t, fn, opts) => { if (t === 'sufe:ui-scale') uiScaleCount++; return origAdd(t, fn, opts); };
  const render = () => {
    dom.window.document.getElementById('account-settings-content').innerHTML = '<input type="range" id="ui-scale-slider" min="80" max="130" step="1" value="100"><span id="ui-scale-val">100%</span>';
    bindUiScaleSlider();
  };
  render(); // 首次进入（slider1 绑定）
  render(); // re-enter 重建 slider2 再绑定
  assert.equal(uiScaleCount, 1, 'window 监听只注册一次（不随 re-enter 累积）');
  // 触发 UI 缩放事件 → 当前 slider 显示同步（现查元素，不闭包游离旧 slider）
  dom.window.dispatchEvent(new dom.window.Event('sufe:ui-scale'));
  const valEl = dom.window.document.getElementById('ui-scale-val');
  assert.ok(valEl && valEl.textContent.includes('%'), '缩放同步仍在工作');
  delete globalThis.fetch; teardown();
});
