/**
 * F10 聊天乐观发送回归（B4：直接 import chat actions-send）。
 * 覆盖审计要求：临时气泡内外 data-mid 同步替换、轮询关窗、去重、空响应回滚、
 * 空会话占位清除、部分失败恢复、loading。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { sendChatMessage } from '../src/client/features/chat/actions-send.js';
import { chatPollTick } from '../src/client/features/chat/actions-list.js';
import { chat } from '../src/client/features/chat/chat-state.js';
import { state } from '../src/client/core/state.js';

function setup() {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="chat-messages"></div><textarea id="chat-input"></textarea><div id="chat-stage"></div><button id="chat-send-btn"></button><div id="toast-container"></div></body></html>', { url: 'http://localhost/' });
  globalThis.document = dom.window.document;
  state.user = { id: 1, role: 'student' };
  state.page = 'my-chats'; // chatPollTick page guard: poll tests must exercise real guard order
  chat.convId = 1; chat.staged = []; chat.lastMsgId = 0; chat.sending = false; chat.optimisticSending = false; chat.optimisticSeq = 0; chat.pollBusy = false;
  return dom;
}
function teardown() { delete globalThis.document; state.page = null; state.user = null; }

function setupFetch(impl) {
  globalThis.fetch = impl;
}

test('乐观发送：api 未返回前气泡已插入，输入已清空，轮询关窗', async () => {
  const dom = setup();
  let resolveSend, capturedBody = null;
  setupFetch(async (url, opts) => new Promise(res => { resolveSend = () => res({ ok: true, status: 200, json: async () => ({ messages: [{ id: 5, kind: 'text', name: '' }] }) }); capturedBody = opts.body; }));
  dom.window.document.getElementById('chat-input').value = '你好';
  const p = sendChatMessage();
  await new Promise(r => setTimeout(r, 0));
  const bubbles = dom.window.document.querySelectorAll('#chat-messages .chat-bubble');
  assert.equal(bubbles.length, 1);
  assert.ok(Number(bubbles[0].dataset.mid) < 0);
  assert.ok(bubbles[0].textContent.includes('你好'));
  assert.equal(dom.window.document.getElementById('chat-input').value, '');
  assert.deepEqual(JSON.parse(capturedBody).batch, [{ kind: 'text', body: '你好' }]);
  assert.equal(chat.optimisticSending, true, '发送在途轮询关窗');
  assert.equal(dom.window.document.getElementById('chat-send-btn').disabled, true, '发送按钮 loading');
  resolveSend();
  await p;
  assert.equal(chat.optimisticSending, false);
  const real = dom.window.document.querySelector('#chat-messages .chat-bubble');
  assert.equal(real.dataset.mid, '5', '临时气泡替换为真实 id');
  assert.ok(real.className.includes('chat-bubble--mine'), '替换后仍是自己的气泡（sender_user_id 不丢）');
  assert.ok(real.textContent.includes('你好'), '替换后正文保留（body 不丢）');
  assert.equal(dom.window.document.getElementById('chat-send-btn').disabled, false);
  assert.equal(chat.lastMsgId, 5);
  teardown();
});

test('空会话首条消息：乐观气泡插入前清除 empty-state 占位（v1 parity）', async () => {
  const dom = setup();
  let resolveSend;
  setupFetch(async () => new Promise(res => { resolveSend = () => res({ ok: true, status: 200, json: async () => ({ messages: [{ id: 5, kind: 'text', name: '' }] }) }); }));
  dom.window.document.getElementById('chat-messages').innerHTML = '<div class="empty-state empty-state--small"><p>还没有消息，先打个招呼吧</p></div>';
  dom.window.document.getElementById('chat-input').value = '第一条';
  const p = sendChatMessage();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(dom.window.document.querySelector('#chat-messages .empty-state'), null, 'empty-state 已被清除');
  assert.equal(dom.window.document.querySelectorAll('#chat-messages .chat-bubble').length, 1, '气泡已插入');
  resolveSend();
  await p;
  teardown();
});

test('乐观失败回滚：api 拒绝 → 气泡移除 + 输入恢复 + 暂存恢复 + toast', async () => {
  const dom = setup();
  setupFetch(async () => ({ ok: false, status: 400, json: async () => ({ error: '审核驳回' }) }));
  chat.staged = [{ id: 1, kind: 'file', uploadId: 10, name: 'a.pdf', dataUrl: 'data:application/pdf;base64,AA', progress: 100, ready: true }];
  dom.window.document.getElementById('chat-input').value = '你好';
  await sendChatMessage();
  assert.equal(dom.window.document.querySelectorAll('#chat-messages .chat-bubble').length, 0);
  assert.equal(dom.window.document.getElementById('chat-input').value, '你好');
  assert.equal(chat.staged.length, 1, '失败回滚恢复暂存区');
  const stageHtml = dom.window.document.getElementById('chat-stage').innerHTML;
  assert.ok(stageHtml.includes('chat-stage-item'), '暂存区 UI 已恢复渲染');
  assert.ok(dom.window.document.querySelector('#toast-container').textContent.includes('审核驳回'));
  assert.equal(chat.optimisticSending, false);
  teardown();
});

test('乐观去重：在途轮询已抢插真实气泡 → 发送成功移除临时气泡（防双气泡）', async () => {
  const dom = setup();
  let resolveSend;
  setupFetch(async () => new Promise(res => { resolveSend = () => res({ ok: true, status: 200, json: async () => ({ messages: [{ id: 5, kind: 'text', name: '' }] }) }); }));
  dom.window.document.getElementById('chat-input').value = '你好';
  const p = sendChatMessage();
  await new Promise(r => setTimeout(r, 0));
  const optimistic = dom.window.document.querySelector('#chat-messages .chat-bubble');
  assert.ok(Number(optimistic.dataset.mid) < 0);
  // 模拟在途轮询已抢插真实 id（绕过 optimisticSending 的直接 DOM 写入）
  dom.window.document.getElementById('chat-messages').insertAdjacentHTML('beforeend', '<div class="chat-msg"><div class="chat-bubble" data-mid="5">x</div></div>');
  resolveSend();
  await p;
  const mids = [...dom.window.document.querySelectorAll('#chat-messages .chat-bubble')].map(b => b.dataset.mid);
  assert.deepEqual(mids, ['5'], '无双气泡');
  teardown();
});

test('空响应回滚：api 返回 messages:[] → 临时气泡移除、输入恢复', async () => {
  const dom = setup();
  setupFetch(async () => ({ ok: true, status: 200, json: async () => ({ messages: [] }) }));
  dom.window.document.getElementById('chat-input').value = '你好';
  await sendChatMessage();
  assert.equal(dom.window.document.querySelectorAll('#chat-messages .chat-bubble').length, 0);
  assert.equal(dom.window.document.getElementById('chat-input').value, '你好', '未创建的文字恢复输入');
  assert.equal(chat.lastMsgId, 0);
  teardown();
});

test('部分失败：服务端只回一部分 → 缺失文字恢复输入 + toast 提示', async () => {
  const dom = setup();
  // 批 = [图片, 文件, 文字]，服务端只创建了前两条（文字被驳回），模拟部分回执
  chat.staged = [
    { id: 1, kind: 'image', uploadId: 10, name: 'a.jpg', dataUrl: 'data:image/jpeg;base64,AAA', thumb: 'data:image/jpeg;base64,TH', ready: true },
    { id: 2, kind: 'file', uploadId: 11, name: 'b.pdf', dataUrl: 'data:application/pdf;base64,BBB', ready: true },
  ];
  setupFetch(async () => ({ ok: true, status: 200, json: async () => ({ messages: [{ id: 6, kind: 'image', name: 'a.jpg' }, { id: 7, kind: 'file', name: 'b.pdf' }] }) }));
  dom.window.document.getElementById('chat-input').value = '第二条';
  await sendChatMessage();
  const mids = [...dom.window.document.querySelectorAll('#chat-messages .chat-bubble')].map(b => b.dataset.mid);
  assert.deepEqual(mids, ['6', '7'], '两条已创建消息替换为真实 id');
  assert.equal(dom.window.document.getElementById('chat-input').value, '第二条', '缺失的文字恢复输入');
  assert.ok(dom.window.document.querySelector('#toast-container').textContent.includes('部分消息未发送'), '部分失败 toast');
  teardown();
});

test('图片/文件乐观气泡成功后内外 data-mid 都替换为真实 id；媒体 bump 不把 dataUrl 写进列表缓存', async () => {
  const dom = setup();
  chat.list = [{ id: 1, last_kind: 'text', last_body: '旧预览', last_sender: 1 }];
  chat.staged = [
    { id: 1, kind: 'image', uploadId: 10, name: 'a.jpg', dataUrl: 'data:image/jpeg;base64,AAA', thumb: 'data:image/jpeg;base64,TH', ready: true },
    { id: 2, kind: 'file', uploadId: 11, name: 'b.pdf', dataUrl: 'data:application/pdf;base64,BBB', ready: true },
  ];
  setupFetch(async () => ({ ok: true, status: 200, json: async () => ({ messages: [{ id: 6, kind: 'image', name: 'a.jpg' }, { id: 7, kind: 'file', name: 'b.pdf' }] }) }));
  await sendChatMessage();
  const bubbles = [...dom.window.document.querySelectorAll('#chat-messages .chat-bubble')];
  assert.deepEqual(bubbles.map(b => b.dataset.mid), ['6', '7']);
  const inner = [...dom.window.document.querySelectorAll('#chat-messages img[data-action="chat.openImage"], #chat-messages a.chat-file-dl')];
  assert.deepEqual(inner.map(b => b.dataset.mid || ''), ['6', ''], '图片按钮 data-mid 同步为真实 id');
  assert.equal(inner[1].getAttribute('download'), 'b.pdf', '文件下载锚点带文件名');
  // F7 调用点契约：媒体消息 bump 传 body:''（绝不把数百 KB dataUrl 写进会话列表缓存）
  assert.equal(chat.list[0].last_kind, 'file', '预览 kind 为最后一条媒体');
  assert.equal(chat.list[0].last_body, '', '媒体消息列表缓存 body 为空串');
  teardown();
});

test('chatPollTick 在乐观发送期间直接短路（不拉取）', async () => {
  const dom = setup();
  let called = false;
  setupFetch(async () => { called = true; return { ok: true, status: 200, json: async () => ({ messages: [] }) }; });
  chat.optimisticSending = true;
  await chatPollTick();
  assert.equal(called, false, '乐观发送中轮询不发请求');
  teardown();
});

test('chatPollTick 离开会话页/未登录直接短路（v1 page guard parity）', async () => {
  const dom = setup();
  let called = 0;
  setupFetch(async () => { called++; return { ok: true, status: 200, json: async () => ({ messages: [] }) }; });
  state.page = 'browse-teachers';
  await chatPollTick();
  assert.equal(called, 0, '不在会话页不拉取');
  state.page = 'my-chats';
  state.user = null;
  await chatPollTick();
  assert.equal(called, 0, '未登录不拉取');
  teardown();
});
