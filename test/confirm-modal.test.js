/**
 * v0.25.10 反馈 #82 回归：弹窗底层组件统一 ——
 *   - confirm() 普通二次确认：表头直坐弹窗顶端（.modal-header 不再挂独立 glass 层）、
 *     正文用 .confirm-msg、确认按钮触发闭包 onConfirm 并关窗；
 *   - confirm({ needReAuth: true })：密码重认证换 capToken（mock /api/auth/re-auth）后
 *     onConfirm(capToken) 执行并关窗；
 *   - 表头不再有独立玻璃条（反馈 #82：去独占一层组件的表头）。
 *
 * 沙箱细节同 onboarding-tour.test.js：vm 沙箱函数桥接到 jsdom window（copy-all），
 * 内联 onclick（runPendingConfirm/runReAuth/closeModal）在 window 作用域解析。
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

const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));

function makeCtx({ reauthToken = 'CAP_OK' } = {}) {
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
  const ctx = vm.createContext({
    window: w, document: w.document,
    getComputedStyle: w.getComputedStyle.bind(w),
    localStorage: w.localStorage, sessionStorage: w.sessionStorage,
    console,
    fetch: async (url, opts = {}) => {
      const u = String(url);
      if (u === '/api/auth/re-auth') return { ok: true, status: 200, json: async () => ({ capToken: reauthToken }) };
      return { ok: true, status: 200, json: async () => ({}) };
    },
    setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval,
    Request: globalThis.Request, AbortController: globalThis.AbortController,
    performance: globalThis.performance,
    MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
    Image: class { set src(v) { this._s = v; } },
    requestAnimationFrame: (cb) => setTimeout(cb, 16), cancelAnimationFrame: () => {},
    matchMedia: () => ({ matches: false, addEventListener: () => {} }),
  });
  for (const f of FILES) vm.runInContext(readFileSync('./' + f, 'utf8'), ctx, { filename: f });
  vm.runInContext(`if (typeof openCaptchaModal === 'function') { const _ocm = openCaptchaModal; openCaptchaModal = (o) => { if (o && o.onPass) o.onPass(); }; }`, ctx); // vm 测试直通拼图（生产走真验证）
  // 桥接全部沙箱全局到 jsdom window（真实浏览器 <script> 顶层函数天然挂 window）
  vm.runInContext(`
    Object.keys(globalThis).forEach(function (k) {
      if (typeof globalThis[k] === 'function' && typeof window[k] !== 'function') {
        try { window[k] = globalThis[k]; } catch (e) {}
      }
    });
  `, ctx);
  return { dom, ctx };
}

async function setup(ctx) {
  vm.runInContext(`try { localStorage.setItem('sufe_returning', '1'); } catch (e) {}`, ctx);
  await tick(30);
  vm.runInContext(`state.user = { role: 'student', id: 1, username: 's', avatar: '' }; renderSidebar(); showView('client');`, ctx);
}

test('confirm() 普通二次确认：表头无独立玻璃层、confirm-msg 正文、确认触发闭包并关窗', async () => {
  const { dom, ctx } = makeCtx();
  const doc = dom.window.document;
  await setup(ctx);
  vm.runInContext(`window.__fired = 0;`, ctx);
  vm.runInContext(`confirm({ title: '删除确认', message: '真的要删吗', onConfirm: () => { window.__fired++; } })`, ctx);
  const overlay = doc.querySelector('#modal-container .modal-overlay');
  assert.ok(overlay, '弹窗打开');
  const h = doc.querySelector('#modal-container .modal-header');
  assert.ok(h, '表头在位');
  assert.equal(h.textContent.includes('删除确认'), true, '表头标题文案');
  assert.equal(h.classList.contains('glass'), false, '反馈 #82：表头不再独占玻璃层');
  assert.ok(doc.querySelector('#modal-container .confirm-msg'), '正文用 .confirm-msg 类');
  const btns = [...doc.querySelectorAll('#modal-container .modal-footer .btn')];
  const confirmBtn = btns.find(b => b.textContent === '确定');
  assert.ok(confirmBtn, '确认按钮在位（文案 UI.BTN_CONFIRM）');
  confirmBtn.click();
  await tick();
  assert.equal(vm.runInContext('window.__fired', ctx), 1, 'onConfirm 闭包已执行');
  assert.equal(doc.querySelector('#modal-container .modal-overlay'), null, '确认后弹窗关闭');
});

test('confirm({ needReAuth: true })：密码换 capToken 后 onConfirm(capToken) 并关窗', async () => {
  const { dom, ctx } = makeCtx({ reauthToken: 'CAP_TOKEN_1' });
  const doc = dom.window.document;
  await setup(ctx);
  vm.runInContext(`window.__got = null;`, ctx);
  vm.runInContext(`confirm({ message: '危险操作', needReAuth: true, onConfirm: (cap) => { window.__got = cap; } })`, ctx);
  const input = doc.getElementById('reauth-password');
  assert.ok(input, '密码输入框在位');
  assert.equal(doc.querySelector('#modal-container .modal-header'), null, 'needReAuth 确认无表头（title null）');
  input.value = 'secret';
  const btns = [...doc.querySelectorAll('#modal-container .modal-footer .btn')];
  btns.find(b => b.textContent === '确定').click();
  await tick(40);
  assert.equal(vm.runInContext('window.__got', ctx), 'CAP_TOKEN_1', 'onConfirm 收到后端 capToken');
  assert.equal(doc.querySelector('#modal-container .modal-overlay'), null, '成功后弹窗关闭');
});

test('confirm() 密码错误（403）：就地提示不关窗不执行动作', async () => {
  const dom = new JSDOM(readFileSync('./index.html', 'utf8')
    .replace(/<script src="\/app-[a-z-]+\.js"><\/script>/g, ''), {
    url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'dangerously',
  });
  const w = dom.window;
  w.HTMLCanvasElement.prototype.getContext = function () { // jsdom 无 canvas：patch 链式 2d 替身（app-captcha 进 boot FILES 后 vm 测试走到 canvas 路径）
    const mk = () => new Proxy(() => {}, { get: (t, k) => (k === 'canvas' ? {} : mk()), apply: () => mk() });
    return mk();
  };
  const ctx = vm.createContext({
    window: w, document: w.document,
    getComputedStyle: w.getComputedStyle.bind(w),
    localStorage: w.localStorage, sessionStorage: w.sessionStorage,
    console,
    fetch: async (url, opts = {}) => {
      const u = String(url);
      if (u === '/api/auth/re-auth') {
        return { ok: false, status: 403, json: async () => ({ message: '密码错误' }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    },
    setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval,
    Request: globalThis.Request, AbortController: globalThis.AbortController,
    performance: globalThis.performance,
    MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
    Image: class { set src(v) { this._s = v; } },
    requestAnimationFrame: (cb) => setTimeout(cb, 16), cancelAnimationFrame: () => {},
    matchMedia: () => ({ matches: false, addEventListener: () => {} }),
  });
  for (const f of FILES) vm.runInContext(readFileSync('./' + f, 'utf8'), ctx, { filename: f });
  vm.runInContext(`if (typeof openCaptchaModal === 'function') { const _ocm = openCaptchaModal; openCaptchaModal = (o) => { if (o && o.onPass) o.onPass(); }; }`, ctx); // vm 测试直通拼图（生产走真验证）
  vm.runInContext(`
    Object.keys(globalThis).forEach(function (k) {
      if (typeof globalThis[k] === 'function' && typeof window[k] !== 'function') {
        try { window[k] = globalThis[k]; } catch (e) {}
      }
    });
  `, ctx);
  const doc = dom.window.document;
  await setup(ctx);
  vm.runInContext(`window.__got = null;`, ctx);
  vm.runInContext(`confirm({ message: '危险操作', needReAuth: true, onConfirm: (cap) => { window.__got = cap; } })`, ctx);
  doc.getElementById('reauth-password').value = 'wrong';
  const btns = [...doc.querySelectorAll('#modal-container .modal-footer .btn')];
  btns.find(b => b.textContent === '确定').click();
  await tick(40);
  assert.equal(vm.runInContext('window.__got', ctx), null, '密码错不执行动作');
  assert.ok(doc.querySelector('#modal-container .modal-overlay'), '密码错弹窗不关');
  const errEl = doc.getElementById('reauth-err');
  assert.equal(errEl.classList.contains('hidden'), false, '就地提示密码错误（hidden 类已移除）'); // v0.25.19 审计 G-12：显隐走 .hidden 类（原 style.display='block'）
  assert.ok(errEl.textContent.length > 0, '错误文案非空');
});
