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
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';

function makeCtx() {
  const html = '<!DOCTYPE html><html><body><div id="toast-container"></div><div id="modal-container"></div></body></html>';
  const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
  const w = dom.window;
  const ctx = vm.createContext({
    window: w, document: w.document,
    getComputedStyle: w.getComputedStyle.bind(w),
    localStorage: w.localStorage,
    console, fetch: globalThis.fetch, setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout, Request: globalThis.Request,
    MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
    requestAnimationFrame: (cb) => setTimeout(cb, 16), cancelAnimationFrame: () => {},
    matchMedia: () => ({ matches: false, addEventListener: () => {} }),
  });
  for (const f of ['constants.js', 'app-state.js', 'app-api.js', 'app-anim.js', 'app-ui.js']) {
    vm.runInContext(readFileSync('./' + f, 'utf8'), ctx, { filename: f });
  }
  return { ctx, dom };
}

test('层级：toast 容器 z-index 高于 modal-overlay（浮于一切弹窗之上）', () => {
  const css = readFileSync('./style.css', 'utf8');
  const box = (css.split('#toast-container {')[1] || '').split('}')[0];
  assert.ok(box.includes('z-index: 300'), 'toast 容器 z-index: 300');
  const overlay = (css.split('.modal-overlay {')[1] || '').split('}')[0];
  assert.ok(overlay.includes('z-index: 200'), 'modal-overlay z-index: 200');
});

test('toast 定位：fixed 底部居中、flex 堆叠多条、指针穿透容器', () => {
  const css = readFileSync('./style.css', 'utf8');
  const box = (css.split('#toast-container {')[1] || '').split('}')[0];
  assert.ok(box.includes('position: fixed') && box.includes('bottom: 24px'), 'fixed 底部定位');
  assert.ok(box.includes('flex-direction: column') && box.includes('align-items: center'), 'flex 堆叠居中');
  assert.ok(box.includes('pointer-events: none'), '容器不挡点击');
});

test('kind 全风格走 --g-fill/--g-fg，无 --g-surface 左竖条（v0.25.99 教训）', () => {
  const css = readFileSync('./style.css', 'utf8');
  for (const kind of ['error', 'success', 'warn']) {
    const rule = (css.split(`.toast.toast--${kind} {`)[1] || '').split('}')[0];
    assert.ok(rule.includes('--g-fill'), `${kind} 态设底色`);
    assert.ok(rule.includes('--g-fg'), `${kind} 态设文字色`);
    assert.ok(!rule.includes('--g-surface'), `${kind} 态无 --g-surface 语义条（禁左竖条回归）`);
  }
});

// 轮询等待条件成立（防并行 CPU 竞争下固定 sleep 不可靠的 flake）
async function waitFor(cond, timeout = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (cond()) return true;
    await new Promise(r => setTimeout(r, 20));
  }
  return cond();
}

test('退场时序：驻留后切 .toast--out，退场动画后移除节点', async () => {
  const { ctx, dom } = makeCtx();
  // 短参数 + 轮询断言（不依赖固定 sleep，杜绝并行 flake）
  vm.runInContext('CONFIG.TOAST_MS = 50; CONFIG.TOAST_FADE_MS = 40; showToast("x", "error");', ctx);
  const el = dom.window.document.querySelector('#toast-container .toast');
  assert.ok(el, 'toast 节点挂载');
  const gotOut = await waitFor(() => el.classList.contains('toast--out'));
  assert.ok(gotOut, '驻留期后切 .toast--out');
  assert.ok(el.isConnected, '退场动画期间节点仍在 DOM（动画播完才移除）');
  const removed = await waitFor(() => !dom.window.document.querySelector('#toast-container .toast'));
  assert.ok(removed, '退场动画后节点移除');
});

test('连根删红例：alert 组件全站零残留（CSS 规则 / JS 函数 / 容器；注释留痕不算）', () => {
  // 只查规则形式：.alert { / .alert-error { 等（注释里引用历史组件名的留痕允许）
  const css = readFileSync('./style.css', 'utf8') + readFileSync('./glass.css', 'utf8');
  assert.ok(!/\.alert\s*\{/.test(css), '无 .alert 基础规则');
  assert.ok(!/\.alert-(error|success|warn)\s*\{/.test(css), '无三色 alert 规则');
  assert.ok(!/\.gaokao-mismatch-warn[^}]*--g-surface/.test(css), '独立提示无 --g-surface 竖条');
  const app = ['app-ui.js', 'app-posts.js', 'app-contracts.js', 'app-demands.js', 'app-pages.js',
    'app-auth.js', 'app-complaints.js', 'app-teachers.js', 'app-region.js', 'app-anim.js', 'app-shell.js', 'app-chat.js']
    .map(f => readFileSync('./' + f, 'utf8')).join('\n');
  assert.ok(!/function alertHtml|alertHtml\(/.test(app), 'JS 无 alertHtml 定义/调用');
  assert.ok(!app.includes("id=\"post-alert\"") && !app.includes("id=\"contract-alert\"") && !app.includes("id=\"demand-alert\"")
    && !app.includes("id=\"complaint-alert\"") && !app.includes("id=\"review-alert\"") && !app.includes("id=\"login-alert\"")
    && !app.includes("id=\"register-alert\"") && !app.includes("id=\"invite-gate-alert\"") && !app.includes("id=\"profile-alert\""),
    'JS 无任何 alert 容器渲染');
  const html = readFileSync('./index.html', 'utf8');
  assert.ok(!html.includes('-alert'), 'index.html 无 alert 容器');
});
