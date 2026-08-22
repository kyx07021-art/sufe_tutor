/**
 * 会话与需求/签约解耦 + 绑定需求下拉（B4：直接 import chat/contract ESM）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderChatFrame, renderConvItem } from '../src/client/features/chat/render.js';
import { openContractDraftModal, submitContractDraft } from '../src/client/features/contract/actions-draft.js';
import { state } from '../src/client/core/state.js';

function setup() {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="modal-container"></div><div id="toast-container"></div></body></html>', { url: 'http://localhost/' });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return []; } };
  state.user = { id: 39, role: 'student' };
  return dom;
}
function teardown() { delete globalThis.document; delete globalThis.window; delete globalThis.MutationObserver; }

const baseConv = (extra = {}) => ({
  id: 1, student_user_id: 39, teacher_user_id: 40, demand_id: 7, status: 'active',
  student_name: '学生A', teacher_name: '教师B', student_avatar: '', teacher_avatar: '',
  contracted: true, demand_display_id: 7,
  last_kind: 'text', last_body: '你好', last_at: '2026-08-07 00:00:00', created_at: '2026-08-07 00:00:00',
  unread_count: 0, last_sender: 40, ...extra,
});

test('renderChatFrame：不再含需求编号/「已签约」tag，也无独立提示卡（#150 并入气泡）', () => {
  const html = renderChatFrame(baseConv());
  assert.ok(!html.includes('需求 #'), '会话头不得显示需求编号');
  assert.ok(!html.includes('chat-head-demand'), '不得渲染 .chat-head-demand');
  assert.ok(!html.includes('chat-head-signed'), '不得渲染 .chat-head-signed');
  assert.ok(!html.includes('已签约'), '会话头不得显示「已签约」tag');
  assert.ok(!html.includes('chat-sign-tip'), '不得再渲染独立提示卡（.chat-sign-tip 已删）');
  assert.ok(!html.includes('chat-sign-text'), '提示卡文案元素已随卡片移除');
});

test('renderChatFrame：open 会话 = 头部（对方名+身份+资料按钮）+ 拖放提示 + 输入区', () => {
  const html = renderChatFrame(baseConv());
  assert.ok(html.includes('chat-head-main'), '头部主体在');
  assert.ok(html.includes('chat-peer-name'), '对方名在');
  assert.ok(html.includes('chat-peer-tag'), '身份 tag 在');
  assert.ok(html.includes('data-action="chat.openProfile"'), '对方资料按钮在');
  assert.ok(html.includes('id="chat-drop-hint"') && html.includes('松开加入发送'), '拖放提示元素在');
  assert.ok(html.includes('id="chat-input"'), '输入框在');
  assert.ok(html.includes('id="chat-send-btn"'), '发送按钮在');
  assert.ok(html.includes('id="chat-plus-wrap"'), '加号弹层在');
  assert.ok(!html.includes('chat-input-bar--closed'), 'open 会话无 closed 变体');
  assert.ok(!/onclick=/.test(html) && !/style=/.test(html), '零内联 handler/样式');
});

test('renderChatFrame：closed 会话输入区换成结束提示条（v1 chat-input-bar--closed parity）', () => {
  const html = renderChatFrame(baseConv({ status: 'closed' }));
  assert.ok(html.includes('chat-input-bar--closed'), 'closed 变体类在');
  assert.ok(html.includes('chat-closed-tip'), '结束提示条在');
  assert.ok(html.includes('会话已结束'), '提示文案在');
  assert.ok(!html.includes('id="chat-input"'), '无输入框');
  assert.ok(!html.includes('id="chat-send-btn"'), '无发送按钮');
});

test('renderConvItem：会话列表项不再含「已签约」tag', () => {
  const html = renderConvItem(baseConv());
  assert.ok(!html.includes('conv-signed-tag'), '会话项不得渲染 .conv-signed-tag');
  assert.ok(!html.includes('已签约'), '会话项不得含「已签约」文字');
});

test('openContractDraftModal：S5 独立合同不绑需求——不再请求 bindable-demands，无 contract-demand 下拉', async () => {
  const dom = setup();
  let demanded = false;
  globalThis.fetch = async url => { if (String(url).includes('bindable-demands')) demanded = true; return { ok: true, status: 200, json: async () => ({ demands: [] }) }; };
  await openContractDraftModal(1);
  assert.equal(demanded, false, 'S5 起草不再请求 bindable-demands（合同不绑需求）');
  const modal = dom.window.document.getElementById('modal-container').innerHTML;
  assert.equal(dom.window.document.getElementById('contract-demand'), null, '无 contract-demand 下拉');
  assert.ok(modal.includes('contract-form'), '合同表单在');
  assert.ok(dom.window.document.getElementById('contract-rate'), '合同字段（时薪）在');
  delete globalThis.fetch; teardown();
});

test('submitContractDraft：S5 无绑定模型——无需求门禁，直接 POST /api/contracts 且不带 demandId', async () => {
  const dom = setup();
  let posted = null;
  globalThis.fetch = async (url, opts) => {
    if (opts && opts.method === 'POST') posted = { url: String(url), body: JSON.parse(opts.body) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  dom.window.document.getElementById('modal-container').innerHTML = `
    <div class="modal"><div class="modal-body">
      <input id="contract-rate" value="150"><select id="contract-method"><option value="online">线上</option></select>
      <select id="contract-pay-method"><option value="per_session">次付</option></select><div id="contract-pay-method-other-wrap" class="hidden"></div>
      <select id="contract-trial-pay"><option value="first_free">首次免费</option></select><div id="contract-trial-pay-other-wrap" class="hidden"></div>
      <div id="contract-first-lesson-field"></div>
      <textarea id="post-body">补基础</textarea>
      <input id="contract-location" value="线上">
      <div id="contract-time-slots" class="time-slots"></div>
    </div></div>`;
  await submitContractDraft(1);
  assert.ok(posted, 'S5 起草无需求绑定校验，直接 POST');
  assert.equal(posted.url, '/api/contracts');
  assert.equal(posted.body.conversationId, 1, '携带会话上下文');
  assert.equal('demandId' in posted.body, false, '请求体不含 demandId');
  delete globalThis.fetch; teardown();
});
