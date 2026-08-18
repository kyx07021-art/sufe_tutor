import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderConvItem, renderChatBubble, renderChatMediaInner, chatFileSize, chatFileExt, renderChatPlaceholder } from '../src/client/features/chat/render.js';
import * as actions from '../src/client/features/chat/actions.js';
import { state } from '../src/client/core/state.js';

test('chat render: conv item has data-action no inline', () => {
  state.user = { id: 1, role: 'student' };
  // 服务端会话列表契约：last_kind/last_body/last_at/last_sender（无 last_message 字段）
  const html = renderConvItem({ id: 1, student_user_id: 1, teacher_user_id: 2, student_name: '我', teacher_name: '老师', unread_count: 2, last_kind: 'text', last_body: 'hi', last_at: '2026-08-17 12:00:00', last_sender: 2 });
  assert.ok(html.includes('data-action="chat.openConv"'));
  assert.ok(!/onclick=/.test(html));
  assert.ok(html.includes('hi'), '服务端 last_body 渲染为预览');
  state.user = null;
});

test('chat render: bubble/media no inline', () => {
  state.user = { id: 1 };
  const html = renderChatBubble({ id: 1, sender_user_id: 1, kind: 'text', body: 'hello', created_at: '2026-08-17 12:00:00' }, 0);
  assert.ok(html.includes('chat-bubble--mine'));
  assert.ok(!/onclick=/.test(html));
  assert.ok(!/style=/.test(html));
  state.user = null;
});

test('chat render: file size human and ext', () => {
  assert.ok(chatFileSize('data:image/png;base64,AAAA').includes('B'));
  assert.equal(chatFileExt('a.PDF'), 'PDF');
});

test('chat actions: conversation helpers exist', () => {
  assert.equal(typeof actions.enterMyChats, 'function');
  assert.equal(typeof actions.openConversation, 'function');
  assert.equal(typeof actions.sendChatMessage, 'function');
  assert.equal(typeof actions.stopChatPolling, 'function');
  assert.equal(typeof actions.respondSigning, 'function');
});

test('chat placeholder is non-empty', () => {
  const html = renderChatPlaceholder();
  assert.ok(html.includes('chat-placeholder-title'), '占位标题类（style-chat.css 有对应规则）');
  assert.ok(html.includes('chat-placeholder-sub'), '占位副标题类');
  assert.ok(html.includes('chat-placeholder-dots'), '占位动效点');
});
