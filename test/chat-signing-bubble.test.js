/**
 * 需求十一（2026-08-08）·会话内签约提醒框重构（v0.25.33）
 *
 * 需求原文：细长一条改为对应用户的大气泡，风格统一。
 *
 * 改动：signing_request / signing_response 气泡从「居中细系统条」（chat-msg--system /
 * chat-bubble--system）改为「对应用户一侧的大气泡」——发起方/回应方一侧对齐 + 普通消息
 * 同皮肤（chat-bubble--mine/theirs 引擎 tokens）。contract 事件气泡保留居中系统条
 * （非交互通知，作为有意例外）。
 *
 * 本测试覆盖：
 *   - signing_request：我发起 → chat-msg--mine / chat-bubble--mine；对方发起 → theirs；
 *     均不再使用 system 条类；卡片内容与操作按钮保留；
 *   - signing_response：sender=回应方 → 对齐回应方一侧（mine/theirs 按查看者视角）；
 *   - #150（v0.25.58）：已签约请求气泡底下渲染「已与对方确认签约 + 起草合同」提示卡
 *     （终态模板渲染；chatInjectSignCaption 在途注入幂等、纯数字 id 防选择器注入）；
 *   - contract 事件气泡：仍为居中系统条（有意例外，非交互通知）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
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
    console, fetch: globalThis.fetch, setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout, setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval, Request: globalThis.Request,
    MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
    Image: class { set src(v) { this._s = v; } },
    requestAnimationFrame: (cb) => setTimeout(cb, 16), cancelAnimationFrame: () => {},
    matchMedia: () => ({ matches: false, addEventListener: () => {} }),
  });
  for (const f of FILES) vm.runInContext(readFileSync('./' + f, 'utf8'), ctx, { filename: f });
  vm.runInContext('window.APP_CONSTANTS = globalThis.APP_CONSTANTS;', ctx);
  return { dom, ctx };
}

function render(ctx, msg) {
  return vm.runInContext(`renderChatBubble(${JSON.stringify(msg)}, 0)`, ctx);
}

test('signing_request：我发起 → mine 侧大气泡（非居中系统条），卡片与按钮保留', () => {
  const { ctx } = makeCtx();
  vm.runInContext(`state.user = { id: 1, role: 'teacher', username: '甲' }`, ctx);
  const html = render(ctx, {
    kind: 'signing_request', sender_user_id: 1, id: 11, created_at: '2026-08-08 12:00:00',
    body: JSON.stringify({ id: '5', price: 150, schedule: '每周六晚', method: 'offline', status: 'pending' }),
  });
  assert.ok(html.includes('chat-msg--mine'), '发起方气泡对齐右侧（mine）');
  assert.ok(html.includes('chat-bubble--mine'), '发起方气泡用普通消息 mine 皮肤');
  assert.ok(html.includes('signing-bubble'), '签约卡片保留');
  assert.ok(html.includes('signing-bubble-row'), '报价/时间/方式信息行保留');
  assert.ok(!html.includes('signing-bubble-actions'), '发起方自己看不到确认/拒绝按钮（仅接收方可操作）');
  assert.ok(!html.includes('chat-msg--system') && !html.includes('chat-bubble--system'),
    '不再使用居中系统条样式');
});

test('signing_request：对方发起 → theirs 侧大气泡；接收方可确认/拒绝', () => {
  const { ctx } = makeCtx();
  vm.runInContext(`state.user = { id: 1, role: 'teacher', username: '甲' }`, ctx);
  const html = render(ctx, {
    kind: 'signing_request', sender_user_id: 2, id: 12, created_at: '2026-08-08 12:00:00',
    body: JSON.stringify({ id: '6', price: 200, schedule: '周六下午', method: 'online', status: 'pending' }),
  });
  assert.ok(html.includes('chat-msg--theirs'), '接收方气泡对齐左侧（theirs）');
  assert.ok(html.includes('chat-bubble--theirs'), '接收方气泡用普通消息 theirs 皮肤');
  assert.ok(html.includes('respondSigning(6, true)') && html.includes('respondSigning(6, false)'),
    '接收方可确认/拒绝');
});

test('signing_response：sender=回应方 → 按查看者视角对齐回应方一侧', () => {
  const { ctx } = makeCtx();
  vm.runInContext(`state.user = { id: 1, role: 'teacher', username: '甲' }`, ctx);
  // 我（id=1）是回应方 → mine
  const mine = render(ctx, { kind: 'signing_response', sender_user_id: 1, id: 13, created_at: '2026-08-08 12:00:00', body: JSON.stringify({ accept: true }) });
  assert.ok(mine.includes('chat-msg--mine') && mine.includes('chat-bubble--mine'), '回应方本人视角：右侧气泡');
  // 对方（id=2）是回应方 → theirs
  const theirs = render(ctx, { kind: 'signing_response', sender_user_id: 2, id: 14, created_at: '2026-08-08 12:00:00', body: JSON.stringify({ reject: true }) });
  assert.ok(theirs.includes('chat-msg--theirs') && theirs.includes('chat-bubble--theirs'), '发起方视角：回应方气泡在左侧');
  assert.ok(!theirs.includes('chat-bubble--system'), '回应气泡不再用系统条');
});

test('R8 签约确认后：提示合并进请求气泡内部（status=signed），拒绝态不渲染（v0.25.87）', () => {
  const { ctx } = makeCtx();
  vm.runInContext(`state.user = { id: 1, role: 'teacher', username: '甲' }`, ctx);
  // 已确认签约：status 区显示「已与对方确认签约」+ 气泡内「起草合同」按钮 + funds 声明一体
  const signed = render(ctx, {
    kind: 'signing_request', sender_user_id: 2, id: 16, created_at: '2026-08-08 12:00:00',
    body: JSON.stringify({ id: '7', price: 150, schedule: '每周六晚', method: 'offline', status: 'signed' }),
  });
  assert.ok(!signed.includes('signing-bubble-caption'), '独立灰色小组件已废除（R8：合并进气泡内）');
  assert.ok(signed.includes('已与对方确认签约'), 'status 区显示签约提示文案（单源 UI.CHAT_SIGN_TIP）');
  assert.ok(signed.includes('onclick="chatPlusDraft()"'), '气泡内「起草合同」直达按钮');
  assert.ok(signed.includes('signing-bubble-funds'), '平台费用声明仍在气泡内（已签约提醒一体）');
  assert.ok(signed.includes('signing-bubble--done'), '气泡整体变灰（终态）');
  // 已拒绝：只显示拒绝终态小灰字，无起草按钮
  const rejected = render(ctx, {
    kind: 'signing_request', sender_user_id: 2, id: 17, created_at: '2026-08-08 12:00:00',
    body: JSON.stringify({ id: '8', price: 150, schedule: '每周六晚', method: 'offline', status: 'rejected' }),
  });
  assert.ok(!rejected.includes('chatPlusDraft()'), '拒绝态无起草按钮');
  assert.ok(!rejected.includes('已与对方确认签约'), '拒绝态无签约提示文案');
});

test('R8 chatInjectSignCaption：配对 data-signing-id 气泡内挂「起草合同」按钮且幂等、防选择器注入（v0.25.87）', () => {
  const { ctx, dom } = makeCtx();
  vm.runInContext(`state.user = { id: 1, role: 'teacher', username: '甲' }`, ctx);
  const html = render(ctx, {
    kind: 'signing_request', sender_user_id: 2, id: 18, created_at: '2026-08-08 12:00:00',
    body: JSON.stringify({ id: '9', price: 150, schedule: '每周六晚', method: 'offline', status: 'pending' }),
  });
  const box = dom.window.document.createElement('div');
  box.innerHTML = html;
  dom.window.document.body.appendChild(box);
  vm.runInContext(`chatInjectSignCaption('9')`, ctx);
  const btns = [...box.querySelectorAll('.signing-bubble-actions button')];
  const draftBtn = btns.find(b => b.textContent === vm.runInContext('UI.CHAT_BTN_DRAFT_CONTRACT', ctx));
  assert.ok(draftBtn, '注入后气泡内出现「起草合同」按钮');
  assert.equal(btns.filter(b => b.textContent === vm.runInContext('UI.CHAT_BTN_DRAFT_CONTRACT', ctx)).length, 1, '幂等：不重复注入起草按钮');
  vm.runInContext(`chatInjectSignCaption('abc')`, ctx);
  assert.equal(btns.filter(b => b.textContent === vm.runInContext('UI.CHAT_BTN_DRAFT_CONTRACT', ctx)).length, 1, '非纯数字 id 拒绝注入（防选择器注入）');
});

test('contract 事件气泡：对应用户一侧普通气泡（R3：不再居中系统条）', () => {
  const { ctx } = makeCtx();
  vm.runInContext(`state.user = { id: 1, role: 'teacher', username: '甲' }`, ctx);
  // 起草方（mine）：右侧普通气泡，非居中系统条
  const mine = render(ctx, { kind: 'contract', sender_user_id: 1, id: 15, created_at: '2026-08-08 12:00:00', body: '' });
  assert.ok(mine.includes('chat-msg--mine') && mine.includes('chat-bubble--mine'),
    '起草方合同消息走右侧用户气泡');
  assert.ok(!mine.includes('chat-msg--system') && !mine.includes('chat-bubble--system'),
    '不再居中系统条（v0.25.87 R3 用户反馈：融入消息流）');
  // 接收方（theirs）：左侧普通气泡
  const theirs = render(ctx, { kind: 'contract', sender_user_id: 2, id: 16, created_at: '2026-08-08 12:00:00', body: '' });
  assert.ok(theirs.includes('chat-msg--theirs') && theirs.includes('chat-bubble--theirs'),
    '接收方合同消息走左侧用户气泡');
});
