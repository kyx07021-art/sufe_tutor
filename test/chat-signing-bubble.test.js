/**
 * 会话内签约提醒框回归（B4：直接 import chat render）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderChatBubble } from '../src/client/features/chat/render.js';
import { state } from '../src/client/core/state.js';

function render(msg) { return renderChatBubble(msg, 0); }

test('signing_request：我方发起 → mine 侧大气泡，无确认按钮；对方发起 → theirs 且有按钮', () => {
  state.user = { id: 1, role: 'teacher', username: '甲' };
  const mine = render({ kind:'signing_request', sender_user_id:1, id:11, created_at:'2026-08-08 12:00:00', body:JSON.stringify({ id:'5', price:150, schedule:'每周六晚', method:'offline', status:'pending' }) });
  assert.ok(mine.includes('chat-msg--mine') && mine.includes('chat-bubble--mine'));
  assert.ok(mine.includes('signing-bubble'));
  assert.ok(!mine.includes('chat.respond'), '发起方看不到确认/拒绝按钮');
  const theirs = render({ kind:'signing_request', sender_user_id:2, id:12, created_at:'2026-08-08 12:00:00', body:JSON.stringify({ id:'6', price:200, schedule:'周六下午', method:'online', status:'pending' }) });
  assert.ok(theirs.includes('chat-msg--theirs') && theirs.includes('chat-bubble--theirs'));
  assert.ok(theirs.includes('data-action="chat.respond"') && theirs.includes('data-accept="1"') && theirs.includes('data-accept="0"'));
  state.user = null;
});

test('signing_response：回应方视角 mine/theirs + 呼吸遮罩', () => {
  state.user = { id: 1, role: 'teacher', username: '甲' };
  const mine = render({ kind:'signing_response', sender_user_id:1, id:13, created_at:'2026-08-08 12:00:00', body:JSON.stringify({ accept:true }) });
  assert.ok(mine.includes('chat-msg--mine') && mine.includes('chat-bubble--mine'));
  assert.ok(mine.includes('chat-bubble--breathe'));
  const theirs = render({ kind:'signing_response', sender_user_id:2, id:14, created_at:'2026-08-08 12:00:00', body:JSON.stringify({ accept:true }) });
  assert.ok(theirs.includes('chat-msg--theirs') && theirs.includes('chat-bubble--theirs'));
  assert.ok(theirs.includes('chat-bubble--breathe'));
  state.user = null;
});

test('contract 事件气泡：按发送方区分 mine/other', () => {
  state.user = { id: 1, role: 'teacher', username: '甲' };
  const mine = render({ kind:'contract', sender_user_id:1, id:20, created_at:'2026-08-08 12:00:00', body:'contract_draft' });
  assert.ok(mine.includes(TEXT_CONTRACT_MINE()));
  const theirs = render({ kind:'contract', sender_user_id:2, id:21, created_at:'2026-08-08 12:00:00', body:'contract_draft' });
  assert.ok(theirs.includes(TEXT_CONTRACT_OTHER()));
  state.user = null;
});
function TEXT_CONTRACT_MINE() { return '你向对方发送'; }
function TEXT_CONTRACT_OTHER() { return '对方向你发送'; }
