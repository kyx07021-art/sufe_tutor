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
 *
 * W-1 审计补强：文件卡结构断言（图标/名称/大小/下载锚点）、下载 href 客户端 scheme
 * 自守（仅 data: 可下）、无内容骨架结构断言（ring-track/ring-bar 类契约）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderChatBubble, renderChatMediaInner } from '../src/client/features/chat/render.js';
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

test('结构断言：文件卡 = 图标 + 名称 + 大小 + 下载锚点（W-1 审计补强）', () => {
  const html = renderChatMediaInner('file', 'data:application/pdf;base64,' + 'A'.repeat(800), '教案.pdf');
  assert.ok(html.includes('<span class="chat-file-icon">'), '扩展名图标在');
  assert.ok(html.includes('<span class="chat-file-name">教案.pdf</span>'), '文件名在');
  assert.ok(html.includes('<span class="chat-file-size">'), '大小占位在');
  assert.ok(html.includes('<a class="chat-file-dl"'), '下载控件是锚点（v1 结构，非 button）');
  assert.ok(html.includes('href="data:application/pdf;base64,'), 'data: 全图可直接下载');
  assert.ok(html.includes('download="教案.pdf"'), '下载文件名随卡片名');
  assert.ok(html.includes('>下载</a>'), '下载文案在');
});

test('下载 href 客户端 scheme 自守：非 data: 一律 #（防 javascript: 等）', () => {
  const evil = renderChatMediaInner('file', 'javascript:alert(1)', 'x.txt');
  assert.ok(evil.includes('href="#"'), 'javascript: 被替换为 #');
  // 空 body 的媒体消息不进文件卡渲染（列表懒加载前走 .chat-attach-fail 骨架占位，
  // 见下方「附件已被移除占位」用例），卡片 href 只有 data: 与非 data: 两态
});

test('无内容骨架：image/file 无 body 无 thumb → loading 骨架 + 进度圈（ring-track/ring-bar 类契约）', () => {
  state.user = { id: 2, role: 'teacher', username: 'me' };
  const imgHtml = renderChatBubble({
    id: 12, sender_user_id: 1, kind: 'image', body: '', thumb: '', created_at: '2026-08-08 10:00:00',
  }, 0);
  assert.ok(imgHtml.includes('chat-bubble--loading'), 'loading 类在');
  assert.ok(imgHtml.includes('data-attach="12"'), 'data-attach 供懒加载定位');
  assert.ok(imgHtml.includes('data-attach-kind="image"'), 'attach-kind 区分图片/文件骨架尺寸');
  assert.ok(imgHtml.includes('class="ring-track"'), '进度圈轨道类（style-chat.css 有对应规则）');
  assert.ok(imgHtml.includes('class="ring-bar"'), '进度圈刻度类（pulse 动画消费方）');
  const fileHtml = renderChatBubble({
    id: 13, sender_user_id: 1, kind: 'file', body: '', thumb: '', name: 'x.pdf', created_at: '2026-08-08 10:00:00',
  }, 0);
  assert.ok(fileHtml.includes('data-attach-kind="file"'), '文件骨架 kind 正确');
  state.user = null;
});

test('附件已被移除占位：两者皆空渲染 .chat-attach-fail（发件方注销后附件清空）', () => {
  const html = renderChatMediaInner('image', '', '', '', 5);
  assert.ok(html.includes('chat-attach-fail'), 'fail 占位类在');
  assert.ok(html.includes('附件已被发送方移除'), 'fail 文案在');
  assert.ok(!html.includes('<img'), '不渲染死链接空图');
});
