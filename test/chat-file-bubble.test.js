/**
 * 需求六（2026-08-08）·聊天气泡文件组件布局架构（v0.25.49）
 *
 * 缺陷实证：文件消息卡整体太靠左戳出气泡圆角（.chat-bubble--media 全出血内衬为图片设计，
 * 文件卡共用后内容顶着圆角）；下载按钮同款顶边；卡片 min-width:190 + 信息列 flex:1
 * 把下载按钮推到最右，文件名短时中间空一大截。
 *
 * 架构修正：文件/图片分流——图片保持全出血（padding 0 + 圆角裁剪），文件卡走
 * .chat-bubble--file 圆角内衬（10/12）；文件卡随内容收缩（width:fit-content）+
 * 文件名 max-width 截断，下载按钮紧随其后，中间不再空一截。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderChatBubble } from '../src/client/features/chat/render.js';
import { state } from '../src/client/core/state.js';

test('文件卡分流 .chat-bubble--file（圆角内衬），图片仍全出血', () => {
  const chat = readFileSync('./app-chat.js', 'utf8');
  assert.ok(chat.includes("mediaCls = m.kind === 'file' ? ' chat-bubble--file' : ''"), '文件消息带 file 类、图片不带');
  const css = readFileSync('./style-chat.css', 'utf8');
  const fileRule = css.split('.chat-bubble--file {')[1] || '';
  assert.ok(fileRule.split('}')[0].includes('padding: 10px 12px'), '文件卡圆角内衬（内容不再戳出圆角）');
  // 图片全出血保持 padding:0
  const mediaRule = css.split('.chat-bubble--media {')[1] || '';
  assert.ok(mediaRule.split('}')[0].includes('padding: 0'), '图片气泡仍全出血（圆角裁剪）');
});

test('文件卡随内容收缩：无 min-width 撑宽、无 flex:1 撑中缝，文件名截断后下载按钮紧随', () => {
  const css = readFileSync('./style-chat.css', 'utf8');
  const fileRule = (css.split('.chat-file {')[1] || '').split('}')[0];
  assert.ok(fileRule.includes('width: fit-content'), '卡片随内容收缩（不撑满气泡）');
  assert.ok(!fileRule.includes('min-width'), '无强制 min-width 190px（曾把短文件名撑出大中缝）');
  const infoRule = (css.split('.chat-file-info {')[1] || '').split('}')[0];
  assert.ok(!infoRule.includes('flex: 1'), '信息列不再 flex:1 吃满剩余宽度（中缝根因）');
  assert.ok(infoRule.includes('max-width'), '文件名列有宽度上限，超长 ellipsis 截断');
});

test('渲染验证：文件消息气泡带 chat-bubble--file 类，图片消息不带', () => {
  state.user = { id: 1, role: 'student', username: 'me' };
  const fileHtml = renderChatBubble({
    id: 10, sender_user_id: 1, kind: 'file', body: 'data:application/pdf;base64,AA==', name: '讲义.pdf',
    created_at: '2026-08-08 10:00:00',
  }, 0);
  assert.ok(fileHtml.includes('chat-bubble--file'), '文件消息气泡带 file 类');
  assert.ok(fileHtml.includes('chat-file'), '文件卡结构在');
  const imgHtml = renderChatBubble({
    id: 11, sender_user_id: 1, kind: 'image', body: '', thumb: 'data:image/png;base64,AA==',
    created_at: '2026-08-08 10:00:00',
  }, 0);
  assert.ok(!imgHtml.includes('chat-bubble--file'), '图片消息不带 file 类');
  state.user = null;
});
