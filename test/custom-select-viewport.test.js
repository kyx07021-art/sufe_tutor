/**
 * ZG-1（2026-08-26）：自定义选择器展开面板视口边缘检测——右部空间不足左移、左部空间不足右移、
 * 底部空间不足上移，保证选项列表完整显示在屏幕可见区域内（positionCustomSelectPanel）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { positionCustomSelectPanel } from '../src/client/core/anim.js';
import { CONFIG } from '../src/shared/config.js';

const M = CONFIG.CUSTOM_SELECT_EDGE_MARGIN;

function setup({ vw, vh, trigRect, panelW, panelH }) {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost/' });
  globalThis.document = dom.window.document;
  Object.defineProperty(document.documentElement, 'clientWidth', { value: vw, configurable: true });
  Object.defineProperty(document.documentElement, 'clientHeight', { value: vh, configurable: true });
  const panel = document.createElement('div');
  Object.defineProperty(panel, 'offsetWidth', { value: panelW, configurable: true });
  Object.defineProperty(panel, 'offsetHeight', { value: panelH, configurable: true });
  const trig = document.createElement('button');
  trig.getBoundingClientRect = () => trigRect;
  const wrap = { _customPanel: panel, querySelector: () => trig };
  return { wrap, panel };
}

test('ZG-1 正常：面板贴合触发器（原位 + 下缘 +6）', () => {
  const { wrap, panel } = setup({ vw: 1000, vh: 800, trigRect: { left: 200, width: 120, bottom: 300, top: 260 }, panelW: 120, panelH: 200 });
  positionCustomSelectPanel(wrap);
  assert.equal(panel.style.left, '200px');
  assert.equal(panel.style.top, '306px');
  assert.equal(panel.style.width, '120px');
  delete globalThis.document;
});

test('ZG-1 右部空间不足 → 向左移动（面板右缘贴视口）', () => {
  const { wrap, panel } = setup({ vw: 1000, vh: 800, trigRect: { left: 980, width: 120, bottom: 300, top: 260 }, panelW: 120, panelH: 200 });
  positionCustomSelectPanel(wrap);
  const expected = Math.max(1000 - 120 - M, M);
  assert.equal(panel.style.left, `${expected}px`, `左移至右缘贴边距 (left=${expected})`);
  delete globalThis.document;
});

test('ZG-1 左部空间不足 → 向右移动（左缘贴边距）', () => {
  const { wrap, panel } = setup({ vw: 1000, vh: 800, trigRect: { left: -40, width: 120, bottom: 300, top: 260 }, panelW: 120, panelH: 200 });
  positionCustomSelectPanel(wrap);
  assert.equal(panel.style.left, `${M}px`);
  delete globalThis.document;
});

test('ZG-1 底部空间不足 → 面板上移（选项列表完整可见）', () => {
  const { wrap, panel } = setup({ vw: 1000, vh: 800, trigRect: { left: 200, width: 120, bottom: 780, top: 740 }, panelW: 120, panelH: 200 });
  positionCustomSelectPanel(wrap);
  const expected = Math.max(740 - 200 - 6, M);
  assert.equal(panel.style.top, `${expected}px`, `上移至触发器上方 (top=${expected})`);
  delete globalThis.document;
});
