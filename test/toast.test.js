/**
 * v0.25.99 Toast 全站提示组件（取代 alert 浮窗内红条）
 *
 * 背景：表单浮窗顶部的 .alert 提示条（--g-surface 左红竖条）全站连根删——
 * 所有表单校验/错误/成功提醒统一走底部 Toast（showToast(msg, kind) 全风格）。
 * 本文件覆盖：
 *   - 层级：toast 浮于 modal-overlay 之上（z-index 300 > 200）
 *   - 定位/堆叠：fixed 底部容器 flex 堆叠
 *   - kind 全风格：无 --g-surface 左竖条（v0.25.99 教训：语义条机制不再用于提示）
 *   - 定时退场：驻留后切 .toast--out 再移除节点
 *   - 连根删红例：.alert 规则 / alertHtml 函数 / alert 容器零残留
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { showToast } from '../src/client/core/ui.js';
import { CONFIG } from '../src/shared/config.js';
import { STYLE_CSS } from './_css.js';

async function waitFor(cond, timeout = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (cond()) return true;
    await new Promise(r => setTimeout(r, 20));
  }
  return cond();
}

test('层级：toast 容器 z-index 高于 modal-overlay（浮于一切弹窗之上）', () => {
  const css = STYLE_CSS;
  const box = (css.split('#toast-container {')[1] || '').split('}')[0];
  assert.ok(box.includes('z-index: 300'), 'toast 容器 z-index: 300');
  const overlay = (css.split('.modal-overlay {')[1] || '').split('}')[0];
  assert.ok(overlay.includes('z-index: 200'), 'modal-overlay z-index: 200');
});

test('toast 定位：fixed 底部居中、flex 堆叠多条、指针穿透容器', () => {
  const css = STYLE_CSS;
  const box = (css.split('#toast-container {')[1] || '').split('}')[0];
  assert.ok(box.includes('position: fixed') && box.includes('bottom: 24px'), 'fixed 底部定位');
  assert.ok(box.includes('flex-direction: column') && box.includes('align-items: center'), 'flex 堆叠居中');
  assert.ok(box.includes('pointer-events: none'), '容器不挡点击');
});

test('kind 全风格走 --g-fill/--g-fg，无 --g-surface 左竖条（v0.25.99 教训）', () => {
  const css = STYLE_CSS;
  for (const kind of ['error', 'success', 'warn']) {
    const rule = (css.split(`.toast.toast--${kind} {`)[1] || '').split('}')[0];
    assert.ok(rule.includes('--g-fill'), `${kind} 态设底色`);
    assert.ok(rule.includes('--g-fg'), `${kind} 态设文字色`);
    assert.ok(!rule.includes('--g-surface'), `${kind} 态无 --g-surface 语义条（禁左竖条回归）`);
  }
});

test('退场时序：驻留后切 .toast--out，退场动画后移除节点', async () => {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="toast-container"></div></body></html>', { url: 'http://localhost/' });
  globalThis.document = dom.window.document;
  const oldMs = CONFIG.TOAST_MS, oldFade = CONFIG.TOAST_FADE_MS;
  CONFIG.TOAST_MS = 50; CONFIG.TOAST_FADE_MS = 40;
  showToast('x', 'error');
  const el = globalThis.document.querySelector('#toast-container .toast');
  const gotOut = await waitFor(() => el && el.classList.contains('toast--out'));
  assert.ok(gotOut, '驻留期后切 .toast--out');
  assert.ok(el.isConnected, '退场动画期间节点仍在 DOM');
  const removed = await waitFor(() => !globalThis.document.querySelector('#toast-container .toast'));
  assert.ok(removed, '退场动画后节点移除');
  CONFIG.TOAST_MS = oldMs; CONFIG.TOAST_FADE_MS = oldFade;
  delete globalThis.document;
});

test('连根删红例：alert 组件全站零残留（CSS 规则 / JS 函数 / 容器；注释留痕不算）', () => {
  // 只查规则形式：.alert { / .alert-error { 等（注释里引用历史组件名的留痕允许）
  const css = STYLE_CSS + readFileSync('./glass.css', 'utf8');
  assert.ok(!/\.alert\s*\{/.test(css), '无 .alert 基础规则');
  assert.ok(!/\.alert-(error|success|warn)\s*\{/.test(css), '无三色 alert 规则');
  assert.ok(!/\.gaokao-mismatch-warn[^}]*--g-surface/.test(css), '独立提示无 --g-surface 竖条');
  // V-4-1h：v1 app-*.js 已删；alert 零残留扫描改为 v2 全域源码（core + features）
  const core = readdirSync('./src/client/core').filter(f => f.endsWith('.js')).map(f => readFileSync('./src/client/core/' + f, 'utf8')).join('\n');
  const features = readdirSync('./src/client/features', { recursive: true }).filter(f => String(f).endsWith('.js')).map(f => readFileSync('./src/client/features/' + f, 'utf8')).join('\n');
  const app = core + '\n' + features;
  assert.ok(!/function alertHtml|alertHtml\(/.test(app), 'JS 无 alertHtml 定义/调用');
  assert.ok(!app.includes("id=\"post-alert\"") && !app.includes("id=\"contract-alert\"") && !app.includes("id=\"demand-alert\"")
    && !app.includes("id=\"complaint-alert\"") && !app.includes("id=\"review-alert\"") && !app.includes("id=\"login-alert\"")
    && !app.includes("id=\"register-alert\"") && !app.includes("id=\"invite-gate-alert\"") && !app.includes("id=\"profile-alert\""),
    'JS 无任何 alert 容器渲染');
  const html = readFileSync('./web/index.html', 'utf8');
  assert.ok(!html.includes('-alert'), 'web/index.html 无 alert 容器');
});
