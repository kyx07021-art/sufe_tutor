/**
 * 需求三十一（2026-08-08）·纯文本浮窗拓宽（v0.25.48）
 *
 * 用户要求：所有单纯呈现文本的浮窗 PC 端拓宽便于阅读；移动端不要过宽。
 * 方案：.modal--wide（max-width 760px，opt-in 类）——base .modal 宽度仍 width:100%，
 * 移动端天然受视口约束（max-width 只提上限，窄屏不触发），不会过宽。
 * 覆盖面：协议/政策浮窗、使用指南、合同查看/签署通读、存证明细、md 预览、模块介绍、管理端全文。
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

test('modal--wide 规则就位：仅提升 max-width（不设 width），移动端受 width:100% 兜底不过宽', () => {
  const css = readFileSync('./style.css', 'utf8');
  const ruleBody = (css.split('#modal-container .modal.modal--wide {')[1] || '').split('}')[0];
  assert.ok(ruleBody.includes('max-width: 760px'), '宽版弹窗 max-width 760px（PC 阅读舒适）');
  assert.ok(!ruleBody.includes('width: 100%'), '只提上限不设显式宽度——窄屏由 base width:100% 兜住（移动不过宽）');
  // base .modal 确认 width:100% 仍在（移动端约束的根基）
  const base = css.split('#modal-container .modal {')[1] || '';
  assert.ok(base.split('}')[0].includes('width: 100%'), 'base 弹窗保持 width:100%');
});

test('文本浮窗全覆盖 modal--wide（政策/使用指南/合同查看/签署通读/存证明细/预览/模块介绍/管理端全文）', () => {
  const ui = readFileSync('./app-ui.js', 'utf8');
  const onboard = readFileSync('./app-onboard.js', 'utf8');
  const contracts = readFileSync('./app-contracts.js', 'utf8');
  const posts = readFileSync('./app-posts.js', 'utf8');
  const shell = readFileSync('./app-shell.js', 'utf8');
  const admin = readFileSync('./app-admin.js', 'utf8');
  // 每处文本浮窗 opt-in 宽版
  assert.ok(ui.includes("cls: 'modal--wide'"), '协议/政策浮窗拓宽');
  assert.ok(onboard.includes("cls: 'modal--wide'"), '使用指南浮窗拓宽');
  assert.ok((contracts.match(/cls: 'modal--wide'/g) || []).length >= 3, '合同查看 + 签署通读 + 存证明细（≥3 处）');
  assert.ok(posts.includes("cls: 'modal--wide'"), 'md 预览浮窗拓宽');
  assert.ok(shell.includes("cls: 'modal--wide'"), '模块介绍浮窗拓宽');
  assert.ok((admin.match(/cls: 'modal--wide'/g) || []).length >= 2, '管理端帖子/合同全文拓宽');
  // 旧专用加宽类已删（统一走标准接口，不留特例）
  assert.ok(!readFileSync('./style.css', 'utf8').includes('.module-info-modal'), 'module-info-modal 死规则已删');
});

test('渲染验证：openModal 带 cls 时宽版类落到 .modal 元素', () => {
  const { ctx } = makeCtx();
  vm.runInContext(`
    localStorage.setItem('sufe_returning', '1');
    closeModal();
    openModal({ title: '宽版测试', cls: 'modal--wide', body: '<p>正文</p>' });
  `, ctx);
  const modalCls = vm.runInContext('document.querySelector("#modal-container .modal").className', ctx);
  assert.ok(modalCls.includes('modal--wide'), '宽版类落到 .modal 元素');
  assert.ok(modalCls.includes('glass'), '玻璃基类不受影响');
});
