/**
 * R26（v0.25.91）：需求大厅「已建立联系→」点击直接切到对应会话页
 * B4：直接 import student feature ESM + chat 域 ESM（chat-conv-lifecycle 同款模式）。
 *
 * 覆盖：按钮 data-action 委托带学生 id；goChatWithStudent 三分支（在列表且停会话页 → 就地开；
 * 不在会话页 → 设待开目标并切页；找不到会话 → toast 兜底）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderDemandCard } from '../src/client/features/student/render.js';
import { goChatWithStudent, loadConversations, stopChatPolling } from '../src/client/features/chat/actions-list.js';
import { chat } from '../src/client/features/chat/chat-state.js';
import { state } from '../src/client/core/state.js';
import { stopVersionProbe } from '../src/client/core/datahub.js';
import { TEXT } from '../src/client/constants/text.js';

const BASE_CONV = {
  id: 5, student_user_id: 9, teacher_user_id: 40, status: 'active',
  student_name: '学生甲', teacher_name: '教师乙', student_avatar: '', teacher_avatar: '',
  unread_count: 0, created_at: '2026-08-07 00:00:00',
  last_kind: 'text', last_body: '你好', last_at: '2026-08-07 12:00:00', last_sender: 9,
};

function setup() {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="my-chats-list"></div><div id="chat-frame"></div><div id="toast-container"></div></body></html>', { url: 'http://localhost/' });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.sessionStorage = dom.window.sessionStorage;
  state.user = { id: 40, role: 'teacher', username: '教师乙' };
  state.page = 'my-chats';
  chat.convId = null; chat.list = []; chat.pendingOpen = null; chat.lastMsgId = 0;
  return dom;
}
function teardown() {
  stopChatPolling();
  stopVersionProbe();
  chat.convId = null; chat.list = []; chat.pendingOpen = null;
  delete globalThis.fetch;
  delete globalThis.document; delete globalThis.window;
  delete globalThis.localStorage; delete globalThis.sessionStorage;
  state.user = null; state.page = null;
}
const msgsUrl = id => new RegExp(`/api/conversations/${id}/messages(\\?sinceId=\\d+)?$`);

test('R26 需求卡：已建立联系→按钮可点击，data-action 带学生 id，无 disabled', () => {
  const html = renderDemandCard({
    id: 2, display_id: 7, target_type: 'academic', target_subjects: ['math'], student_grade: 'senior1',
    student_gender: 'female', province: 'shanghai', budget_min: 100, budget_max: 200,
    current_scores: [], teaching_method: 'offline', expected_time: '', status: 'open',
    username: '学生A', avatar: '', created_at: '2026-08-07 04:27:09',
    user_id: 9, my_intent_status: 'accepted',
  }, { teacher: true });
  assert.ok(html.includes('data-action="student.goChat" data-id="9"'), '按钮带学生 id（委托）');
  assert.ok(html.includes('已建立联系'), '文案为「已建立联系 →」');
  assert.ok(!html.includes(' disabled'), '不再静态禁用');
});

test('R26 goChatWithStudent：会话在列表且停在会话页 → 就地打开', async () => {
  const dom = setup();
  chat.list = [BASE_CONV];
  globalThis.fetch = async url => {
    if (msgsUrl(5).test(String(url))) return { ok: true, status: 200, json: async () => ({ messages: [] }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  goChatWithStudent(9);
  await new Promise(r => setTimeout(r, 0));
  assert.equal(chat.convId, 5, '直接打开目标会话');
  assert.equal(chat.pendingOpen, null, '未设待开目标');
  teardown();
});

test('R26 goChatWithStudent：不在会话页 → 设待开目标并切页', () => {
  const dom = setup();
  state.page = 'browse-demands';
  chat.list = [BASE_CONV];
  goChatWithStudent(9);
  assert.equal(state.page, 'my-chats', '切到会话页');
  assert.equal(chat.pendingOpen, 9, '设待开学生目标');
  teardown();
});

test('R26 loadConversations 后自动打开待开会话；找不到 → toast 兜底', async () => {
  const dom = setup();
  // 目标存在 → 打开
  chat.pendingOpen = 9;
  globalThis.fetch = async url => {
    const u = String(url);
    if (u === '/api/conversations') return { ok: true, status: 200, json: async () => ({ conversations: [BASE_CONV] }) };
    if (msgsUrl(5).test(u)) return { ok: true, status: 200, json: async () => ({ messages: [] }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  await loadConversations();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(chat.pendingOpen, null, '待开目标已消费');
  assert.equal(chat.convId, 5, '列表就绪后自动打开');
  teardown();

  // 找不到会话 → toast 兜底
  const dom2 = setup();
  chat.pendingOpen = 42;
  globalThis.fetch = async url => {
    const u = String(url);
    if (u === '/api/conversations') return { ok: true, status: 200, json: async () => ({ conversations: [BASE_CONV] }) };
    if (msgsUrl(5).test(u)) return { ok: true, status: 200, json: async () => ({ messages: [] }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  await loadConversations();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(chat.pendingOpen, null, '待开目标已消费');
  assert.equal(chat.convId, null, '无会话可开');
  assert.ok(dom2.window.document.getElementById('toast-container').textContent.includes(TEXT.CHAT_CONV_NOT_FOUND), '找不到会话 toast');
  teardown();
});
