/**
 * ZS-3b（2026-08-27）：visualViewport 补偿直接单测——positionCustomSelectPanel / positionFloatCard
 * 均为 position:fixed 定位，iOS URL-bar 类浏览器需减去 visualViewport offset（dom.js visualViewportOffset）。
 * 审计观察项 G2 缺口闭合：mock document.defaultView.visualViewport 非零 offset，断言 left/top 各减对应分量。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { positionCustomSelectPanel, positionFloatCard } from '../src/client/core/anim.js';
import { CONFIG } from '../src/shared/config.js';

function setupDom(vw, vh, vo) {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost/' });
  globalThis.document = dom.window.document;
  Object.defineProperty(document.documentElement, 'clientWidth', { value: vw, configurable: true });
  Object.defineProperty(document.documentElement, 'clientHeight', { value: vh, configurable: true });
  if (vo) Object.defineProperty(document.defaultView, 'visualViewport', { value: vo, configurable: true });
  return dom;
}
function teardownDom() { delete globalThis.document; }

test('ZS-3b positionCustomSelectPanel：visualViewport 非零 offset 时 left/top 各减对应分量', () => {
  setupDom(1000, 800, { offsetLeft: 40, offsetTop: 60 });
  const panel = document.createElement('div');
  Object.defineProperty(panel, 'offsetWidth', { value: 120, configurable: true });
  Object.defineProperty(panel, 'offsetHeight', { value: 200, configurable: true });
  const trig = document.createElement('button');
  trig.getBoundingClientRect = () => ({ left: 200, width: 120, bottom: 300, top: 260 });
  const wrap = { _customPanel: panel, querySelector: () => trig };
  positionCustomSelectPanel(wrap);
  assert.equal(panel.style.left, '160px', 'left = rect.left - vo.x (200-40)');
  assert.equal(panel.style.top, '246px', 'top = (rect.bottom+6) - vo.y (306-60)');
  teardownDom();
});

test('ZS-3b positionFloatCard：visualViewport 非零 offset 时 left/top 各减对应分量', () => {
  setupDom(1000, 800, { offsetLeft: 40, offsetTop: 60 });
  const btn = document.createElement('button');
  btn.getBoundingClientRect = () => ({ left: 300, width: 150, bottom: 400 });
  const card = document.createElement('div');
  Object.defineProperty(card, 'offsetWidth', { value: 220, configurable: true });
  positionFloatCard(btn, card);
  assert.equal(card.style.left, '260px', 'left = rect.left - vo.x (300-40)');
  assert.equal(card.style.top, `${400 + CONFIG.MAX_MATCH_DETAIL_OFFSET - 60}px`, 'top = rect.bottom + MAX_MATCH_DETAIL_OFFSET - vo.y');
  teardownDom();
});

test('ZS-3b 无 visualViewport（非 iOS 类/无 window 环境）→ 零补偿严格身份', () => {
  setupDom(1000, 800, null);
  const panel = document.createElement('div');
  Object.defineProperty(panel, 'offsetWidth', { value: 120, configurable: true });
  Object.defineProperty(panel, 'offsetHeight', { value: 200, configurable: true });
  const trig = document.createElement('button');
  trig.getBoundingClientRect = () => ({ left: 200, width: 120, bottom: 300, top: 260 });
  positionCustomSelectPanel({ _customPanel: panel, querySelector: () => trig });
  assert.equal(panel.style.left, '200px');
  assert.equal(panel.style.top, '306px');
  teardownDom();
});
