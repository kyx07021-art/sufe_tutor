/**
 * 需求四（2026-08-08）·平台不走资金声明（v0.25.44）
 *
 * 用户要求：平台仅信息撮合与契约留档、自行站外联系交易，须在合同条款、签约提示、平台介绍、
 * 新手导引等位置以「用户一定能注意到且符合平台调性」的方式明确注明，撇清平台资金责任。
 *
 * 触点清单（本测试全量锁死，防漏抄）：
 *   1. 合同条款（server/contract.js 第二条·4）：平台不参与结算、不代收代付、站外结算、不担责
 *   2. 签约提示（发起签约浮窗）：报价资金触点 `.funds-note`
 *   3. 起草合同浮窗：时薪资金触点 `.funds-note`
 *   4. 签约请求气泡（聊天窗）：短版资金声明 `.signing-bubble-funds`
 *   5. 平台介绍（关于页「我们是谁」卡内醒目分块）：ABOUT_FUNDS_TITLE/ABOUT_FUNDS_TEXT
 *   6. 新手导引（首访政策浮窗）：ONBOARD_POLICY 追加资金条
 *   7. 样式：.funds-note / .about-funds（弱纸面 + 平台色左缘条，非警告色，用户必见不惊扰）
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

test('文案单源：FUNDS_NOTE（全文）/ FUNDS_NOTE_SHORT（短文）/ 关于页声明 / 新手导引条齐备且语义一致', () => {
  const { ctx } = makeCtx();
  const note = vm.runInContext('UI.FUNDS_NOTE', ctx);
  assert.ok(note.includes('信息撮合'), '全文声明含撮合');
  assert.ok(note.includes('合同存证'), '全文声明含存证');
  assert.ok(note.includes('不参与任何费用结算'), '不参与费用结算');
  assert.ok(note.includes('站外直接结算'), '站外直接结算');
  assert.ok(note.includes('不代收、不代付'), '不代收代付');
  const short = vm.runInContext('UI.FUNDS_NOTE_SHORT', ctx);
  assert.ok(short.includes('不参与费用结算') && short.includes('站外直接结算'), '短文同口径');
  const aboutTitle = vm.runInContext('UI.ABOUT_FUNDS_TITLE', ctx);
  const aboutText = vm.runInContext('UI.ABOUT_FUNDS_TEXT', ctx);
  assert.ok(aboutTitle && aboutText, '关于页资金分块文案存在');
  assert.ok(aboutText.includes('不参与任何费用结算'), '关于页不参与结算');
  assert.ok(aboutText.includes('请勿向平台支付任何费用'), '明确请勿向平台付款');
  // 新手导引：政策列表保持精简（≤4 条，早前需求约束），资金声明以独立 funds-note 行呈现于首访浮窗
  const policy = vm.runInContext('UI.ONBOARD_POLICY', ctx);
  assert.ok(policy.length <= 4, '政策列表保持精简');
  const onboard = readFileSync('./app-onboard.js', 'utf8');
  assert.ok(onboard.includes('funds-note onboard-funds'), '首访浮窗渲染资金声明行');
  assert.ok(onboard.includes('UI.FUNDS_NOTE_SHORT'), '首访浮窗资金声明引用短版单源文案');
});

test('签约提示 + 起草合同浮窗：资金触点明示（.funds-note），服务端合同条款撇清平台资金责任', () => {
  const contracts = readFileSync('./app-contracts.js', 'utf8');
  const n = (contracts.match(/<p class="funds-note">\$\{UI\.FUNDS_NOTE\}<\/p>/g) || []).length;
  assert.ok(n >= 2, `签约浮窗 + 起草合同浮窗各一处（实际 ${n}）`);
  const server = readFileSync('./src/server/domains/contract/api.js', 'utf8'); // V-1-4c：合同实体已迁入 contract/api.js，server/contract.js 仅为兼容 shim
  assert.ok(server.includes('不参与任何费用结算'), '合同条款声明不参与结算');
  assert.ok(server.includes('不代收、不代付'), '合同条款声明不代收代付');
  assert.ok(server.includes('站外自行协商并直接结算'), '合同条款要求站外直接结算');
  assert.ok(server.includes('不对站外资金往来承担任何责任'), '合同条款撇清资金责任');
});

test('签约请求气泡 + 关于页：短声明与小节就位', () => {
  const chat = readFileSync('./app-chat.js', 'utf8');
  assert.ok(chat.includes('signing-bubble-funds'), '聊天签约气泡底部短声明');
  assert.ok(chat.includes('UI.FUNDS_NOTE_SHORT'), '气泡短声明引用单源文案');
  const pages = readFileSync('./app-pages.js', 'utf8');
  assert.ok(pages.includes('UI.ABOUT_FUNDS_TITLE'), '关于页资金小节标题');
  assert.ok(pages.includes('UI.ABOUT_FUNDS_TEXT'), '关于页资金小节正文');
  const css = readFileSync('./style.css', 'utf8');
  assert.ok(css.includes('.funds-note {'), '浮窗资金声明样式');
  assert.ok(css.includes('.about-funds {'), '关于页资金分块样式');
  const chatCss = readFileSync('./style-chat.css', 'utf8');
  assert.ok(chatCss.includes('.signing-bubble-funds {'), '气泡短声明样式');
});

// 关于页真实渲染：我们是谁卡内出现「关于费用」分块
test('关于页渲染：我们是谁卡内资金分块可见', () => {
  const { ctx } = makeCtx();
  vm.runInContext(`
    state.user = { id: 1, role: 'student', username: 'me' };
    document.body.innerHTML = '<div id="about-content"></div><div id="about-page-title"></div>';
    enterAbout();
  `, ctx);
  const html = vm.runInContext('document.getElementById("about-content").innerHTML', ctx);
  assert.ok(html.includes('about-funds'), '关于页渲染资金分块');
  assert.ok(html.includes('关于费用'), '分块标题');
  assert.ok(html.includes('请勿向平台支付任何费用'), '分块正文');
});
