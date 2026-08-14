/**
 * 需求十五（2026-08-08）·合同签署合规 UI（v0.25.37，服务端见 contract-sign-compliance.test.js）
 *
 * 覆盖：合同卡签署进度行（甲方/乙方各自已签/待签，drafter 归属映射）、签署弹窗前置告知、
 * 存证校验小面板（当前指纹 + 台账条目 + 逐条时间）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const FILES = ['constants.js', 'region-data.js', 'app-display.js', 'app-state.js', 'app-api.js',
  'app-datahub.js', 'app-anim.js', 'app-ui.js', 'app-posts.js', 'app-contracts.js'];

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
  for (const f of FILES) vm.runInContext(readFileSync('./' + f, 'utf8'), ctx, { filename: f });
  vm.runInContext(`if (typeof openCaptchaModal === 'function') { const _ocm = openCaptchaModal; openCaptchaModal = (o) => { if (o && o.onPass) o.onPass(); }; }`, ctx); // vm 测试直通拼图（生产走真验证）
  vm.runInContext('window.APP_CONSTANTS = globalThis.APP_CONSTANTS;', ctx);
  return { dom, ctx };
}

test('合同卡签署进度：signing 态甲方/乙方各自已签/待签（drafter 归属映射）；signed 态双方已签署', () => {
  const { ctx } = makeCtx();
  // drafter=2=教师：drafter_confirmed=1 → 乙方已签；student=1 未签 → 甲方待签
  vm.runInContext(`
    state.user = { id: 1, role: 'student', username: '乙' };
    state.myContracts = [{ id: 9, drafter_user_id: 2, student_user_id: 1, teacher_user_id: 2,
      teacher_name: '甲', student_name: '乙', method: 'online', hourly_rate: 150,
      contract_md: '', status: 'signing', drafter_confirmed: 1, other_confirmed: 0 }];
  `, ctx);
  const html = vm.runInContext('renderContractCard(state.myContracts[0])', ctx);
  assert.ok(html.includes('甲方待签'), '学生方（甲方）待签');
  assert.ok(html.includes('乙方已签'), '教师方（乙方）已签');
  assert.ok(!html.includes('甲方已签'), '甲方未签不误显');
  // signed 态
  vm.runInContext(`state.myContracts[0].status = 'signed'; state.myContracts[0].drafter_confirmed = 1; state.myContracts[0].other_confirmed = 1`, ctx);
  const sHtml = vm.runInContext('renderContractCard(state.myContracts[0])', ctx);
  assert.ok(sHtml.includes(JSON.parse(vm.runInContext('JSON.stringify(UI.CONTRACT_SIGN_DONE_BOTH)', ctx))), 'signed 显示双方已签署');
});

test('签署弹窗：底部前置告知（平台账号 + 可靠电子签名）', () => {
  const { ctx, dom } = makeCtx();
  const doc = dom.window.document;
  vm.runInContext(`
    state.user = { id: 1, role: 'student', username: '学生乙' };
    state.myContracts = [{ id: 7, drafter_user_id: 2, student_user_id: 1, teacher_user_id: 2,
      teacher_name: '甲', student_name: '乙', method: 'online', hourly_rate: 200,
      contract_md: '# 家教服务合同\\n\\n**甲方**：乙\\n**乙方**：甲', status: 'signing',
      drafter_confirmed: 0, other_confirmed: 0 }];
  `, ctx);
  vm.runInContext('signContract(7)', ctx);
  const disclose = doc.querySelector('.contract-sign-disclose');
  assert.ok(disclose, '前置告知行存在');
  assert.ok(disclose.textContent.includes('学生乙'), '告知含本人平台账号');
  assert.ok(disclose.textContent.includes('可靠'), '告知提及可靠电子签名（合规口径）');
});

test('存证校验小面板：展示当前指纹 + 台账条目 + 逐条时间', async () => {
  const { ctx, dom } = makeCtx();
  const doc = dom.window.document;
  vm.runInContext(`
    api = async (url) => ({
      recorded: true, valid: true, entries: 2, headValid: true, linksValid: true, seqValid: true,
      contentHash: 'abc123def456', entryList: [{ seq: 1, createdAt: '2026-08-08 10:00:00' }, { seq: 2, createdAt: '2026-08-08 10:05:00' }],
    });
  `, ctx);
  await vm.runInContext('verifyContractLedgerUi(1)', ctx);
  assert.ok(doc.querySelector('.contract-verify-verdict'), '校验面板打开');
  assert.ok(doc.querySelector('.contract-verify-verdict').textContent.includes('一致'), '校验结论');
  assert.ok(doc.querySelector('.contract-verify-hash').textContent.includes('abc123def456'), '当前指纹展示');
  assert.ok(doc.querySelectorAll('.contract-verify-entry').length === 2, '逐条台账明细两条');
  assert.ok(doc.querySelector('.contract-verify-entry').textContent.includes('#1'), '条目序号');
});
