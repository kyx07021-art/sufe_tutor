/**
 * 需求十二 · 聊天气泡外观优化（B4：直接 import theme/chat render ESM）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { THEME, STYLE_PACKS } from '../src/client/constants/theme.js';
import { renderChatBubble, renderChatMediaInner } from '../src/client/features/chat/render.js';
import { state } from '../src/client/core/state.js';
import { CHAT_CSS } from './_css.js';

test('主题气泡 token：浅/深两套近实色，系统为低对比中性（治鲜艳+过透）', () => {
  assert.match(THEME.light['--g-bubble-mine'], /^#/, '浅色 mine 近实色 hex（非半透明）');
  assert.match(THEME.light['--g-bubble-theirs'], /^#/, '浅色 theirs 近实白 hex');
  assert.match(THEME.light['--g-bubble-system'], /rgba\(17,17,20/, '浅色 system 中性灰');
  const sysAlpha = THEME.light['--g-bubble-system'].match(/\.(\d+)\)/);
  assert.ok(sysAlpha && +('0.' + sysAlpha[1]) >= 0.09, '浅色 system 气泡 alpha ≥ .09（明显灰色，非不可见淡染）');
  assert.match(THEME.dark['--g-bubble-mine'], /^#/, '深色 mine 品牌紫降饱和近实');
  assert.match(THEME.dark['--g-bubble-theirs'], /^#/, '深色 theirs 中性深灰近实');
});

test('flat 外观包不再覆盖气泡 token（与液态同源，删三色相特例）', () => {
  assert.ok(!JSON.stringify(STYLE_PACKS.flat.tokens).includes('--g-bubble'), 'flat 包无气泡 token 覆盖');
});

test('文件消息：拍平卡片无嵌套玻璃，含扩展名徽标 + 人性化大小', () => {
  const html = renderChatMediaInner('file', 'data:application/pdf;base64,' + 'A'.repeat(800), '教案.pdf');
  assert.ok(!html.includes('chat-file-chip') && !html.includes('glass glass--solid'), '无嵌套 glass chip（消套娃）');
  assert.ok(html.includes('chat-file'), '拍平卡片结构');
  assert.ok(html.includes('>PDF<'), '扩展名徽标 PDF');
  assert.ok(html.includes('KB') || html.includes('B'), '人性化大小显示');
  assert.ok(html.includes('chat-file-dl'), '下载按钮保留');
});

test('图片消息：气泡内 img 直铺（无 chip 嵌套）', () => {
  const html = renderChatMediaInner('image', 'data:image/jpeg;base64,xxx', 'a.jpg', '', 9);
  assert.ok(html.includes('<img') && html.includes('chat.openImage'), '图片直接铺在气泡内，点击走 chat.openImage');
  assert.ok(!html.includes('chat-file-chip') && !html.includes('chat-file'), '图片无文件卡片嵌套');
});

test('气泡圆角主值 16px（style-chat.css 单源）', () => {
  const css = CHAT_CSS;
  const m = /\.chat-bubble\s*{[^}]*--g-r:\s*(\d+)px/.exec(css);
  assert.ok(m, 'style-chat.css 存在 .chat-bubble 主规则');
  assert.equal(m[1], '16', '主圆角 16px');
});

test('合同事件气泡：对应用户一侧普通气泡皮肤（R3 取代原 system 胶囊）', () => {
  state.user = { id: 1, role: 'teacher', username: '甲' };
  const html = renderChatBubble({ kind: 'contract', sender_user_id: 1, id: 1, created_at: '2026-08-08 12:00:00', body: '' }, 0);
  assert.ok(html.includes('chat-msg--mine'), '起草方（本人）右侧消息');
  assert.ok(html.includes('chat-bubble--mine'), '本人皮肤气泡');
  assert.ok(!html.includes('chat-bubble--system'), 'system 类已连根删');
  state.user = null;
});

test('图片带缩略图：渲染 thumb 直接展示（非骨架），点击走 chatOpenImage 拉原图', () => {
  const html = renderChatMediaInner('image', '', 'a.jpg', 'data:image/jpeg;base64,THUMB', 42);
  assert.ok(html.includes('data:image/jpeg;base64,THUMB'), '缩略图即 src');
  assert.ok(html.includes('chat.openImage'), '点击走 chat.openImage 拉原图');
  assert.ok(!html.includes('data-full'), '缩略图无 data-full 标记');
});

test('图片带全图（本人刚发/懒加载补载）：data-full 标记，点击直开大图', () => {
  const html = renderChatMediaInner('image', 'data:image/jpeg;base64,FULL', 'a.jpg', '', 42);
  assert.ok(html.includes('data-full="1"'), '已带全图标记 data-full');
  assert.ok(html.includes('data:image/jpeg;base64,FULL'), 'src 为全图');
});

test('renderChatBubble：image 消息带 thumb → 直接渲染图片（不进骨架懒加载）', () => {
  state.user = { id: 2, role: 'teacher', username: '乙' };
  const html = renderChatBubble({ kind: 'image', sender_user_id: 1, id: 42, created_at: '2026-08-08 12:00:00', thumb: 'data:image/jpeg;base64,THUMB', body: '' }, 0);
  assert.ok(html.includes('chat-bubble--media'), '媒体气泡');
  assert.ok(html.includes('THUMB') && !html.includes('chat-bubble--loading'), '缩略图直接展示、无加载骨架');
  state.user = null;
});

test('chatOpenImage：已带全图（data-full）→ 直开大图查看器；缩略图 → 拉原图后开', async () => {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="modal-container"></div><div id="toast-container"></div></body></html>', { url: 'http://localhost/' });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return []; } };
  state.user = { id: 1, role: 'teacher', username: '甲' };
  const { chatOpenImage } = await import('../src/client/features/chat/actions-misc.js');
  const { chat } = await import('../src/client/features/chat/chat-state.js');
  chat.convId = 9;
  const viewed = [];
  const { openImageViewer } = await import('../src/client/core/ui.js');
  const origOpen = openImageViewer;
  // We can't easily replace imported binding; use modal DOM instead.
  const fullImg = dom.window.document.createElement('img');
  fullImg.dataset.full = '1'; fullImg.src = 'data:image/jpeg;base64,FULL';
  await chatOpenImage(42, fullImg);
  assert.ok(dom.window.document.querySelector('.image-viewer-modal'), 'data-full 直开大图');
  dom.window.document.getElementById('modal-container').innerHTML = '';
  const thumbImg = dom.window.document.createElement('img');
  thumbImg.src = 'data:image/jpeg;base64,THUMB';
  globalThis.fetch = async url => ({ ok: true, status: 200, json: async () => ({ body: 'data:image/jpeg;base64,FULL' }) });
  await chatOpenImage(42, thumbImg);
  assert.ok(dom.window.document.querySelector('.image-viewer-modal'), '缩略图点击：拉原图后开大图');
  assert.equal(thumbImg.dataset.full, '1', '气泡 src 升级为原图');
  assert.equal(thumbImg.src, 'data:image/jpeg;base64,FULL');
  delete globalThis.document; delete globalThis.window; delete globalThis.fetch; delete globalThis.MutationObserver;
});
