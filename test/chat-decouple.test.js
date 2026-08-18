/**
 * 会话与需求/签约解耦 + 绑定需求下拉（B4：直接 import chat/contract ESM）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderChatFrame, renderConvItem } from '../src/client/features/chat/render.js';
import { openSigningModal, openContractDraftModal, doSubmitSigning, submitContractDraft } from '../src/client/features/contract/actions-draft.js';
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

test('openSigningModal：请求 phase=signing 需求，下拉每项含 #编号 · 目标名', async () => {
  const dom = setup();
  let requestedUrl;
  globalThis.fetch = async url => { requestedUrl = String(url); return { ok: true, status: 200, json: async () => ({ demands: [
    { id: 1, user_id: 39, display_id: 7, target_subjects: ['math'], target_type: 'academic', budget_min: 100, budget_max: 200 },
    { id: 2, user_id: 39, display_id: 8, target_subjects: ['english'], target_type: 'academic', budget_min: 0, budget_max: 0 },
  ] }) }; };
  await openSigningModal(1);
  assert.ok(requestedUrl.includes('phase=signing'), '发起签约应请求 signing 阶段需求');
  const sel = dom.window.document.getElementById('signing-demand');
  assert.ok(sel, 'signing-demand select 在 DOM');
  const optTexts = [...sel.options].map(o => o.textContent);
  assert.ok(optTexts.some(t => t.includes('#0007')), '下拉含需求编号 #0007');
  assert.ok(optTexts.some(t => t.includes('数学')), '下拉含目标名（数学）');
  delete globalThis.fetch; teardown();
});

test('openContractDraftModal：请求 phase=contract，含「仅已签约需求」提示，下拉含 #编号', async () => {
  const dom = setup();
  let requestedUrl;
  globalThis.fetch = async url => { requestedUrl = String(url); return { ok: true, status: 200, json: async () => ({ demands: [
    { id: 1, user_id: 39, display_id: 7, target_subjects: ['math'], target_type: 'academic', budget_min: 100, budget_max: 200 },
  ] }) }; };
  await openContractDraftModal(1);
  const modal = dom.window.document.getElementById('modal-container').innerHTML;
  assert.ok(requestedUrl.includes('phase=contract'), '起草合同应请求 contract 阶段需求');
  assert.ok(!modal.includes('contract-demand-hint'), 'U7：外置长提示行已删（并入下拉占位）');
  assert.ok(modal.includes('仅已签约需求可继续签合同'), '下拉占位文案 = 缩短提示');
  const sel = dom.window.document.getElementById('contract-demand');
  assert.ok(sel, 'contract-demand select 在 DOM');
  assert.ok([...sel.options].some(o => o.textContent.includes('#0007')), '下拉含需求编号 #0007');
  assert.ok(![...sel.options].some(o => o.textContent.includes('不关联需求')), '不再提供「不关联需求」空选项');
  delete globalThis.fetch; teardown();
});

test('openContractDraftModal：会话绑定需求不在可绑列表时置空占位（不静默回退首项，v0.25.15 审计修复）', async () => {
  const dom = setup();
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ demands: [
    { id: 1, user_id: 39, display_id: 7, target_subjects: ['math'], target_type: 'academic', budget_min: 100, budget_max: 200 },
  ] }) });
  const { chatConvById } = await import('../src/client/features/contract/actions-chat-bridge.js');
  // The module uses a setter; simplest is to seed the conversation via chat bridge registry.
  const { chat } = await import('../src/client/features/chat/chat-state.js');
  chat.list = [{ id: 1, student_user_id: 39, teacher_user_id: 40, demand_id: 999 }];
  await openContractDraftModal(1);
  const sel = dom.window.document.getElementById('contract-demand');
  const opts = [...sel.options];
  assert.equal(opts[0].value, '', '首项为占位空值');
  assert.ok(opts[0].disabled && opts[0].selected, '占位 option 选中且禁选');
  assert.ok(!opts.some(o => o.selected && o.value !== ''), '无任何真实需求被静默预选');
  delete globalThis.fetch; teardown();
});

test('submitSigning：未选需求被校验拦截，不发起请求；doSubmitSigning 携带 demandId', async () => {
  const dom = setup();
  let posted = null;
  globalThis.fetch = async (url, opts) => {
    if (opts && opts.method === 'POST') { posted = { url: String(url), body: JSON.parse(opts.body) }; }
    return { ok: true, status: 200, json: async () => ({}) };
  };
  dom.window.document.getElementById('modal-container').innerHTML = `
    <div class="modal"><div class="modal-body">
      <select class="form-select" id="signing-demand"><option value="">请选择</option><option value="7">#0007</option></select>
      <input id="signing-price" value="150"><select id="signing-method"><option value="offline" selected>线下</option></select>
      <div id="signing-time-slots" class="time-slots"><div class="time-slot"><select class="slot-dow"><option value="1">周一</option></select></div></div>
    </div></div>`;
  const { submitSigning } = await import('../src/client/features/contract/actions-draft.js');
  await submitSigning(1);
  assert.equal(posted, null, '未选需求不应发请求');
  await doSubmitSigning(1, { demandId: 7, price: 150, schedule: '每周一 18:00-20:00', method: 'offline' });
  assert.ok(posted, 'doSubmitSigning 发请求');
  assert.equal(posted.body.demandId, 7, '请求体携带 demandId');
  assert.ok(String(posted.body.schedule).includes('周一'), 'schedule 为格式化时间段');
  delete globalThis.fetch; teardown();
});

test('submitContractDraft：未选已签约需求被校验拦截（v0.25.99 走 Toast）', async () => {
  const dom = setup();
  let posted = null;
  globalThis.fetch = async (url, opts) => {
    if (opts && opts.method === 'POST') posted = opts.body;
    return { ok: true, status: 200, json: async () => ({}) };
  };
  dom.window.document.getElementById('modal-container').innerHTML = `
    <div class="modal"><div class="modal-body">
      <select class="form-select" id="contract-demand"><option value="" disabled>暂无</option></select>
      <input id="contract-rate" value="150"><select id="contract-method"><option value="online">线上</option></select>
      <input id="contract-pay-method" value="per_session"><div id="contract-pay-method-other-wrap" class="hidden"></div>
      <input id="contract-trial-pay" value="first_free"><div id="contract-trial-pay-other-wrap" class="hidden"></div>
      <div id="contract-first-lesson-field"></div>
      <textarea id="post-body">方案</textarea>
    </div></div>`;
  await submitContractDraft(1);
  assert.equal(posted, null, '未选需求不发请求');
  assert.ok(dom.window.document.querySelector('#toast-container').textContent.includes('选择已签约需求'), '走 Toast 校验');
  delete globalThis.fetch; teardown();
});
