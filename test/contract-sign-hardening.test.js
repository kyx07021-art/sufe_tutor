/**
 * 需求十（2026-08-08）·签约加固（v0.25.32）
 *
 * 需求原文：「确认签约」→「开始签约」；合同文本必须滚到底+待够30秒（时长constants配置）才能确认；
 * 二次确认；确认后输账户密码最终确认（注释后期改验证码）；合同发起者不自动设为已签约。
 *
 * 客户端流：signContract 打开阅读弹窗（合同全文限高滚动）→ 确认按钮 disabled 直至
 * 「滚动到底 && 待够 CONFIG.CONTRACT_SIGN_READ_SECONDS 秒」双条件 → 点击 → 二次确认
 * → 密码最终确认（needReAuth 换 capToken）→ POST /sign。
 *
 * 本测试覆盖：
 *   - UI.BTN_SIGN 已由「确认签约」改为「开始签约」；
 *   - 阅读弹窗：合同文本渲染、确认按钮初始 disabled、closable:false（点遮罩不关）；
 *   - 解锁条件：仅滚动到底不启用（待够时长）；仅时长到不启用（未滚到底）；双条件齐才启用；
 *   - 短合同（无溢出）视同已到底，但仍须待够时长；
 *   - 确认按钮 → 二次确认 → 密码重认证确认弹窗（含密码输入框）。
 *
 * 服务端 drafter_confirmed=0 见 test/signing-hardening.test.js 新增用例。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const CONTRACT_MD = `# 家教服务合同

第一条 服务内容
...（测试合同正文）

第二条 费用与支付
...`;

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
    'app-datahub.js', 'app-anim.js', 'app-ui.js', 'app-posts.js', 'app-contracts.js'];
  for (const f of FILES) vm.runInContext(readFileSync('./' + f, 'utf8'), ctx, { filename: f });
  vm.runInContext('window.APP_CONSTANTS = globalThis.APP_CONSTANTS;', ctx);
  return { dom, ctx };
}

function seed(ctx, md) {
  vm.runInContext(`
    state.user = { id: 1, role: 'teacher', username: '甲' };
    state.myContracts = [{ id: 7, drafter_user_id: 2, student_user_id: 1, teacher_name: '甲', student_name: '乙',
      method: 'online', hourly_rate: 200, contract_md: ${JSON.stringify(md || CONTRACT_MD)}, status: 'signing',
      drafter_confirmed: 0, other_confirmed: 0 }];
  `, ctx);
}

// 模拟滚动区几何：长合同（有溢出，scrollTop=0 时未到底）
function stubScrollGeom(ctx, { scrollHeight, clientHeight, scrollTop }) {
  vm.runInContext(`(() => {
    const el = document.getElementById('contract-sign-scroll');
    Object.defineProperty(el, 'scrollHeight', { value: ${scrollHeight}, configurable: true });
    Object.defineProperty(el, 'clientHeight', { value: ${clientHeight}, configurable: true });
    Object.defineProperty(el, 'scrollTop', { value: ${scrollTop}, configurable: true, writable: true });
  })()`, ctx);
}

test('UI.BTN_SIGN 由「确认签约」改为「开始签约」（需求原文）', () => {
  const { ctx } = makeCtx();
  assert.equal(vm.runInContext('UI.BTN_SIGN', ctx), '开始签约');
  assert.equal(vm.runInContext('CONFIG.CONTRACT_SIGN_READ_SECONDS', ctx), 30, '时长 constants 配置 = 30s');
});

test('signContract 打开阅读弹窗：合同渲染、确认按钮初始 disabled、点遮罩不关', () => {
  const { ctx, dom } = makeCtx();
  const doc = dom.window.document;
  seed(ctx);
  vm.runInContext('signContract(7)', ctx);
  assert.ok(doc.querySelector('#contract-sign-scroll'), '滚动阅读区存在');
  assert.ok(doc.querySelector('#contract-sign-scroll').textContent.includes('家教服务合同'), '合同全文已渲染');
  assert.ok(doc.querySelector('#contract-sign-btn').disabled, '确认按钮初始 disabled');
  assert.ok(doc.querySelector('#contract-sign-btn').textContent.includes('30秒后可确认签约'),
    'v0.25.94：倒计时在「确认签约」按钮上（初始=满时长），取代按钮标签');
  const overlay = doc.querySelector('.modal-overlay');
  assert.equal(overlay.getAttribute('onclick') || '', '', '阅读弹窗 closable:false（点遮罩不关）');
});

test('v0.25.94 倒计时放回确认按钮：计时中按钮=「N秒后可确认签约」，灰字提示静态不闪', () => {
  const { ctx, dom } = makeCtx();
  const doc = dom.window.document;
  seed(ctx);
  vm.runInContext('signContract(7)', ctx);
  const hint = doc.querySelector('#contract-sign-hint');
  const btn = doc.querySelector('#contract-sign-btn');
  // 计时中：按钮文本 = 动态倒计时（取代按钮标签）；灰字提示 = 静态阅读指引（不含倒计时，不轮番闪）
  vm.runInContext('updateSignBtnState(12)', ctx);
  assert.ok(btn.textContent.includes('12秒后可确认签约'), '计时中按钮文本 = 倒计时');
  assert.ok(btn.disabled, '计时中按钮 disabled');
  assert.equal(hint.textContent, vm.runInContext('UI.SIGN_READ_HINT', ctx), '灰字提示静态阅读指引（无秒数，不闪）');
  assert.ok(!hint.textContent.includes('秒'), '灰字提示不再含倒计时');
  // 时长到但未滚到底：按钮恢复正式标签但仍 disabled；提示仍是静态
  vm.runInContext('window._signingElapsed = true; updateSignBtnState()', ctx);
  assert.equal(btn.textContent, vm.runInContext('UI.SIGN_READ_DONE_BTN', ctx), '时长到按钮恢复「我已阅读并确认签约」');
  assert.ok(btn.disabled, '未滚到底仍 disabled');
  assert.equal(hint.textContent, vm.runInContext('UI.SIGN_READ_HINT', ctx), '未就绪灰字提示静态');
  // 双条件齐：启用 + 提示切换就绪
  vm.runInContext('window._signingScrolled = true; updateSignBtnState()', ctx);
  assert.ok(!btn.disabled, '滚动到底 && 时长到：启用');
  assert.equal(hint.textContent, vm.runInContext('UI.SIGN_READY_HINT', ctx), '就绪灰字提示切换');
});

test('解锁双条件：仅时长到不启用、仅滚到底不启用、双条件齐才启用', async () => {
  const { ctx, dom } = makeCtx();
  const doc = dom.window.document;
  seed(ctx);
  vm.runInContext('signContract(7)', ctx);
  stubScrollGeom(ctx, { scrollHeight: 1000, clientHeight: 200, scrollTop: 0 }); // 长合同，未滚到底

  // ① 仅时长到（_signingElapsed）→ 仍未滚到底 → disabled
  vm.runInContext('window._signingElapsed = true; updateSignBtnState()', ctx);
  assert.ok(doc.querySelector('#contract-sign-btn').disabled, '时长到但未滚到底：仍 disabled');

  // ② 滚到底但时长未到 → disabled
  vm.runInContext('window._signingElapsed = false; window._signingScrolled = true; updateSignBtnState()', ctx);
  assert.ok(doc.querySelector('#contract-sign-btn').disabled, '滚到底但时长未到：仍 disabled');

  // ③ 双条件齐 → enabled
  vm.runInContext('window._signingElapsed = true; updateSignBtnState()', ctx);
  assert.ok(!doc.querySelector('#contract-sign-btn').disabled, '滚动到底 && 待够时长：确认按钮启用');
});

test('onContractSignScroll 滚动判定：触底才置位、未触底不置位', () => {
  const { ctx } = makeCtx();
  seed(ctx);
  vm.runInContext('signContract(7)', ctx);
  stubScrollGeom(ctx, { scrollHeight: 1000, clientHeight: 200, scrollTop: 100 });
  vm.runInContext('onContractSignScroll()', ctx);
  assert.equal(vm.runInContext('window._signingScrolled', ctx), false, '滚动 100/800 未触底');
  stubScrollGeom(ctx, { scrollHeight: 1000, clientHeight: 200, scrollTop: 800 });
  vm.runInContext('onContractSignScroll()', ctx);
  assert.equal(vm.runInContext('window._signingScrolled', ctx), true, '滚动到底 → 触底置位');
});

test('短合同（无溢出）视同已到底，但仍须待够时长', () => {
  const { ctx, dom } = makeCtx();
  const doc = dom.window.document;
  seed(ctx);
  vm.runInContext('signContract(7)', ctx);
  stubScrollGeom(ctx, { scrollHeight: 200, clientHeight: 200, scrollTop: 0 }); // 无溢出
  vm.runInContext('onContractSignScroll()', ctx);
  assert.equal(vm.runInContext('window._signingScrolled', ctx), true, '短合同无溢出视同已到底');
  assert.ok(doc.querySelector('#contract-sign-btn').disabled, '但时长未到仍 disabled（阅读时间不可省）');
});

test('确认按钮 → 二次确认 → 密码最终确认（reauth 密码框）', () => {
  const { ctx, dom } = makeCtx();
  const doc = dom.window.document;
  seed(ctx);
  vm.runInContext('signContract(7)', ctx);
  stubScrollGeom(ctx, { scrollHeight: 200, clientHeight: 200, scrollTop: 0 });
  vm.runInContext('window._signingElapsed = true; updateSignBtnState()', ctx); // 解锁
  vm.runInContext('confirmSignContract()', ctx);
  assert.ok(doc.querySelector('#modal-container').innerHTML.includes(JSON.parse(vm.runInContext('JSON.stringify(UI.CONFIRM_SIGN_TWICE)', ctx))),
    '第一层：二次确认文案');
  // 确认二次确认 → 进入密码最终确认
  vm.runInContext('runPendingConfirm()', ctx);
  assert.ok(doc.querySelector('#reauth-password'), '第二层：密码最终确认输入框');
});
