/**
 * 会话内签约提醒框回归（B4：直接 import chat render）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderChatBubble } from '../src/client/features/chat/render.js';
import { state } from '../src/client/core/state.js';

function render(msg) { return renderChatBubble(msg, 0); }

test('signing_request：我方发起 → mine 侧大气泡 + 「你向对方发送」标题，无确认按钮', () => {
  state.user = { id: 1, role: 'teacher', username: '甲' };
  const mine = render({ kind:'signing_request', sender_user_id:1, id:11, created_at:'2026-08-08 12:00:00', body:JSON.stringify({ id:'5', price:150, schedule:'每周六晚', method:'offline', status:'pending' }) });
  assert.ok(mine.includes('chat-msg--mine') && mine.includes('chat-bubble--mine'));
  assert.ok(mine.includes('signing-bubble'));
  assert.ok(mine.includes('你向对方发送了签约请求'), '发起方标题（不是「对方…」颠倒）');
  assert.ok(!mine.includes('chat.respond'), '发起方看不到确认/拒绝按钮');
  const theirs = render({ kind:'signing_request', sender_user_id:2, id:12, created_at:'2026-08-08 12:00:00', body:JSON.stringify({ id:'6', price:200, schedule:'周六下午', method:'online', status:'pending' }) });
  assert.ok(theirs.includes('chat-msg--theirs') && theirs.includes('chat-bubble--theirs'));
  assert.ok(theirs.includes('对方向你发送了签约请求'), '接收方标题');
  assert.ok(theirs.includes('data-action="chat.respond"') && theirs.includes('data-accept="1"') && theirs.includes('data-accept="0"'));
  assert.ok(theirs.includes('signing-bubble-row'), '报价/时间/方式信息行在');
  assert.ok(theirs.includes('150') === false && mine.includes('150'), 'mine 侧报价行在（theirs 是 200）');
  assert.ok(theirs.includes('200'), 'theirs 报价行在');
  assert.ok(mine.includes('线下授课'), 'mine 方式行（offline）');
  assert.ok(theirs.includes('线上授课'), 'theirs 方式行（online）');
  assert.ok(mine.includes('平台不参与费用结算'), '未签约带资金声明行');
  state.user = null;
});

test('signing_request 终态：rejected 灰化 + 状态文字；signed 提示 + 起草合同按钮', () => {
  state.user = { id: 1, role: 'teacher', username: '甲' };
  const rejected = render({ kind:'signing_request', sender_user_id:2, id:17, created_at:'2026-08-08 12:00:00', body:JSON.stringify({ id:'7', price:100, schedule:'周六', method:'offline', status:'rejected' }) });
  assert.ok(rejected.includes('signing-bubble--done'), 'rejected 带 done 灰化类');
  assert.ok(rejected.includes('已拒绝此次签约请求'), 'rejected 状态文字');
  assert.ok(!rejected.includes('chat.respond'), 'rejected 无操作按钮');
  const signed = render({ kind:'signing_request', sender_user_id:2, id:18, created_at:'2026-08-08 12:00:00', body:JSON.stringify({ id:'8', price:100, schedule:'周六', method:'offline', status:'signed' }) });
  assert.ok(signed.includes('signing-bubble-signed-tip'), 'signed 带提示');
  assert.ok(signed.includes('chat.plusDraft'), 'signed 带起草合同按钮');
  assert.ok(!signed.includes('平台不参与费用结算'), '已签约不再显示资金声明');
  state.user = null;
});

test('signing_response：四象限文案 + 呼吸遮罩', () => {
  state.user = { id: 1, role: 'teacher', username: '甲' };
  const mineOk = render({ kind:'signing_response', sender_user_id:1, id:13, created_at:'2026-08-08 12:00:00', body:JSON.stringify({ accept:true }) });
  assert.ok(mineOk.includes('chat-msg--mine') && mineOk.includes('chat-bubble--mine'));
  assert.ok(mineOk.includes('chat-bubble--breathe'));
  assert.ok(mineOk.includes('你已确认签约请求'), '我方确认文案');
  const mineNo = render({ kind:'signing_response', sender_user_id:1, id:13, created_at:'2026-08-08 12:00:00', body:JSON.stringify({ accept:false }) });
  assert.ok(mineNo.includes('你已拒绝此次签约请求'), '我方拒绝文案');
  const theirsOk = render({ kind:'signing_response', sender_user_id:2, id:14, created_at:'2026-08-08 12:00:00', body:JSON.stringify({ accept:true }) });
  assert.ok(theirsOk.includes('chat-msg--theirs') && theirsOk.includes('chat-bubble--theirs'));
  assert.ok(theirsOk.includes('chat-bubble--breathe'));
  assert.ok(theirsOk.includes('对方已确认签约请求'), '对方确认文案（不是「已拒绝」）');
  const theirsNo = render({ kind:'signing_response', sender_user_id:2, id:14, created_at:'2026-08-08 12:00:00', body:JSON.stringify({ accept:false }) });
  assert.ok(theirsNo.includes('对方已拒绝此次签约请求'), '对方拒绝文案');
  state.user = null;
});

test('contract 事件气泡：按发送方区分 mine/other，且带呼吸遮罩（与签约流同口径）', () => {
  state.user = { id: 1, role: 'teacher', username: '甲' };
  const mine = render({ kind:'contract', sender_user_id:1, id:20, created_at:'2026-08-08 12:00:00', body:'contract_draft' });
  assert.ok(mine.includes(TEXT_CONTRACT_MINE()));
  assert.ok(mine.includes('chat-bubble--breathe'), '合同气泡恒挂 breathe（v1 同口径）');
  const theirs = render({ kind:'contract', sender_user_id:2, id:21, created_at:'2026-08-08 12:00:00', body:'contract_draft' });
  assert.ok(theirs.includes(TEXT_CONTRACT_OTHER()));
  assert.ok(theirs.includes('chat-bubble--breathe'), '接收方合同气泡同样 breathe');
  state.user = null;
});
function TEXT_CONTRACT_MINE() { return '你向对方发送'; }
function TEXT_CONTRACT_OTHER() { return '对方向你发送'; }
