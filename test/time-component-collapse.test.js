/**
 * 需求七·第143条 + 需求四十四（2026-08-08）·起草合同时间组件布局（v0.25.50 / v0.25.52）
 *
 * #143（v0.25.50）缺陷实证（playwright 真页复现）：起草/签约浮窗的 schedule form-group 是 flex-wrap
 * 容器，时间组件后紧跟的灰字提示行（flex:0 1 auto、basis=内容宽 ~309px）与 label+时间控件同排，
 * 抢掉控件宽度 → 时间控件只剩 ~63px → .time-range 塌成 0、.time-hms 0px → 时/分输入框叠字。
 * 根因两处：① 尾部提示未走独占整行接口；② .time-hms 显式 min-width:0 允许输入组塌到 0。
 *
 * #144（v0.25.52）：该提示行（「选择每周可授课时间段（可多段）；切换需求自动预填」）与
 * 「+ 新建时间段」文案重复，用户要求删除。删除后时间控件天然独占剩余宽（无抢宽同排元素），
 * .time-hms 内容下限防线保留（任何窄容器下输入框不塌零）。
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

test('.time-hms 不再 min-width:0（时/分输入组有内容下限，永不塌零叠字）', () => {
  const css = readFileSync('./style.css', 'utf8');
  const ruleBody = (css.split('.time-hms {')[1] || '').split('}')[0];
  assert.ok(!ruleBody.includes('min-width: 0'), 'hms 不显式 min-width:0（默认 min-width:auto 内容下限）');
});

// v0.25.96（用户反馈「时间栏纵向格外高」）：通用空态撑高 min-height:40px 泄漏进时间栏内整点下拉
// （特判只盖 padding/背景，漏 min-height）→ 时间栏从 ~36px 撑到 ~52px。特判必须显式 min-height:0
test('时间栏内整点下拉覆盖通用 min-height 撑高（通用撑高不泄漏进时间组件）', () => {
  const css = readFileSync('./style.css', 'utf8');
  const ruleBody = (css.split('.time-field .time-picker .custom-select-trigger {')[1] || '').split('}')[0];
  assert.ok(ruleBody.includes('min-height: 0'), '时间栏内 trigger 显式 min-height:0（覆盖通用 40px 撑高，防叠加）');
});

test('需求四十四：签约/起草 schedule 提示行已删（无抢宽同排元素），死接口 .form-group-note 已拔', () => {
  const contracts = readFileSync('./app-contracts.js', 'utf8');
  const css = readFileSync('./style.css', 'utf8');
  const constants = readFileSync('./constants.js', 'utf8');
  // 提示行整行删除
  assert.ok(!contracts.includes('SIGNING_TIME_HINT'), '签约浮窗不再渲染 schedule 提示行');
  assert.ok(!contracts.includes('CONTRACT_TIME_HINT'), '起草浮窗不再渲染 schedule 提示行');
  assert.ok(!contracts.includes('form-group-note'), 'JS 不再引用 form-group-note');
  // 常量删净
  assert.ok(!constants.includes("SIGNING_TIME_HINT:"), 'SIGNING_TIME_HINT 常量已删');
  assert.ok(!constants.includes("CONTRACT_TIME_HINT:"), 'CONTRACT_TIME_HINT 常量已删');
  // 死 CSS 接口连根拔
  assert.ok(!css.includes('.form-group-note'), 'CSS 无残留 form-group-note 选择器');
});

test('渲染验证：签约/起草 schedule form-group 里时间控件为最后一项，无尾部提示行', async () => {
  const { ctx } = makeCtx();
  vm.runInContext(`
    state.user = { id: 1, role: 'teacher', username: 'qa_teacher' };
    state.authToken = 'x';
    window.api = async () => ({ demands: [{ id: 1, expected_time: '', subject: '数学', method: 'online', price_min: 100, price_max: 120 }] });
  `, ctx);
  await vm.runInContext('openContractDraftModal(7);', ctx);
  const out = vm.runInContext(`
    const ts = document.getElementById('contract-time-slots');
    const fg = ts.closest('.form-group');
    const children = [...fg.children];
    ({
      lastIsTimeSlots: children[children.length - 1] === ts,
      siblingCount: children.length,
      hasP: children.some(el => el.tagName === 'P'),
    })
  `, ctx);
  assert.equal(out.lastIsTimeSlots, true, '时间控件是 schedule form-group 最后一项（无尾部提示抢宽）');
  assert.equal(out.hasP, false, 'schedule form-group 内无任何 <p> 提示行');
  assert.equal(out.siblingCount, 2, '仅 label + 时间控件两项');
});
