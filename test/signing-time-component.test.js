/**
 * 需求十三（2026-08-08）·时间组件复用签约链路 + 需求预填时间段（v0.25.35）
 *
 * 需求原文：家长端发起签约复用时间组件（教师资料/需求卡片/签约流程/合同草拟）；
 * 发起时根据需求自动预填时间段。
 *
 * 教师资料/需求表单已用结构化时间组件（app-pages/app-demands），本次把签约流程
 * （openSigningModal）与合同草拟（openContractDraftModal）的自由文本 schedule 输入
 * 换成同一组件；提交时收集 slots 经 DISP.expectedTimeText 格式化为人类可读串
 * （服务端合同文本/气泡显示零改动、旧自由文本兼容）。
 *
 * 本测试覆盖：
 *   - 发起签约弹窗：含 #signing-time-slots 时间组件、无旧 #signing-schedule 文本框；
 *   - prefillSigningTimeSlots：切换需求按 expected_time 预填时间段；
 *   - submitSigning：提交 body.schedule 为格式化人类串（「周一 18:00-20:00」）；
 *   - 合同草拟弹窗：含 #contract-time-slots 时间组件、无旧 #contract-schedule 文本框；
 *   - prefillContractFromDemand：按需求 expected_time 预填时间段（仅未填时）；
 *   - submitContractDraft：提交 body.schedule 为格式化人类串。
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

function makeCtx(record) {
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
    console,
    fetch: async (url, opts = {}) => {
      const s = String(url);
      if (record && (s.includes('/signing') || s === '/api/contracts')) {
        // api() 会把 body 对象 JSON.stringify；此处还原以便断言 schedule
        let parsed = null;
        try { parsed = typeof opts.body === 'string' ? JSON.parse(opts.body) : (opts.body || null); } catch { parsed = null; }
        record.push({ url: s, method: opts.method || 'GET', body: parsed });
      }
      // bindable-demands 返回含 expected_time 的需求（否则下拉无对应 option，设 value 无效）
      if (s.includes('bindable-demands')) return { ok: true, status: 200, json: async () => ({
        demands: [{ id: 5, expected_time: DEMAND_SLOTS }, { id: 7, expected_time: DEMAND_SLOTS }],
      }) };
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
  vm.runInContext('window.APP_CONSTANTS = globalThis.APP_CONSTANTS;', ctx);
  vm.runInContext(`
    function ensureAuth() { return true; }
    state.user = { id: 1, role: 'teacher', username: '甲' };
  `, ctx);
  return { dom, ctx };
}

const DEMAND_SLOTS = JSON.stringify([{ type: 'week', dow: 1, start: '18:00', end: '20:00' }]);

function addSlotRow(ctx, containerId, { dow, sh, sm, eh, em }) {
  vm.runInContext(`
    const c = document.getElementById('${containerId}');
    const btn = c.querySelector('.time-add-btn');
    addTimeSlot(btn);
    const row = c.querySelectorAll('.time-slot')[c.querySelectorAll('.time-slot').length - 1];
    row.querySelector('.slot-dow').value = '${dow}';
    const st = row.querySelector('[data-time-role="start"]');
    st.querySelector('.slot-time-hh').value = '${sh}'; st.querySelector('.slot-time-mm').value = '${sm}';
    const en = row.querySelector('[data-time-role="end"]');
    en.querySelector('.slot-time-hh').value = '${eh}'; en.querySelector('.slot-time-mm').value = '${em}';
  `, ctx);
}

test('发起签约弹窗：含结构化时间组件、无旧自由文本 schedule 输入', async () => {
  const { ctx, dom } = makeCtx();
  const doc = dom.window.document;
  await vm.runInContext('openSigningModal(1)', ctx);
  assert.ok(doc.querySelector('#signing-time-slots'), '签约弹窗含时间组件容器');
  assert.ok(doc.querySelector('#signing-time-slots .time-add-btn'), '含「+ 新建时间段」');
  assert.equal(doc.querySelector('#signing-schedule'), null, '旧自由文本 schedule 输入已移除');
});

test('prefillSigningTimeSlots：切换需求按 expected_time 预填时间段', async () => {
  const { ctx, dom } = makeCtx();
  const doc = dom.window.document;
  await vm.runInContext('openSigningModal(1)', ctx);
  vm.runInContext(`
    window._signingDemands = [{ id: 5, expected_time: ${JSON.stringify(DEMAND_SLOTS)} }];
    document.getElementById('signing-demand').value = '5';
    prefillSigningTimeSlots();
  `, ctx);
  assert.equal(doc.querySelectorAll('#signing-time-slots .time-slot').length, 1, '按需求预填 1 条时间段');
  assert.equal(doc.querySelector('#signing-time-slots .slot-dow').value, '1', '预填星期 周一');
  assert.equal(doc.querySelector('#signing-time-slots [data-time-role="start"] .slot-time-hh').value, '18', '预填开始 18');
  // 用户已手动添加后切换需求 → 不覆盖（仅空容器预填）
  vm.runInContext('document.getElementById("signing-demand").value = "5"; prefillSigningTimeSlots()', ctx);
  assert.equal(doc.querySelectorAll('#signing-time-slots .time-slot').length, 1, '已填时不重复预填');
});

test('submitSigning：提交 body.schedule 为格式化人类串', async () => {
  const record = [];
  const { ctx } = makeCtx(record);
  await vm.runInContext('openSigningModal(1)', ctx);
  vm.runInContext(`
    window._signingDemands = [{ id: 5, expected_time: ${JSON.stringify(DEMAND_SLOTS)} }];
    document.getElementById('signing-demand').value = '5';
    document.getElementById('signing-price').value = '150';
    document.getElementById('signing-method').value = 'online';
    prefillSigningTimeSlots();
  `, ctx);
  await vm.runInContext('submitSigning(1)', ctx);
  assert.equal(record.length, 1, 'POST /signing 发出');
  assert.equal(record[0].body.schedule, '周一 18:00-20:00', 'schedule 为人类可读格式化串');
});

test('合同草拟弹窗：含结构化时间组件、无旧自由文本 schedule 输入', async () => {
  const { ctx, dom } = makeCtx();
  const doc = dom.window.document;
  await vm.runInContext('openContractDraftModal(1)', ctx);
  assert.ok(doc.querySelector('#contract-time-slots'), '草拟弹窗含时间组件容器');
  assert.equal(doc.querySelector('#contract-schedule'), null, '旧自由文本 schedule 输入已移除');
});

test('prefillContractFromDemand：按需求 expected_time 预填（仅未填时）', async () => {
  const { ctx, dom } = makeCtx();
  const doc = dom.window.document;
  await vm.runInContext('openContractDraftModal(1)', ctx);
  vm.runInContext(`
    window._contractDraftDemands = [{ id: 7, expected_time: ${JSON.stringify(DEMAND_SLOTS)} }];
    document.getElementById('contract-demand').value = '7';
    prefillContractFromDemand();
  `, ctx);
  assert.equal(doc.querySelectorAll('#contract-time-slots .time-slot').length, 1, '草拟按需求预填 1 条时间段');
  assert.equal(doc.querySelector('#contract-time-slots .slot-dow').value, '1', '预填星期 周一');
});

test('submitContractDraft：提交 body.schedule 为格式化人类串', async () => {
  const record = [];
  const { ctx } = makeCtx(record);
  await vm.runInContext('openContractDraftModal(1)', ctx);
  vm.runInContext(`
    window._contractDraftDemands = [{ id: 7, expected_time: ${JSON.stringify(DEMAND_SLOTS)} }];
    document.getElementById('contract-demand').value = '7';
    document.getElementById('contract-rate').value = '200';
    document.getElementById('contract-location').value = '线上';
    document.getElementById('post-body').value = '补基础';
    prefillContractFromDemand();
  `, ctx);
  await vm.runInContext('submitContractDraft(1)', ctx);
  assert.equal(record.length, 1, 'POST /api/contracts 发出');
  assert.equal(record[0].body.schedule, '周一 18:00-20:00', 'schedule 为人类可读格式化串');
});
