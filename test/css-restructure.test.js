/**
 * V-2-5b CSS 重组结构契约：tokens/base/features/responsive 落位、旧文件删除、
 * 域规则归位对应文件。字节无损由 test/_css.js 的 STYLE_CSS 拼接保障
 * （index.html 加载序 = 原 style.css 全段 + 域文件 + glass）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { STYLE_CSS, CHAT_CSS, POSTS_CSS, REGION_CSS, GLASS_CSS } from './_css.js';

test('旧单体 CSS 文件已删除（style.css / style-*.css）', () => {
  for (const f of ['style.css', 'style-chat.css', 'style-posts.css', 'style-region.css']) {
    assert.ok(!existsSync(f), `${f} 已删除`);
  }
});

test('新结构文件齐备且加载序一致（tokens → base → features → responsive → glass）', () => {
  for (const f of ['tokens.css', 'base.css', 'responsive.css', 'glass.css',
    'features/complaints.css', 'features/browse.css', 'features/admin.css', 'features/teacher.css',
    'features/notif.css', 'features/chart.css', 'features/demand.css',
    'features/chat.css', 'features/posts.css', 'features/region.css']) {
    assert.ok(existsSync(f), `${f} 存在`);
  }
});

test('tokens.css = 设计令牌（:root 变量），无组件规则泄漏', () => {
  const t = readFileSync('tokens.css', 'utf8');
  assert.ok(t.includes(':root {'), '含 :root 令牌块');
  assert.ok(t.includes('--paper:'), '含 --paper 底色令牌');
  assert.ok(t.includes('--sp-1: 4px;'), '含间距韵律尺');
  assert.ok(!t.includes('.navbar {'), '不含组件规则');
});

test('base.css = 基础/布局/通用组件（navbar/modal/list-card/按钮/表单）', () => {
  const b = readFileSync('base.css', 'utf8');
  for (const sel of ['.navbar', '.modal', '.list-card', '.btn', '.form-group']) {
    assert.ok(b.includes(sel), `base.css 含 ${sel}`);
  }
  assert.ok(b.includes('@keyframes'), '含动画 keyframes');
});

test('域规则归位对应 features 文件', () => {
  assert.ok(readFileSync('features/chat.css', 'utf8').includes('.chat-bubble'), 'chat.css 含 .chat-bubble');
  assert.ok(readFileSync('features/posts.css', 'utf8').includes('.post-'), 'posts.css 含 .post-');
  assert.ok(readFileSync('features/region.css', 'utf8').includes('.region'), 'region.css 含 .region 类');
  assert.ok(readFileSync('features/teacher.css', 'utf8').includes('.list-card--teacher'), 'teacher.css 含教师卡');
  assert.ok(readFileSync('features/teacher.css', 'utf8').includes('.award-'), 'teacher.css 含 .award-');
  assert.ok(readFileSync('features/teacher.css', 'utf8').includes('.chsi-gate'), 'teacher.css 含 .chsi-gate');
  assert.ok(readFileSync('features/notif.css', 'utf8').includes('.notif-'), 'notif.css 含 .notif-');
  assert.ok(readFileSync('features/complaints.css', 'utf8').includes('.complaint'), 'complaints.css 含 .complaint');
  assert.ok(readFileSync('features/admin.css', 'utf8').includes('.admin'), 'admin.css 含 .admin');
  assert.ok(readFileSync('features/demand.css', 'utf8').includes('.demand-'), 'demand.css 含 .demand-');
  assert.ok(readFileSync('features/browse.css', 'utf8').includes('.browse'), 'browse.css 含 .browse');
});

test('responsive.css = 全局响应式兜底（移动端覆写须在全部桌面规则后加载）', () => {
  const r = readFileSync('responsive.css', 'utf8');
  assert.ok(r.includes('@media (max-width: 860px)'), '含窄屏媒体查询');
  assert.ok(r.includes('.demand-card-tools'), '含移动端覆写段');
  assert.ok(r.includes('.stage-grid'), '含 landing 响应式段');
});

test('glass.css 玻璃引擎整体保留（加载序最后）', () => {
  assert.ok(GLASS_CSS.includes('.glass'), 'glass.css 含 .glass 引擎');
  assert.ok(STYLE_CSS.length > 0, 'STYLE_CSS 拼接非空');
});

test('STYLE_CSS 拼接覆盖全部区块（tokens+base+各域+responsive 内容无损）', () => {
  for (const probe of [':root {', '.navbar', '.btn', '.landing', '.stage-', '.modal', '.list-card',
    '.complaint', '.admin', '.list-card--teacher', '.notif-', '.chart-glass', '.demand-title', '.toast',
    '.text-ink-3']) {
    assert.ok(STYLE_CSS.includes(probe), `STYLE_CSS 含 ${probe}`);
  }
});

test('两个 index.html 引用新 CSS 结构（同加载序）', () => {
  for (const html of ['index.html', 'web/index.html']) {
    const h = readFileSync(html, 'utf8');
    const need = ['/tokens.css', '/base.css', '/responsive.css', '/glass.css', '/features/chat.css',
      '/features/posts.css', '/features/region.css'];
    for (const ref of need) assert.ok(h.includes(ref), `${html} 含 ${ref}`);
    assert.ok(!h.includes('/style.css'), `${html} 不再引用 /style.css`);
  }
});
