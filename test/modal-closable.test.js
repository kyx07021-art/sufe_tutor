/**
 * 需求九（2026-08-08）·标准浮窗「点击界外关闭」配置项（v0.25.31）
 *
 * 审计结论：openModal 的 closable 配置即为「点击界外是否便捷关闭」开关——closable:false 时
 * overlay 不挂点击关闭、✕/取消按钮始终可用。全站表单类浮窗盘点后仅两处漏配：
 *   - 需求创建/编辑表单（app-demands.js openDemandModal）——最大型表单，误触丢输入；
 *   - confirm(needReAuth) 重认证（app-ui.js）——密码输入框，误触丢已输入密码。
 * 均已补 closable:false，与发帖/签约/反馈/广播表单同口径。
 *
 * 本测试覆盖：
 *   - openModal 默认（closable 缺省 true）：overlay 挂点遮罩关闭；
 *   - openModal({ closable:false })：overlay 无点遮罩关闭，✕ 仍保留；
 *   - 需求表单弹窗：overlay 无点遮罩关闭（回归漏配修复）；
 *   - confirm 重认证：overlay 无点遮罩关闭；普通确认仍保留点遮罩关闭。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function makeCtx() {
  const html = readFileSync('./index.html', 'utf8')
    .replace(/<script src="\/app-[a-z-]+\.js"><\/script>/g, '');
  const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'dangerously' });
  const w = dom.window;
  const ctx = vm.createContext({
    window: w, document: w.document,
    getComputedStyle: w.getComputedStyle.bind(w),
    localStorage: w.localStorage, sessionStorage: w.sessionStorage,
    console,
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
  const FILES = ['constants.js', 'region-data.js', 'app-display.js', 'app-state.js', 'app-api.js',
    'app-datahub.js', 'app-anim.js', 'app-ui.js', 'app-region.js', 'app-demands.js'];
  for (const f of FILES) vm.runInContext(readFileSync('./' + f, 'utf8'), ctx, { filename: f });
  vm.runInContext('window.APP_CONSTANTS = globalThis.APP_CONSTANTS;', ctx);
  return { dom, ctx };
}

// 取当前 #modal-container 里 overlay 的 onclick（'' = 无点遮罩关闭）
function overlayOnclick(ctx) {
  return vm.runInContext(`document.querySelector('.modal-overlay').getAttribute('onclick') || ''`, ctx);
}

test('openModal 默认（closable 缺省 true）：overlay 挂点遮罩关闭', () => {
  const { ctx } = makeCtx();
  vm.runInContext(`openModal({ title: 't', body: 'b' })`, ctx);
  assert.ok(overlayOnclick(ctx).includes('closeModal()'), '默认应可点遮罩关闭');
});

test('openModal({ closable:false })：overlay 无点遮罩关闭，✕ 仍保留', () => {
  const { ctx } = makeCtx();
  vm.runInContext(`openModal({ title: 't', body: 'b', closable: false })`, ctx);
  assert.equal(overlayOnclick(ctx), '', 'closable:false 不挂点遮罩关闭');
  const hasCloseBtn = vm.runInContext(`document.querySelector('.modal-header button[onclick*="closeModal"]') !== null`, ctx);
  assert.ok(hasCloseBtn, '✕ 关闭按钮始终保留');
});

test('需求创建/编辑表单：overlay 无点遮罩关闭（漏配修复回归）', async () => {
  const { ctx } = makeCtx();
  vm.runInContext(`
    state.user = { role: 'student', id: 2, username: 's' };
    document.getElementById('filter-gender'); // noop 防误读
  `, ctx);
  await vm.runInContext(`openDemandModal(null)`, ctx);
  assert.equal(overlayOnclick(ctx), '', '需求表单点遮罩不关（编辑成本高）');
  const hasCancel = vm.runInContext(`document.querySelector('#modal-container').innerHTML.includes('${'取消'}')`, ctx);
  assert.ok(hasCancel, '表单保留取消按钮关闭口');
});

test('confirm 重认证（密码输入）：overlay 无点遮罩关闭；普通确认保留', () => {
  const { ctx } = makeCtx();
  vm.runInContext(`confirm({ message: 'danger', needReAuth: true, onConfirm: () => {} })`, ctx);
  assert.equal(overlayOnclick(ctx), '', '重认证密码框点遮罩不关，防误触丢密码');
  vm.runInContext(`closeModal(); confirm({ message: 'ok', onConfirm: () => {} })`, ctx);
  assert.ok(overlayOnclick(ctx).includes('closeModal()'), '普通确认保留点遮罩快捷关闭');
});
