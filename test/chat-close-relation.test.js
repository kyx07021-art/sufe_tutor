/**
 * AI-9: 结束关系前端适配——closed 态展示（列表/头部「已结束」tag）+ 结束关系入口
 * （danger confirm needReAuth → capToken → POST close → F7 同步）+ 禁写 gate + 403 兜底。
 *
 * 变异守护：删 render 的 tag/按钮条件 → 断言红；删 syncClosedConversation 状态置位 → 红；
 * 删 F6 closeBusy 锁 → 双击双 POST 红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  renderConvItem, renderChatFrame, renderChatBubble,
} from '../src/client/features/chat/render.js';
import { endRelation } from '../src/client/features/chat/actions-misc.js';
import { chatStageFiles as sendStageFiles } from '../src/client/features/chat/actions-send.js';
import { syncClosedConversation, stopChatPolling } from '../src/client/features/chat/actions-list.js';
import { chat, chatClosedNow } from '../src/client/features/chat/chat-state.js';
import { state } from '../src/client/core/state.js';
import { _dhResetForTests, dhGet, dhPeek } from '../src/client/core/datahub.js';
import { TEXT } from '../src/client/constants/text.js';

const BASE_CONV = {
  id: 5, student_user_id: 9, teacher_user_id: 40, status: 'active',
  student_name: '学生甲', teacher_name: '教师乙', student_avatar: '', teacher_avatar: '',
  unread_count: 0, created_at: '2026-08-07 00:00:00',
  last_kind: 'text', last_body: '你好', last_at: '2026-08-07 12:00:00', last_sender: 9,
};

function setup() {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div class="chats-shell"><div class="chats-list-pane"><div id="my-chats-list"></div></div><div class="chat-pane"><div id="chat-frame"></div></div></div><div id="modal-container"></div><div id="toast-container"></div></body></html>', { url: 'http://localhost/' });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.sessionStorage = dom.window.sessionStorage;
  state.user = { id: 40, role: 'teacher', username: '教师乙' };
  state.page = 'my-chats';
  chat.convId = null; chat.list = []; chat.staged = []; chat.lastMsgId = 0;
  chat.sending = false; chat.optimisticSending = false; chat.pollBusy = false; chat.pendingOpen = null;
  _dhResetForTests();
  return dom;
}
function teardown() {
  stopChatPolling();
  chat.convId = null; chat.list = [];
  delete globalThis.fetch;
  delete globalThis.document; delete globalThis.window;
  delete globalThis.localStorage; delete globalThis.sessionStorage;
  state.user = null; state.page = null;
}
const msgsUrl = id => new RegExp(`/api/conversations/${id}/messages(\\?sinceId=\\d+)?$`);

// ---------- 渲染层：closed tag / 结束按钮 / 气泡按钮 ----------

test('renderConvItem：closed 会话渲染「已结束」tag；active 无', () => {
  state.user = { id: 40, role: 'teacher', username: '教师乙' };
  const closedHtml = renderConvItem({ ...BASE_CONV, status: 'closed' });
  assert.ok(closedHtml.includes(TEXT.CHAT_STATUS_CLOSED), 'closed 行含「已结束」tag');
  assert.ok(closedHtml.includes('tag-closed'), 'tag-closed 语义类在');
  const activeHtml = renderConvItem(BASE_CONV);
  assert.ok(!activeHtml.includes(TEXT.CHAT_STATUS_CLOSED), 'active 行无「已结束」tag');
  state.user = null;
});

test('renderChatFrame：active 含结束关系按钮 + 无 closed tag；closed 无按钮 + 有 closed tag + 禁写', () => {
  state.user = { id: 40, role: 'teacher', username: '教师乙' };
  const active = renderChatFrame(BASE_CONV);
  assert.ok(active.includes('chat.endRelation'), 'active 头部含结束关系按钮');
  assert.ok(active.includes(TEXT.CHAT_END_RELATION), '按钮文案在');
  assert.ok(!active.includes('tag-closed'), 'active 无已结束 tag');
  const closed = renderChatFrame({ ...BASE_CONV, status: 'closed' });
  assert.ok(!closed.includes('chat.endRelation'), 'closed 头部无结束关系按钮');
  assert.ok(closed.includes('tag-closed'), 'closed 头部有已结束 tag');
  assert.ok(closed.includes('chat-input-bar--closed'), 'closed 输入栏禁写类在');
  assert.ok(closed.includes(TEXT.CHAT_CLOSED_TIP), 'closed 禁写提示在');
  state.user = null;
});

test('renderSigningRequestBubble：closed 会话已成交签约气泡不渲染起草按钮', () => {
  state.user = { id: 40, role: 'teacher', username: '教师乙' };
  chat.convId = 5;
  const msg = { id: 9, sender_user_id: 9, kind: 'signing_request', body: JSON.stringify({ id: 7, status: 'signed', price: 150, schedule: 'x', method: 'online' }), created_at: '2026-08-07 12:00:00' };
  chat.list = [BASE_CONV]; // active
  assert.ok(renderChatBubble(msg).includes('signing-bubble-draft-btn'), 'active 会话渲染起草按钮');
  chat.list = [{ ...BASE_CONV, status: 'closed' }];
  const html = renderChatBubble(msg);
  assert.ok(!html.includes('signing-bubble-draft-btn'), 'closed 会话隐藏起草按钮（点击恒 403 的入口收口）');
  assert.ok(html.includes('signing-bubble-signed-tip'), '已成交提示仍保留（信息非操作）');
  chat.convId = null; chat.list = [];
  state.user = null;
});

// ---------- 状态层：chatClosedNow / syncClosedConversation ----------

test('chatClosedNow：单点判定当前会话 closed', () => {
  chat.convId = 5; chat.list = [BASE_CONV];
  assert.equal(chatClosedNow(), false, 'active 会话未关闭');
  chat.list = [{ ...BASE_CONV, status: 'closed' }];
  assert.equal(chatClosedNow(), true, 'closed 会话判定关闭');
  chat.convId = null;
  assert.equal(chatClosedNow(), false, '无当前会话不判定关闭');
  chat.list = [];
});

test('syncClosedConversation：本地置 closed + 列表重渲染「已结束」tag', () => {
  const dom = setup();
  chat.list = [{ ...BASE_CONV, status: 'active' }];
  syncClosedConversation(5);
  assert.equal(chat.list[0].status, 'closed', '列表行就地置 closed');
  const html = dom.window.document.getElementById('my-chats-list').innerHTML;
  assert.ok(html.includes(TEXT.CHAT_STATUS_CLOSED), '列表重渲染含已结束 tag');
  // 幂等：再次调用零变化不报错
  syncClosedConversation(5);
  assert.equal(chat.list[0].status, 'closed');
  teardown();
});

// ---------- 禁写 gate ----------

test('chatStageFiles：closed 会话 stage 被拦（toast + staged 空）', () => {
  const dom = setup();
  chat.convId = 5; chat.list = [{ ...BASE_CONV, status: 'closed' }];
  sendStageFiles([{ name: 'a.pdf', type: 'application/pdf', size: 100 }]);
  assert.equal(chat.staged.length, 0, 'closed 会话不 stage');
  assert.ok(dom.window.document.getElementById('toast-container').textContent.includes(TEXT.CHAT_CONV_CLOSED_MSG), '拦截 toast');
  teardown();
});

// ---------- 端到端：endRelation 全链路 ----------

test('endRelation 全链路：reauth → close 成功 → F7（列表置 closed + toast + invalidate 三域）', async () => {
  const dom = setup();
  chat.list = [BASE_CONV];
  chat.convId = 5;
  let closeCalls = 0;
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u === '/api/auth/re-auth') return { ok: true, status: 200, json: async () => ({ capToken: 'cap-1' }) };
    if (u === '/api/conversations/5/close') { closeCalls++; return { ok: true, status: 200, json: async () => ({ ok: true, closed: true }) }; }
    if (msgsUrl(5).test(u)) return { ok: true, status: 200, json: async () => ({ conversation: { ...BASE_CONV, status: 'closed' }, messages: [] }) };
    if (u.includes('/read')) return { ok: true, status: 200, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  // 先让 chat 域缓存有值，验证 invalidate 清空
  await dhGet('/api/conversations', { domain: 'chat' });
  assert.ok(dhPeek('/api/conversations') !== null, '缓存已填充');
  endRelation(5);
  assert.ok(dom.window.document.body.textContent.includes(TEXT.CHAT_END_RELATION_CONFIRM), '危险确认正文在弹窗');
  assert.ok(dom.window.document.querySelector('[data-action="ui.runReAuth"]'), 'needReAuth 二次认证按钮在');
  const pw = document.getElementById('reauth-password');
  pw.value = 'pw';
  document.querySelector('[data-action="ui.runReAuth"]').click();
  await new Promise(r => setTimeout(r, 80));
  assert.equal(closeCalls, 1, 'close 恰一次');
  assert.equal(chat.list[0].status, 'closed', '列表本地置 closed');
  assert.ok(dom.window.document.getElementById('toast-container').textContent.includes(TEXT.CHAT_END_RELATION_DONE), '成功 toast');
  assert.equal(dhPeek('/api/conversations'), null, 'chat 域缓存已失效（F7 即时）');
  const frame = dom.window.document.getElementById('chat-frame');
  assert.ok(frame.innerHTML.includes('chat-input-bar--closed'), '当前会话 frame 重渲染 closed 禁写');
  assert.ok(frame.innerHTML.includes('tag-closed'), 'frame 头部已结束 tag');
  teardown();
});

test('endRelation 幂等：alreadyClosed → 已结束 toast + 仍走 F7 本地同步', async () => {
  const dom = setup();
  chat.list = [BASE_CONV];
  chat.convId = 5;
  let closeCalls = 0;
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u === '/api/auth/re-auth') return { ok: true, status: 200, json: async () => ({ capToken: 'cap-1' }) };
    if (u === '/api/conversations/5/close') { closeCalls++; return { ok: true, status: 200, json: async () => ({ ok: true, alreadyClosed: true }) }; }
    if (msgsUrl(5).test(u)) return { ok: true, status: 200, json: async () => ({ conversation: { ...BASE_CONV, status: 'closed' }, messages: [] }) };
    if (u.includes('/read')) return { ok: true, status: 200, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  endRelation(5);
  document.getElementById('reauth-password').value = 'pw';
  document.querySelector('[data-action="ui.runReAuth"]').click();
  await new Promise(r => setTimeout(r, 80));
  assert.equal(closeCalls, 1);
  assert.equal(chat.list[0].status, 'closed', 'alreadyClosed 仍本地置 closed');
  assert.ok(dom.window.document.getElementById('toast-container').textContent.includes(TEXT.CHAT_END_RELATION_ALREADY), '幂等 toast');
  teardown();
});

test('F6 双击守卫：close 在途时二次 endRelation 不重复 POST', async () => {
  const dom = setup();
  chat.list = [BASE_CONV];
  chat.convId = 5;
  let closeCalls = 0, release;
  const gate = new Promise(res => { release = res; });
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u === '/api/auth/re-auth') return { ok: true, status: 200, json: async () => ({ capToken: 'c1' }) };
    if (u === '/api/conversations/5/close') { closeCalls++; await gate; return { ok: true, status: 200, json: async () => ({ ok: true, closed: true }) }; }
    if (msgsUrl(5).test(u)) return { ok: true, status: 200, json: async () => ({ conversation: { ...BASE_CONV, status: 'closed' }, messages: [] }) };
    if (u.includes('/read')) return { ok: true, status: 200, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const trigger = async () => {
    endRelation(5);
    const pw = document.getElementById('reauth-password');
    if (pw) pw.value = 'pw';
    const btn = document.querySelector('[data-action="ui.runReAuth"]');
    if (btn) btn.click();
    await new Promise(r => setTimeout(r, 15));
  };
  await trigger(); // 第一次：close 挂起（closeBusy=true）
  await trigger(); // 第二次：confirm 重开 + reauth 触发 → F6 锁拦，不重复 POST
  assert.equal(closeCalls, 1, 'close 在途时第二次被 F6 锁拦');
  release();
  await new Promise(r => setTimeout(r, 30));
  teardown();
});
