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
 *   - #150（v0.25.58）→ v0.25.94（用户反馈「删了重构」）：已签约请求气泡底部钉死为
 *     「合并提示文案（UI.CHAT_SIGN_TIP 已并入资金声明）+ 左右撑满气泡的起草合同按钮」；
 *     独立 funds 小字废除（并入提示）；拒绝态保留 funds + 拒绝文案 + 整泡变灰；
 *     chatInjectSignCaption 在途注入幂等、纯数字 id 防选择器注入；
 *   - contract 事件气泡：对应用户一侧普通气泡（R3，不再居中系统条）。
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
    console, crypto: globalThis.crypto, fetch: globalThis.fetch, setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout, setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval, Request: globalThis.Request,
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
  // v0.25.101 Q9：与合同提示统一呼吸样式（用户质询「提示之间亦有区别吗」）
  assert.ok(mine.includes('chat-bubble--breathe'), '回应气泡带呼吸遮罩（与合同提示统一）');
  assert.ok(theirs.includes('chat-bubble--breathe'), '对方视角回应气泡同样带呼吸');
});

test('v0.25.101 Q8 回归：回应气泡统一「对方已确认/已拒绝」（回退 v0.25.95 username 注入）', () => {
  const { ctx } = makeCtx();
  vm.runInContext(`state.user = { id: 1, role: 'teacher', username: '甲' }`, ctx);
  // 对方（id=2）是回应方 → theirs 气泡「对方已确认签约请求」（不带用户名，Q8 用户质询）
  const theirs = render(ctx, { kind: 'signing_response', sender_user_id: 2, id: 14, created_at: '2026-08-08 12:00:00', body: JSON.stringify({ requestId: 14, accept: true }) });
  assert.ok(theirs.includes('对方已确认签约请求'), '确认气泡统一「对方」，不显示具体用户名');
  assert.ok(!theirs.includes('乙') && !theirs.includes('{name}'), '无 username / 未替换 {name} 字面量');
  const theirsRej = render(ctx, { kind: 'signing_response', sender_user_id: 2, id: 15, created_at: '2026-08-08 12:00:00', body: JSON.stringify({ requestId: 15, accept: false }) });
  assert.ok(theirsRej.includes('对方已拒绝此次签约请求'), '拒绝气泡统一「对方」');
  assert.ok(!theirsRej.includes('乙'), '拒绝气泡不带用户名');
  // 我（id=1）是回应方 → mine 恒「你已…」（视角修正，无 {name}）
  const mine = render(ctx, { kind: 'signing_response', sender_user_id: 1, id: 16, created_at: '2026-08-08 12:00:00', body: JSON.stringify({ requestId: 16, accept: true }) });
  assert.ok(mine.includes('你已确认签约请求'), '回应方本人视角仍为「你已确认签约请求」');
  assert.ok(!mine.includes('{name}'), 'mine 侧无 {name} 字面量');
});

test('v0.25.101 Q5 回归：签约请求气泡各状态恒挂 chat-bubble--breathe（与合同气泡同一种底层样式）', () => {
  const { ctx } = makeCtx();
  vm.runInContext(`state.user = { id: 1, role: 'teacher', username: '甲' }`, ctx);
  // pending 待处理：恒有呼吸
  const pending = render(ctx, {
    kind: 'signing_request', sender_user_id: 2, id: 21, created_at: '2026-08-08 12:00:00',
    body: JSON.stringify({ id: '5', price: 150, schedule: '每周六晚', method: 'offline', status: 'pending' }),
  });
  assert.ok(pending.includes('chat-bubble--breathe'), 'pending 态挂呼吸');
  // signed 已确认：恒有呼吸（与合同气泡统一，不再按状态条件引用——Q5 用户质询「没有引用同一种底层样式」）
  const signed = render(ctx, {
    kind: 'signing_request', sender_user_id: 2, id: 22, created_at: '2026-08-08 12:00:00',
    body: JSON.stringify({ id: '6', price: 150, schedule: '每周六晚', method: 'offline', status: 'signed' }),
  });
  assert.ok(signed.includes('chat-bubble--breathe'), 'signed 态也挂呼吸（统一底层样式）');
  // rejected 已拒绝：恒有呼吸（拒绝灰化仍保留统一呼吸）
  const rejected = render(ctx, {
    kind: 'signing_request', sender_user_id: 2, id: 23, created_at: '2026-08-08 12:00:00',
    body: JSON.stringify({ id: '7', price: 150, schedule: '每周六晚', method: 'offline', status: 'rejected' }),
  });
  assert.ok(rejected.includes('chat-bubble--breathe'), 'rejected 态也挂呼吸（统一底层样式）');
  assert.ok(rejected.includes('signing-bubble--done'), '拒绝态仍整泡变灰（呼吸与灰化不冲突）');
  // signing_response 回应：恒有呼吸（Q9）
  const resp = render(ctx, {
    kind: 'signing_response', sender_user_id: 2, id: 24, created_at: '2026-08-08 12:00:00',
    body: JSON.stringify({ accept: true }),
  });
  assert.ok(resp.includes('chat-bubble--breathe'), '回应气泡挂呼吸（统一底层样式）');
});

