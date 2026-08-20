/**
 * W-1 审计补强 · 会话列表与生命周期回归（B4：直接 import chat ESM）。
 * 覆盖审计要求的零测试区：
 *   - chatBumpConvPreview（last_* 字段 + 置顶 + 重渲染）
 *   - loadConversations 的 pendingOpen 消费（R26 跨页跳会话）
 *   - goChatWithStudent 三分支
 *   - markReadConv 就地消红点 + 静默上报
 *   - openConversation 过期响应守卫（会话切换竞态）
 *   - chatLazyLoadAttachments 成功补载 / 失败 fail 文案 / data-attach 删除
 *   - chatPollTick 空会话清占位 / 签到回应注入 / 收到对方消息就地已读
 *   - renderConvItem 预览分型 / 未读点 / 角色 tag / 时间 / active 态
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  renderConvItem,
} from '../src/client/features/chat/render.js';
import {
  loadConversations, goChatWithStudent, markReadConv, chatBumpConvPreview,
  openConversation, chatPollTick, chatLazyLoadAttachments, stopChatPolling,
  chatStartPolling, chatLeavePage, chatTeardown,
} from '../src/client/features/chat/actions-list.js';
import { chat } from '../src/client/features/chat/chat-state.js';
import { state, runLogoutResets } from '../src/client/core/state.js';
import { setEnsureAuth } from '../src/client/core/api.js';
import { registerPage, selectPage } from '../src/client/core/router.js';
import { _dhResetForTests } from '../src/client/core/datahub.js';
import { TEXT } from '../src/client/constants/text.js';

const BASE_CONV = {
  id: 5, student_user_id: 9, teacher_user_id: 40, status: 'active',
  student_name: '学生甲', teacher_name: '教师乙', student_avatar: '', teacher_avatar: '',
  unread_count: 0, created_at: '2026-08-07 00:00:00',
  last_kind: 'text', last_body: '你好', last_at: '2026-08-07 12:00:00', last_sender: 9,
};

function setup() {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div class="chats-shell"><div class="chats-list-pane"><div id="my-chats-list"></div></div><div class="chat-pane"><div id="chat-frame"></div></div></div><div id="toast-container"></div></body></html>', { url: 'http://localhost/' });
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

test('renderConvItem：预览按 last_kind 分型、我发送带前缀、未读点/角色 tag/时间/active', () => {
  state.user = { id: 40, role: 'teacher', username: '教师乙' };
  const contractHtml = renderConvItem({ ...BASE_CONV, last_kind: 'contract', last_body: '' });
  assert.ok(contractHtml.includes('[合同草案]'), 'contract → [合同草案]');
  const signingReq = renderConvItem({ ...BASE_CONV, last_kind: 'signing_request', last_body: '{}' });
  assert.ok(signingReq.includes('[签约请求]'), 'signing_request → [签约请求]');
  const signingResp = renderConvItem({ ...BASE_CONV, last_kind: 'signing_response', last_body: '{}' });
  assert.ok(signingResp.includes('[签约回应]'), 'signing_response → [签约回应]');
  const imageHtml = renderConvItem({ ...BASE_CONV, last_kind: 'image', last_body: '' });
  assert.ok(imageHtml.includes('[图片]'), 'image → [图片]');
  const fileHtml = renderConvItem({ ...BASE_CONV, last_kind: 'file', last_body: '' });
  assert.ok(fileHtml.includes('[文件]'), 'file → [文件]');
  const mineText = renderConvItem({ ...BASE_CONV, last_kind: 'text', last_body: '在吗', last_sender: 40 });
  assert.ok(mineText.includes('我：在吗'), '自己发的文字带「我：」前缀');
  const theirText = renderConvItem({ ...BASE_CONV, last_kind: 'text', last_body: '在吗', last_sender: 9 });
  assert.ok(theirText.includes('在吗') && !theirText.includes('我：'), '对方发的无前缀');
  const unread = renderConvItem({ ...BASE_CONV, unread_count: 3 });
  assert.ok(unread.includes('conv-unread-dot'), '未读点渲染');
  assert.ok(unread.includes('data-unread-dot="5"'), '未读点带会话 id');
  assert.ok(unread.includes('学生'), '角色 tag 渲染');
  assert.ok(unread.includes('conv-item-time'), '时间元素在');
  assert.ok(unread.includes('conv-avatar'), '头像在');
  assert.ok(!/onclick=/.test(unread), '无内联 handler');
  state.user = null;
});

test('renderConvItem：chat.convId 命中 → active 类（列表高亮）', () => {
  state.user = { id: 40, role: 'teacher', username: '教师乙' };
  chat.convId = 5;
  assert.ok(renderConvItem(BASE_CONV).includes('conv-item active'), '当前会话高亮');
  chat.convId = 3;
  assert.ok(!renderConvItem(BASE_CONV).includes(' active'), '非当前会话不高亮');
  chat.convId = null;
  state.user = null;
});

test('chatBumpConvPreview：写 last_* 服务端契约字段并置顶重渲染', () => {
  const dom = setup();
  chat.list = [
    { ...BASE_CONV, id: 1 },
    { ...BASE_CONV, id: 2 },
  ];
  chatBumpConvPreview(2, { kind: 'image', body: '', sender_user_id: 40, created_at: '2026-08-07 13:00:00' });
  assert.equal(chat.list[0].id, 2, '被 bump 的会话移到列表顶部');
  assert.equal(chat.list[0].last_kind, 'image', 'last_kind 写入');
  assert.equal(chat.list[0].last_at, '2026-08-07 13:00:00', 'last_at 写入');
  assert.equal(chat.list[0].last_sender, 40, 'last_sender 写入');
  const html = dom.window.document.getElementById('my-chats-list').innerHTML;
  assert.ok(html.includes('[图片]'), '列表重渲染带新预览');
  teardown();
});

test('loadConversations + pendingOpen：目标在列表 → 自动打开会话', async () => {
  const dom = setup();
  chat.pendingOpen = 9;
  globalThis.fetch = async url => {
    const u = String(url);
    if (u === '/api/conversations') return { ok: true, status: 200, json: async () => ({ conversations: [BASE_CONV] }) };
    if (msgsUrl(5).test(u)) return { ok: true, status: 200, json: async () => ({ messages: [{ id: 1, sender_user_id: 40, kind: 'text', body: 'hi', created_at: '2026-08-07 12:00:00' }] }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  await loadConversations();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(chat.pendingOpen, null, '待开目标已消费');
  assert.equal(chat.convId, 5, '目标会话已打开');
  const box = dom.window.document.getElementById('chat-frame');
  assert.ok(box.innerHTML.includes('学生甲'), '聊天窗已渲染');
  teardown();
});

test('loadConversations + pendingOpen：找不到目标 → toast 兜底', async () => {
  const dom = setup();
  chat.pendingOpen = 999;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ conversations: [] }) });
  await loadConversations();
  assert.equal(chat.pendingOpen, null, '待开目标已消费');
  assert.equal(chat.convId, null, '无会话可开');
  assert.ok(dom.window.document.getElementById('toast-container').textContent.includes(TEXT.CHAT_CONV_NOT_FOUND), '兜底 toast');
  teardown();
});

test('goChatWithStudent：会话在列表且停在会话页 → 就地打开', async () => {
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

test('goChatWithStudent：不在会话页 → 设待开目标并切页', () => {
  const dom = setup();
  state.page = 'browse-demands';
  chat.list = [BASE_CONV];
  goChatWithStudent(9);
  assert.equal(state.page, 'my-chats', '切到会话页');
  assert.equal(chat.pendingOpen, 9, '设待开学生目标');
  teardown();
});

test('markReadConv：就地消红点 + 重渲染 + 静默 POST 上报', async () => {
  const dom = setup();
  chat.list = [{ ...BASE_CONV, unread_count: 5 }];
  let readCalls = 0;
  globalThis.fetch = async url => {
    if (String(url).includes('/read')) readCalls++;
    return { ok: true, status: 200, json: async () => ({}) };
  };
  markReadConv(5);
  assert.equal(chat.list[0].unread_count, 0, '红点计数清 0');
  assert.ok(!dom.window.document.getElementById('my-chats-list').innerHTML.includes('conv-unread-dot'), '未读点不再渲染');
  await new Promise(r => setTimeout(r, 0));
  assert.equal(readCalls, 1, 'POST /read 上报一次');
  teardown();
});

test('openConversation：过期响应守卫——切走后旧会话响应不覆盖新会话内容', async () => {
  const dom = setup();
  let resolveFirst;
  globalThis.fetch = async url => {
    const u = String(url);
    if (msgsUrl(5).test(u)) return new Promise(res => { resolveFirst = () => res({ ok: true, status: 200, json: async () => ({ messages: [{ id: 1, sender_user_id: 9, kind: 'text', body: '旧会话消息', created_at: '2026-08-07 12:00:00' }] }) }); });
    if (msgsUrl(6).test(u)) return { ok: true, status: 200, json: async () => ({ messages: [{ id: 2, sender_user_id: 9, kind: 'text', body: '新会话消息', created_at: '2026-08-07 12:05:00' }] }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  chat.list = [BASE_CONV, { ...BASE_CONV, id: 6 }];
  const first = openConversation(5);   // 慢响应，挂起
  await new Promise(r => setTimeout(r, 0));
  const second = openConversation(6);  // 用户已切走
  await second;
  resolveFirst();
  await first;
  assert.equal(chat.convId, 6, '当前会话是 6');
  const box = dom.window.document.getElementById('chat-messages');
  assert.ok(box.innerHTML.includes('新会话消息'), '新会话内容在');
  assert.ok(!box.innerHTML.includes('旧会话消息'), '过期响应被丢弃');
  teardown();
});

test('chatLazyLoadAttachments：成功补载真实内容，loading/attach 标记清除', async () => {
  const dom = setup();
  chat.convId = 5;
  dom.window.document.body.insertAdjacentHTML('beforeend', `
    <div id="chat-messages">
      <div class="chat-msg"><div class="chat-bubble chat-bubble--loading" data-attach="7" data-attach-kind="image">ring</div></div>
    </div>`);
  globalThis.fetch = async url => {
    if (String(url).includes('/attachment')) return { ok: true, status: 200, json: async () => ({ body: 'data:image/jpeg;base64,FULL', name: 'a.jpg' }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  chatLazyLoadAttachments();
  await new Promise(r => setTimeout(r, 200)); // CHAT_SLIDE_DELAY_MS=120 后补载
  const bubble = dom.window.document.querySelector('.chat-bubble');
  assert.ok(!bubble.classList.contains('chat-bubble--loading'), 'loading 类已清');
  assert.equal(bubble.dataset.attach, undefined, 'data-attach 已删');
  assert.ok(bubble.innerHTML.includes('data:image/jpeg;base64,FULL'), '真实图片内容已补载');
  teardown();
});

test('chatLazyLoadAttachments：失败渲染 .chat-attach-fail 且删除 data-attach（不反复重拉）', async () => {
  const dom = setup();
  chat.convId = 5;
  dom.window.document.body.insertAdjacentHTML('beforeend', `
    <div id="chat-messages">
      <div class="chat-msg"><div class="chat-bubble chat-bubble--loading" data-attach="8" data-attach-kind="file">ring</div></div>
    </div>`);
  // 404 业务错误（非 NETWORK_ERROR）→ api() 不重试；网络错误会被 GET_RETRY 退避拉长测试
  globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
  chatLazyLoadAttachments();
  await new Promise(r => setTimeout(r, 200));
  const bubble = dom.window.document.querySelector('.chat-bubble');
  assert.ok(!bubble.classList.contains('chat-bubble--loading'), 'loading 类已清');
  assert.equal(bubble.dataset.attach, undefined, 'data-attach 已删（防反复重拉）');
  assert.ok(bubble.innerHTML.includes('chat-attach-fail'), '失败占位类在');
  assert.ok(bubble.innerHTML.includes(TEXT.CHAT_ATTACH_FAIL), '「附件加载失败」文案在');
  teardown();
});

test('chatPollTick：空会话轮询带回消息 → 清占位 + 追加气泡 + 更新 lastMsgId', async () => {
  const dom = setup();
  chat.convId = 5;
  chat.list = [BASE_CONV];
  dom.window.document.body.insertAdjacentHTML('beforeend',
    '<div id="chat-messages"><div class="empty-state empty-state--small"><p>还没有消息</p></div></div>');
  globalThis.fetch = async url => {
    const u = String(url);
    if (msgsUrl(5).test(u)) return { ok: true, status: 200, json: async () => ({ messages: [{ id: 3, sender_user_id: 9, kind: 'text', body: '你好', created_at: '2026-08-07 12:10:00' }] }) };
    if (u.includes('/read')) return { ok: true, status: 200, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  await chatPollTick();
  const box = dom.window.document.getElementById('chat-messages');
  assert.equal(box.querySelector('.empty-state'), null, '空会话占位已清');
  assert.ok(box.innerHTML.includes('你好'), '新消息气泡在');
  assert.equal(chat.lastMsgId, 3, 'lastMsgId 推进');
  assert.equal(chat.list[0].last_body, '你好', '列表预览同步 bump');
  await new Promise(r => setTimeout(r, 0));
  assert.equal(chat.list[0].unread_count, 0, '对方消息就地已读');
  teardown();
});

test('chatPollTick：签约回应 accept → 配对请求气泡注入签约提示并删资金声明', async () => {
  const dom = setup();
  chat.convId = 5;
  chat.list = [BASE_CONV];
  dom.window.document.body.insertAdjacentHTML('beforeend', `
    <div id="chat-messages">
      <div class="chat-msg"><div class="chat-bubble glass signing-bubble" data-signing-id="7">
        <p class="signing-bubble-status">已拒绝此次签约请求</p>
        <p class="signing-bubble-funds">平台不参与费用结算</p>
      </div></div>
    </div>`);
  globalThis.fetch = async url => {
    const u = String(url);
    if (msgsUrl(5).test(u)) return { ok: true, status: 200, json: async () => ({ messages: [{ id: 9, sender_user_id: 9, kind: 'signing_response', body: JSON.stringify({ accept: true, requestId: 7 }), created_at: '2026-08-07 12:11:00' }] }) };
    if (u.includes('/read')) return { ok: true, status: 200, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  await chatPollTick();
  const bubble = dom.window.document.querySelector('[data-signing-id="7"]');
  assert.ok(bubble.querySelector('.signing-bubble-draft-btn'), '起草合同按钮已注入');
  assert.ok(bubble.querySelector('.signing-bubble-signed-tip'), '签约提示已注入（status 复用为 tip）');
  assert.equal(bubble.querySelector('.signing-bubble-funds'), null, '独立资金声明已删除');
  const box = dom.window.document.getElementById('chat-messages');
  assert.ok(box.innerHTML.includes('对方已确认签约请求'), '回应气泡已追加');
  teardown();
});

test('F2 审计修复：openConversation 消费会话快照回填列表缓存（陈旧字段就地刷新）', async () => {
  const dom = setup();
  chat.list = [{ ...BASE_CONV, status: 'active', demand_id: null }];
  globalThis.fetch = async url => {
    const u = String(url);
    if (msgsUrl(5).test(u)) return { ok: true, status: 200, json: async () => ({
      conversation: { ...BASE_CONV, status: 'closed', demand_id: 99 },
      messages: [],
    }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  await openConversation(5);
  assert.equal(chat.list[0].status, 'closed', '服务端快照 status 回填');
  assert.equal(chat.list[0].demand_id, 99, '服务端快照 demand_id 回填');
  teardown();
});

test('F1 审计修复：登出重置链 — runLogoutResets 停轮询 + abort 暂存 + 重置会话态', async () => {
  const dom = setup();
  chat.convId = 5;
  chat.lastMsgId = 7;
  chatStartPolling();
  let aborted = 0, deleteCalls = 0;
  chat.staged = [{ id: 1, kind: 'file', name: 'a.pdf', uploadId: 11, ready: false, _xhr: { abort: () => { aborted++; } } }];
  globalThis.fetch = async url => {
    if (String(url).includes('/uploads/')) deleteCalls++;
    return { ok: true, status: 200, json: async () => ({}) };
  };
  assert.ok(chat.pollTimer, '轮询定时器在跑');
  runLogoutResets();
  assert.equal(chat.convId, null, '会话 id 重置');
  assert.equal(chat.lastMsgId, 0, 'lastMsgId 重置');
  assert.equal(chat.pollTimer, null, '轮询定时器已停');
  assert.equal(aborted, 1, '在途上传 XHR 已 abort');
  await new Promise(r => setTimeout(r, 0));
  assert.equal(deleteCalls, 1, '已上传暂存 best-effort 删除');
  assert.equal(chat.staged.length, 0, '暂存区清空（防跨账号残留）');
  teardown();
});

test('F3 审计修复：离开会话页 leave 钩子 — 兜底已读 + 停轮询 + 清暂存', async () => {
  const dom = setup();
  let readCalls = 0;
  globalThis.fetch = async url => {
    if (String(url).includes('/read')) readCalls++;
    return { ok: true, status: 200, json: async () => ({}) };
  };
  // 真实注册接线：chat feature 的 onLoad 把 leave 挂进页面注册表
  const chatFeature = await import('../src/client/features/chat/index.js');
  chatFeature.default.onLoad();
  registerPage({ id: 'dummy-test', label: 'dummy', desc: '', roles: ['student', 'teacher'], auth: false, enter: () => {} });
  state.page = 'my-chats';
  chat.list = [BASE_CONV];
  chat.convId = 5;
  chatStartPolling();
  selectPage('dummy-test');
  assert.equal(chat.convId, null, '离页重置会话态');
  assert.equal(chat.pollTimer, null, '离页停轮询');
  assert.equal(readCalls, 1, '离页兜底已读（最后轮询窗口到达的消息）');
  teardown();
});

test('F4 审计修复：goChatWithStudent 走 core ensureAuth 单源门禁', async () => {
  const dom = setup();
  chat.list = [];
  setEnsureAuth(() => false);
  state.page = 'browse-demands';
  goChatWithStudent(9);
  assert.equal(chat.pendingOpen, null, '未登录被拦：不写待开目标');
  assert.equal(state.page, 'browse-demands', '未登录不切页');
  setEnsureAuth(null); // 复位为默认放行（无接线语义）
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ conversations: [] }) });
  goChatWithStudent(9);
  assert.equal(state.page, 'my-chats', '放行后正常切页');
  assert.equal(chat.pendingOpen, 9, '放行后设待开目标');
  await new Promise(r => setTimeout(r, 20)); // 等 enterMyChats→loadConversations 消费待开目标
  assert.equal(chat.pendingOpen, null, '列表就绪后待开目标已消费');
  assert.ok(dom.window.document.getElementById('toast-container').textContent.includes(TEXT.CHAT_CONV_NOT_FOUND), '找不到目标兜底 toast');
  teardown();
});

test('chatLeavePage / chatTeardown 导出存在且幂等（重复调用不抛错）', () => {
  const dom = setup();
  chat.convId = 5; chat.staged = []; chat.lastMsgId = 3;
  chatLeavePage();
  chatLeavePage();
  chatTeardown();
  assert.equal(chat.convId, null, '清理后会话态为空');
  teardown();
});

// S-7a：移动端会话窗切换（features/chat.css ≤860px 契约）——openConversation 加
// .chats-show-chat 切聊天窗，chatTeardown 移除回列表。夹具已带生产形状 .chats-shell。
test('S-7a 移动端切换类：openConversation 加类、chatTeardown 移除、初始无类', async () => {
  const dom = setup();
  const shell = dom.window.document.querySelector('.chats-shell');
  assert.ok(shell, '夹具含 .chats-shell 生产形状');
  assert.ok(!shell.classList.contains('chats-show-chat'), '初始无类（默认显示列表）');
  chat.list = [BASE_CONV];
  globalThis.fetch = async url => {
    if (msgsUrl(5).test(String(url))) return { ok: true, status: 200, json: async () => ({ messages: [{ id: 1, sender_user_id: 9, kind: 'text', body: 'hi', created_at: '2026-08-07 12:00:00' }] }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  await openConversation(5);
  assert.ok(shell.classList.contains('chats-show-chat'), 'openConversation 后类存在（聊天窗可见）');
  chatTeardown();
  assert.ok(!shell.classList.contains('chats-show-chat'), 'chatTeardown 后类移除（回列表）');
  teardown();
});

// S-7a：消息拉取失败路径——类在渲染 frame 后、await 前同步加上，错误分支也必须显示聊天窗
test('S-7a 错误路径：messages 加载失败类仍已加（聊天窗可见）', async () => {
  const dom = setup();
  const shell = dom.window.document.querySelector('.chats-shell');
  chat.list = [BASE_CONV];
  globalThis.fetch = async () => { throw new Error('boom'); };
  await openConversation(5);
  assert.ok(shell.classList.contains('chats-show-chat'), '错误路径聊天窗仍可见');
  teardown();
});
