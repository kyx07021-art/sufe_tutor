/**
 * ZU (2026-08-27 用户反馈：移动端用户没发现侧栏可以打开，对着数字盲猜模块)：
 * 侧栏从未被打开过时，展开按钮呼吸式变色提示；打开一次后写标记 + 移除动效，永不再提示。
 * 设计定案（用户授权主会话自选配色/节奏）：品牌紫 var(--brand) + 3s ease-in-out 呼吸（opacity .55↔1），
 * reduced-motion 下动画禁用（保留品牌色静态提示，U3 主次——动效关闭但信息仍在）。
 * 打开路径唯一性实证：shell.js 的 toggle 是 .sidebar-open 唯一 add 源（router closeSidebar/backdrop/close
 * 均只 remove）→ 在 toggle handler 内写标记即覆盖「首次打开」全语义。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { mountShell } from '../src/client/core/shell.js';
import { _dhResetForTests } from '../src/client/core/datahub.js';
import { CONFIG } from '../src/shared/config.js';
import { getSidebarOpened } from '../src/client/core/state.js';

function createDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.sessionStorage = dom.window.sessionStorage;
  _dhResetForTests();
  return dom;
}
function teardown() {
  delete globalThis.localStorage; delete globalThis.sessionStorage;
  delete globalThis.document; delete globalThis.window;
}
function toggle() { return globalThis.document.querySelector('[data-action="shell.toggleSidebar"]'); }

test('ZU-1 从未打开过 → 展开按钮带 .sidebar-hint（首访呼吸提示）', (t) => {
  const dom = createDom();
  globalThis.localStorage.removeItem(CONFIG.SIDEBAR_OPENED_KEY);
  mountShell();
  t.after(teardown);
  const btn = toggle();
  assert.ok(btn, '侧栏展开按钮存在');
  assert.ok(btn.classList.contains('sidebar-hint'), '无标记 → hint 类在（变异：删 classList.add → 红）');
  assert.equal(getSidebarOpened(), false, '标记未写入');
});

test('ZU-1 点击展开 → 写标记 + 移除 hint + sidebar-open', (t) => {
  const dom = createDom();
  globalThis.localStorage.removeItem(CONFIG.SIDEBAR_OPENED_KEY);
  mountShell();
  t.after(teardown);
  const btn = toggle();
  btn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.ok(dom.window.document.body.classList.contains('sidebar-open'), '侧栏展开');
  assert.equal(globalThis.localStorage.getItem(CONFIG.SIDEBAR_OPENED_KEY), '1', '标记已写入（变异：删 markSidebarOpened → 红）');
  assert.ok(!btn.classList.contains('sidebar-hint'), 'hint 已移除（变异：删 remove → 红）');
});

test('ZU-1 已打开过（标记在）→ 无 hint', (t) => {
  const dom = createDom();
  globalThis.localStorage.setItem(CONFIG.SIDEBAR_OPENED_KEY, '1');
  mountShell();
  t.after(teardown);
  assert.ok(!toggle().classList.contains('sidebar-hint'), '有标记 → 无 hint（变异：删读取 → 红）');
});

test('ZU-2 呼吸动效 CSS 契约（responsive.css 移动端区块）', () => {
  const rcss = readFileSync('responsive.css', 'utf8');
  assert.ok(rcss.includes('.sidebar-expand-toggle.sidebar-hint {') && rcss.includes('animation: zu-breathe 3s ease-in-out infinite;'),
    'hint 呼吸动画规则在位（变异：删规则 → 红）');
  assert.ok(rcss.includes('@keyframes zu-breathe') && rcss.includes('opacity: .55') && rcss.includes('opacity: 1;'),
    '呼吸 keyframes 双端 opacity（0.55 ↔ 1）');
  assert.ok(rcss.includes('color: var(--brand);'), '呼吸配色品牌紫（用户授权主会话定案）');
  assert.ok(rcss.includes('@media (prefers-reduced-motion: reduce)') && rcss.includes('.sidebar-expand-toggle.sidebar-hint { animation: none; }'),
    'reduced-motion 豁免（动效关闭但品牌色静态提示仍在，U3 主次）');
});
