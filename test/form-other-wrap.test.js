/**
 * 需求四十六（2026-08-09）·试课薪资「其他」输入框错位（v0.25.54）
 *
 * 缺陷实证（playwright 真页）：起草浮窗选「其他」后，.form-other-wrap 作为 form-group 的
 * flex 子项（.form-group > div { flex: 1 1 0 }）与 label+下拉同排，被挤成 ~186px 紧贴下拉右侧，
 * 与 .form-other-wrap { margin-top:10px } 的「独立一行」意图相悖（薪资结算/试课薪资两处同病）。
 *
 * 根因：#143 同类——form-group 尾部项不独占整行，与控件同排抢宽/错位。
 * 修复：.form-group > .form-other-wrap { flex-basis: 100%; display: flex }——
 * 独占整行排下拉下方、输入框（form-input flex:1）撑满整行；特异性须压过 .form-group > div 的 flex 简写。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';

const FILES = [
  'constants.js', 'region-data.js', 'app-display.js', 'app-state.js', 'app-api.js',
  'app-datahub.js', 'app-anim.js', 'app-ui.js', 'app-onboard.js', 'app-region.js',
  'app-posts.js', 'app-chat.js', 'app-contracts.js', 'app-chart.js', 'app-admin.js',
  'app-demands.js', 'app-teachers.js', 'app-style.js', 'app-pages.js', 'app-shell.js', 'app-auth.js',
];

function makeCtx() {
  const html = readFileSync('./index.html', 'utf8')
    .replace(/<script src="\/app-[a-z-]+\.js"><\/script>/g, '');
  const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'dangerously' });
  const w = dom.window;
  const ctx = vm.createContext({
    window: w, document: w.document,
    getComputedStyle: w.getComputedStyle.bind(w),
    localStorage: w.localStorage, sessionStorage: w.sessionStorage,
    console: { log() {}, warn() {}, error() {} },
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
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
  vm.runInContext('window.APP_CONSTANTS = globalThis.APP_CONSTANTS;', ctx);
  return { dom, ctx };
}

test('CSS：.form-group > .form-other-wrap 独占整行（flex-basis:100%）且为 flex 容器（输入撑满）', () => {
  const css = readFileSync('./style.css', 'utf8');
  const ruleBody = (css.split('.form-group > .form-other-wrap {')[1] || '').split('}')[0];
  assert.ok(ruleBody.includes('flex-basis: 100%'), '独占整行排下拉下方');
  assert.ok(ruleBody.includes('display: flex'), 'flex 容器（输入框撑满整行）');
  // 特异性必须压过 .form-group > div 的 flex:1 1 0（否则错位复现）——用子组合选择器而非裸类
  assert.ok(css.includes('.form-group > .form-other-wrap'), '选择器含 .form-group 前缀（特异性压制）');
});

test('渲染验证：薪资结算 + 试课薪资两处「其他」展开输入行，toggle 显隐正确', async () => {
  const { ctx } = makeCtx();
  vm.runInContext(`
    state.user = { id: 1, role: 'teacher', username: 'qa_teacher' };
    state.authToken = 'x';
    window.api = async () => ({ demands: [{ id: 1, expected_time: '', subject: '数学', method: 'online', price_min: 100, price_max: 120 }] });
  `, ctx);
  // 直接渲染浮窗，检查两处结构
  await vm.runInContext('openContractDraftModal(7);', ctx);
  const out = vm.runInContext(`
    const payWrap = document.getElementById('contract-pay-method-other-wrap');
    const trialWrap = document.getElementById('contract-trial-pay-other-wrap');
    // 默认选中非 other → 两行都隐藏
    const hiddenDefault = payWrap.classList.contains('hidden') && trialWrap.classList.contains('hidden');
    // 选「其他」→ 各自展开、对方隐藏
    document.getElementById('contract-trial-pay').value = 'other';
    contractToggleOther('contract-trial-pay', 'contract-trial-pay-other-wrap');
    const trialShown = !trialWrap.classList.contains('hidden') && payWrap.classList.contains('hidden');
    const inputInWrap = trialWrap.querySelector('#contract-trial-pay-other') !== null;
    // 输入框在 wrap 内、wrap 在 form-group 内（独占整行的 flex 子项）
    const wrapInFg = trialWrap.closest('.form-group') === document.getElementById('contract-trial-pay').closest('.form-group');
    ({ hiddenDefault, trialShown, inputInWrap, wrapInFg })
  `, ctx);
  assert.equal(out.hiddenDefault, true, '默认（非 other）两处输入行均隐藏');
  assert.equal(out.trialShown, true, '选「其他」后试课薪资输入行展开、薪资结算行仍隐藏');
  assert.equal(out.inputInWrap, true, '输入框在 wrap 内');
  assert.equal(out.wrapInFg, true, 'wrap 与下拉同属一个 form-group（独占整行）');
});
