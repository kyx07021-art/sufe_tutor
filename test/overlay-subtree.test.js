/**
 * 需求三（2026-08-08）·浮窗幽灵下拉栏：组件附属树（v0.25.43）
 *
 * 缺陷实证：浮窗内呼出下拉栏、关浮窗后下拉栏不消失——自定义下拉面板挂 body
 * （v0.19.25 架构债：逃逸 .list-card 玻璃 isolation 裁剪），脱离触发组件的 DOM 子树后
 * 「关父组件」天然不级联；closeModal 只清 #modal-container 内层，body 上的面板还挂着 open 类。
 *
 * 改造：浮窗附属树标准接口（app-anim）——
 *   registerOverlay(host, closeFn, keyEl)  覆盖层组件向宿主登记（同宿主幂等）
 *   closeHostOverlays(host)                宿主关闭前级联关全部子覆盖层
 *   openModal/closeModal 写 #modal-container 前先 closeHostOverlays（关父级联关子）
 *   toggleCustomSelect 打开时若触发子在弹窗内则登记到弹窗容器宿主
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
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
  const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'dangerously' });
  const w = dom.window;
  w.HTMLCanvasElement.prototype.getContext = function () { // jsdom 无 canvas：patch 链式 2d 替身（app-captcha 进 boot FILES 后 vm 测试走到 canvas 路径）
    const mk = () => new Proxy(() => {}, { get: (t, k) => (k === 'canvas' ? {} : mk()), apply: () => mk() });
    return mk();
  };
  const ctx = vm.createContext({
    window: w, document: w.document,
    getComputedStyle: w.getComputedStyle.bind(w),
    localStorage: w.localStorage, sessionStorage: w.sessionStorage,
    console: { log() {}, warn() {}, error() {} },
    fetch: async (url) => ({ ok: true, status: 200, json: async () => ({}) }),
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
  vm.runInContext('window.APP_CONSTANTS = globalThis.APP_CONSTANTS;', ctx);
  return { dom, ctx };
}

// 幽灵下拉复现：浮窗内开下拉 → 关浮窗 → 面板必须随父级联关闭（不再挂 open 类）
test('浮窗内呼出下拉、关浮窗后下拉面板级联关闭（幽灵组件根治）', () => {
  const { ctx } = makeCtx();
  vm.runInContext(`
    openModal({ title: '测试', body: '<select class="form-select" id="demo-sel"><option value="a">A</option><option value="b">B</option></select>' });
    initCustomSelects(document.getElementById('modal-container'));
    const wrap = document.querySelector('#modal-container .custom-select');
    toggleCustomSelect(wrap);
  `, ctx);
  assert.equal(vm.runInContext('document.querySelectorAll(".custom-select-panel.open").length', ctx), 1, '浮窗内下拉已打开');
  vm.runInContext('closeModal()', ctx);
  assert.equal(vm.runInContext('document.querySelectorAll(".custom-select-panel.open").length', ctx), 0, '关浮窗后面板 open 类被级联移除（无幽灵组件）');
});

// 打开状态的下拉在浮窗内容被整窗替换（换弹窗）时同样级联关闭
test('换弹窗（openModal 顶替旧窗）时旧窗内的打开下拉一并级联关闭', () => {
  const { ctx } = makeCtx();
  vm.runInContext(`
    openModal({ title: '旧', body: '<select class="form-select"><option value="a">A</option></select>' });
    initCustomSelects(document.getElementById('modal-container'));
    toggleCustomSelect(document.querySelector('#modal-container .custom-select'));
  `, ctx);
  assert.equal(vm.runInContext('document.querySelectorAll(".custom-select-panel.open").length', ctx), 1, '旧窗下拉已打开');
  vm.runInContext(`openModal({ title: '新', body: '<p>新内容</p>' })`, ctx);
  assert.equal(vm.runInContext('document.querySelectorAll(".custom-select-panel.open").length', ctx), 0, '换窗时旧窗下拉被级联关闭');
});

// 附属树标准接口本身：登记 → 宿主关闭触发；同宿主同 keyEl 幂等
test('附属树接口：registerOverlay 幂等登记、closeHostOverlays 级联关闭子覆盖层', () => {
  const { ctx } = makeCtx();
  vm.runInContext(`
    const host = document.getElementById('modal-container');
    const key = document.createElement('div');
    let fired = 0;
    registerOverlay(host, () => fired++, key);
    registerOverlay(host, () => fired++, key); // 同宿主同 keyEl：幂等不叠加
    closeHostOverlays(host);
  `, ctx);
  assert.equal(vm.runInContext('fired', ctx), 1, '幂等登记后宿主关闭只触发一次');
  vm.runInContext('closeHostOverlays(document.getElementById("modal-container"))', ctx); // 宿主键已删：重复空关不抛、不误关
  assert.equal(vm.runInContext('fired', ctx), 1, '空关不再触发已清登记的覆盖层');
});

// 页面级下拉（非浮窗内）不登记宿主——由全局滚动/点击/Escape 管理，不引入幽灵机制的死角
test('页面级下拉打开不登记宿主（宿主为空），关弹窗不影响页面级下拉', () => {
  const { ctx } = makeCtx();
  vm.runInContext(`
    document.body.insertAdjacentHTML('beforeend', '<select class="form-select" id="page-sel"><option value="a">A</option></select>');
    initCustomSelects(document.body);
    toggleCustomSelect(document.querySelector('#page-sel').closest('.custom-select'));
  `, ctx);
  assert.equal(vm.runInContext('document.querySelectorAll(".custom-select-panel.open").length', ctx), 1, '页面级下拉已打开');
  vm.runInContext('closeModal()', ctx); // 无浮窗，closeModal 空关
  assert.equal(vm.runInContext('document.querySelectorAll(".custom-select-panel.open").length', ctx), 1, '页面级下拉不被弹窗关闭牵连（宿主未登记）');
});