test('R8/v0.25.94 签约确认后：合并提示 + 撑满气泡的起草按钮；拒绝态保留 funds（v0.25.94 重构）', () => {
  const { ctx } = makeCtx();
  vm.runInContext(`state.user = { id: 1, role: 'teacher', username: '甲' }`, ctx);
  // 已确认签约：底部 = 合并提示文案（含资金声明）+ 撑满气泡的「起草合同」按钮；独立 funds 已并入提示
  const signed = render(ctx, {
    kind: 'signing_request', sender_user_id: 2, id: 16, created_at: '2026-08-08 12:00:00',
    body: JSON.stringify({ id: '7', price: 150, schedule: '每周六晚', method: 'offline', status: 'signed' }),
  });
  assert.ok(!signed.includes('signing-bubble-caption'), '独立灰色小组件已废除（R8：合并进气泡内）');
  assert.ok(signed.includes('双方已确认签约'), '合并提示文案（单源 UI.CHAT_SIGN_TIP）');
  assert.ok(signed.includes('平台不代收代付，课费请与对方协商后站外结算'), '资金声明并入提示文案');
  assert.ok(signed.includes('signing-bubble-signed-tip'), '提示走 signed-tip 类');
  assert.ok(signed.includes('signing-bubble-draft-btn'), '起草按钮走撑满气泡类');
  assert.ok(signed.includes('onclick="chatPlusDraft()"'), '起草合同直达按钮');
  assert.ok(!signed.includes('signing-bubble-funds'), '独立 funds 小字已并入提示（signed 态不再渲染）');
  assert.ok(!signed.includes('signing-bubble--done'), '签约确认态不降透明（起草按钮须完整可见可点）');
  // 已拒绝：拒绝文案 + funds + 整泡变灰；无起草按钮、无签约提示
  const rejected = render(ctx, {
    kind: 'signing_request', sender_user_id: 2, id: 17, created_at: '2026-08-08 12:00:00',
    body: JSON.stringify({ id: '8', price: 150, schedule: '每周六晚', method: 'offline', status: 'rejected' }),
  });
  assert.ok(!rejected.includes('chatPlusDraft()'), '拒绝态无起草按钮');
  assert.ok(rejected.includes(JSON.parse(vm.runInContext('JSON.stringify(UI.SIGNING_REJECTED_TEXT)', ctx))), '拒绝态显示拒绝文案');
  assert.ok(rejected.includes('signing-bubble-funds'), '拒绝态保留资金声明');
  assert.ok(rejected.includes('signing-bubble--done'), '拒绝态整泡变灰');
});

test('R8/v0.25.94 chatInjectSignCaption：就地重建底部（合并提示 + 撑满起草按钮）且幂等、防选择器注入', () => {
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
  const draftBtn = box.querySelector('.signing-bubble-draft-btn');
  assert.ok(draftBtn, '注入后气泡内出现撑满类「起草合同」按钮');
  assert.equal(draftBtn.textContent, vm.runInContext('UI.CHAT_BTN_DRAFT_CONTRACT', ctx), '按钮文案单源');
  const tip = box.querySelector('.signing-bubble-signed-tip');
  assert.ok(tip && tip.textContent.includes('平台不代收代付'), '提示文案含合并资金声明（单源 UI.CHAT_SIGN_TIP）');
  assert.ok(!box.querySelector('.signing-bubble-funds'), '注入后独立 funds 已删（并入提示）');
  assert.equal(box.querySelectorAll('.signing-bubble-draft-btn').length, 1, '幂等：不重复注入起草按钮');
  vm.runInContext(`chatInjectSignCaption('abc')`, ctx);
  assert.equal(box.querySelectorAll('.signing-bubble-draft-btn').length, 1, '非纯数字 id 拒绝注入（防选择器注入）');
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
