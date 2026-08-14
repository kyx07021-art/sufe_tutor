/**
 * R26（v0.25.91）：需求大厅「已建立联系→」点击直接切到对应会话页
 *
 * 改造：已建立联系不再静态禁用——按钮变「已建立联系 →」可点击，按需求学生 id 定位会话：
 *   - 会话已在列表且停在会话页 → 就地 openConversation；
 *   - 否则设 chatPendingOpen（按学生 id）并 selectPage('my-chats')，
 *     loadConversations 列表就绪后自动打开目标会话；
 *   - 找不到会话 → toast 兜底（CHAT_CONV_NOT_FOUND）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function makeCtx() {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
  const w = dom.window;
  return {
    ctx: vm.createContext({
      window: w, document: w.document,
      getComputedStyle: w.getComputedStyle.bind(w),
      localStorage: w.localStorage, sessionStorage: w.sessionStorage,
      console, crypto: globalThis.crypto, fetch: globalThis.fetch, setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout, Request: globalThis.Request,
      MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
    }),
    dom,
  };
}
const FILES = ['constants.js', 'region-data.js', 'app-display.js', 'app-state.js', 'app-api.js',
  'app-datahub.js', 'app-anim.js', 'app-ui.js', 'app-demands.js', 'app-teachers.js', 'app-chat.js'];
function loadCommon(ctx) {
  for (const f of FILES) vm.runInContext(readFileSync('./' + f, 'utf8'), ctx, { filename: f });
  vm.runInContext(`if (typeof openCaptchaModal === 'function') { const _ocm = openCaptchaModal; openCaptchaModal = (o) => { if (o && o.onPass) o.onPass(); }; }`, ctx); // vm 测试直通拼图（生产走真验证）
}
function stubChatGlobals(ctx) {
  vm.runInContext(`
    ensureAuth = () => true;
    setBadge = () => {}; initReveals = () => {};
    lastOpen = null; lastToast = null;
    openConversation = (id) => { lastOpen = id; };
    showToast = (msg) => { lastToast = msg; };
    selectPage = (p) => { lastSelect = p; };
    renderConvList = () => {};
    dhGet = async () => ({ conversations: lastConvs || [] });
  `, ctx);
}

test('R26 需求卡：已建立联系→按钮可点击，onclick 带学生 id，无 disabled', () => {
  const { ctx } = makeCtx();
  loadCommon(ctx);
  const html = vm.runInContext(`renderDemandCard({
    id: 2, display_id: 7, target_type: 'academic', target_subjects: ['math'], student_grade: 'senior1',
    student_gender: 'female', province: 'shanghai', budget_min: 100, budget_max: 200,
    current_scores: [], teaching_method: 'offline', expected_time: '', status: 'open',
    username: '学生A', avatar: '', created_at: '2026-08-07 04:27:09',
    user_id: 9, my_intent_status: 'accepted'
  }, { teacher: true })`, ctx);
  assert.ok(html.includes('onclick="goChatWithStudent(9)'), '按钮带学生 id');
  assert.ok(html.includes(ctx.APP_CONSTANTS.UI.INTENT_ACCEPTED_GO), '文案为「已建立联系 →」');
  assert.ok(!html.includes(' disabled'), '不再静态禁用');
});

test('R26 goChatWithStudent：会话在列表且停在会话页 → 就地打开', async () => {
  const { ctx } = makeCtx();
  loadCommon(ctx); stubChatGlobals(ctx);
  vm.runInContext(`
    state.user = { id: 1, role: 'teacher', username: '甲' };
    state.page = 'my-chats';
    chatConvList = [{ id: 5, student_user_id: 9 }];
    goChatWithStudent(9);
  `, ctx);
  assert.equal(vm.runInContext('lastOpen', ctx), 5, '直接打开目标会话');
  assert.equal(vm.runInContext('chatPendingOpen', ctx), null, '未设待开目标');
});

test('R26 goChatWithStudent：不在会话页 → 设待开目标并切页', async () => {
  const { ctx } = makeCtx();
  loadCommon(ctx); stubChatGlobals(ctx);
  vm.runInContext(`
    state.user = { id: 1, role: 'teacher', username: '甲' };
    state.page = 'browse-demands';
    chatConvList = [{ id: 5, student_user_id: 9 }];
    goChatWithStudent(9);
  `, ctx);
  assert.equal(vm.runInContext('lastSelect', ctx), 'my-chats', '切到会话页');
  assert.equal(vm.runInContext('chatPendingOpen', ctx), 9, '设待开学生目标');
});

test('R26 loadConversations 后自动打开待开会话；找不到 → toast 兜底', async () => {
  const { ctx } = makeCtx();
  loadCommon(ctx); stubChatGlobals(ctx);
  // 目标存在 → 打开
  vm.runInContext(`
    state.user = { id: 1, role: 'teacher', username: '甲' };
    chatPendingOpen = 9; lastConvs = [{ id: 5, student_user_id: 9 }];
    loadConversations();
  `, ctx);
  await new Promise(r => setTimeout(r, 20));
  assert.equal(vm.runInContext('lastOpen', ctx), 5, '列表就绪后自动打开');
  assert.equal(vm.runInContext('chatPendingOpen', ctx), null, '待开目标消费');
  // 找不到会话 → toast
  vm.runInContext(`
    chatPendingOpen = 42; lastConvs = [{ id: 5, student_user_id: 9 }];
    loadConversations();
  `, ctx);
  await new Promise(r => setTimeout(r, 20));
  assert.equal(vm.runInContext('lastToast', ctx), ctx.APP_CONSTANTS.UI.CHAT_CONV_NOT_FOUND, '找不到会话 toast');
});
