import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderConvItem, renderChatBubble, renderChatMediaInner, chatFileSize, chatFileExt, renderChatPlaceholder } from '../src/client/features/chat/render.js';
import * as actions from '../src/client/features/chat/actions.js';
import { state } from '../src/client/core/state.js';

test('chat render: conv item has data-action no inline', () => {
  state.user = { id: 1 };
  const html = renderConvItem({ id: 1, student_user_id: 1, teacher_user_id: 2, student_name: '我', teacher_name: '老师', unread_count: 2, last_message: 'hi' });
  assert.ok(html.includes('data-action="chat.openConv"'));
  assert.ok(!/onclick=/.test(html));
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
  assert.ok(renderChatPlaceholder().includes('text-muted'));
});
