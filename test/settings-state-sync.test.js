/**
 * Q-4b-M2：settings 用户名/头像修改后 state.user + 侧栏同步（原陈旧到下次登录）。
 * 服务端改持久层成功但客户端 state.user 不刷新 → 侧栏/设置行陈旧（接口形状不对称）。
 * 变异：删 renderSidebar()/state.user 赋值 → 红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { submitUsername, saveAvatar } from '../src/client/features/settings/actions.js';
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

test('改用户名成功后 state.user.username 更新 + 侧栏重渲染（Q-4b-M2，含 reauth + captcha 全链路）', async () => {
  const dom = setup('<input id="new-username" value="新名字">');
  const realRandom = Math.random;
  Math.random = () => 0; // captcha target 确定（16/240），pointer 拖到 17px 命中容差
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.endsWith('/api/auth/re-auth')) return { ok: true, status: 200, json: async () => ({ capToken: 'cap-u' }) };
    if (u.endsWith('/api/captcha/verify')) return { ok: true, status: 200, json: async () => ({ ok: true }) };
    if (u.endsWith('/api/user/username')) return { ok: true, status: 200, json: async () => ({ ok: true }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  submitUsername();
  const pw = dom.window.document.getElementById('reauth-password');
  assert.ok(pw, '二次认证弹窗出现');
  pw.value = 'pass123456';
  dom.window.document.querySelector('[data-action="ui.runReAuth"]').click();
  await new Promise(r => setTimeout(r, 30));
  const knob = dom.window.document.getElementById('captcha-knob');
  assert.ok(knob, 'captcha 弹窗出现');
  knob.setPointerCapture = () => {};
  const pointer = (el, type, x = 0) => el.dispatchEvent(new dom.window.PointerEvent(type, { bubbles: true, clientX: x, pointerId: 1 }));
  pointer(knob, 'pointerdown', 0);
  pointer(knob, 'pointermove', 17);
  pointer(knob, 'pointerup', 17);
  await new Promise(r => setTimeout(r, 340)); // captcha onPass 延迟 260ms + 缓冲
  assert.equal(state.user.username, '新名字', 'state.user.username 已更新');
  assert.ok(dom.window.document.getElementById('sidebar-user').textContent.includes('新名字'), '侧栏已重渲染新名');
  delete globalThis.fetch; Math.random = realRandom; teardown();
});

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
