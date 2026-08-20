import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { niceTicks, renderGlassLineChart } from '../src/client/core/chart.js';

const dom = new JSDOM('<!doctype html><html><body><div id="chart"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
globalThis.document = dom.window.document;
globalThis.window = dom.window;
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);

test('niceTicks clean 1/2/5 steps', () => {
  assert.deepEqual(niceTicks(0, 100, 4), [0, 50, 100]);
  assert.deepEqual(niceTicks(0, 1, 3), [0, 0.5, 1]);
});

test('renderGlassLineChart: full render, null segments, table and refresh', () => {
  const el = document.getElementById('chart');
  const ctl = renderGlassLineChart(el, {
    title: 'T', baselineAtZero: true, unit: 'day',
    data: [
      { label: '2026-01-01 10:00', value: 1 },
      { label: '2026-01-02 10:00', value: null },
      { label: '2026-01-03 10:00', value: 3 },
    ],
  });
  assert.ok(el.querySelector('.chart-glass'));
  assert.equal(el.querySelectorAll('path.chart-line').length, 2, 'null splits line segments');
  assert.equal(el.querySelectorAll('details.chart-table tbody tr').length, 3);
  const svg = el.querySelector('svg.chart-svg');
  assert.equal(svg.getAttribute('role'), 'img');
  assert.equal(typeof ctl.refresh, 'function');
  ctl.refresh();
  assert.ok(el.querySelector('.chart-glass'));
});

test('renderGlassLineChart: empty state text', () => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  renderGlassLineChart(el, { title: 'E', data: [{ label: 'a', value: null }], emptyText: 'EMPTY' });
  assert.equal(el.textContent.includes('EMPTY'), true);
  el.remove();
});

// Z-9-F3 回归：resize 监听器生命周期——同一容器重渲染不累积（同刻至多 1 活监听），dispose 后归 0。
// jsdom 无 getEventListeners，用 spy 包 addEventListener/removeEventListener 计数净活监听数。
test('Z-9-F3: repeated renders keep exactly one live resize listener; dispose releases it', () => {
  const el = document.getElementById('chart');
  // 清模块级残留：前序测试渲染后未 dispose 的监听器会污染计数（render→dispose 会摘旧挂新再清）
  const warm = renderGlassLineChart(el, { title: 'W', baselineAtZero: true, data: [{ label: 'd', value: 0 }] });
  warm.dispose();
  const addSpy = dom.window.addEventListener.bind(dom.window);
  const remSpy = dom.window.removeEventListener.bind(dom.window);
  let addCount = 0, remCount = 0;
  dom.window.addEventListener = (t, fn, o) => { if (t === 'resize') addCount++; addSpy(t, fn, o); };
  dom.window.removeEventListener = (t, fn, o) => { if (t === 'resize') remCount++; remSpy(t, fn, o); };
  const ctl1 = renderGlassLineChart(el, { title: 'A', baselineAtZero: true, data: [{ label: 'd', value: 1 }] });
  const ctl2 = renderGlassLineChart(el, { title: 'B', baselineAtZero: true, data: [{ label: 'd', value: 2 }] });
  const ctl3 = renderGlassLineChart(el, { title: 'C', baselineAtZero: true, data: [{ label: 'd', value: 3 }] });
  assert.equal(addCount, 3);
  assert.equal(remCount, 2, '每次重渲染摘掉旧监听器');
  assert.equal(addCount - remCount, 1, '同刻至多 1 个活 resize 监听器（泄漏修复）');
  ctl3.dispose();
  assert.equal(remCount, 3, 'dispose 移除自身监听器');
  assert.equal(addCount - remCount, 0, 'dispose 后无残留监听器');
  dom.window.addEventListener = addSpy;
  dom.window.removeEventListener = remSpy;
  void ctl1; void ctl2;
});

test('U-3j M-1: 双图同页各自 resize 重绘（单槽会让第二图移除第一图监听）', async () => {
  const a = document.createElement('div');
  const b = document.createElement('div');
  document.body.append(a, b);
  renderGlassLineChart(a, { title: 'A', data: [{ label: 'x', value: 1 }] });
  renderGlassLineChart(b, { title: 'B', data: [{ label: 'x', value: 2 }] });
  // marker 会被 draw() 的 container.innerHTML = '' 清空 → resize 重绘即消失
  const marker = document.createElement('i');
  marker.className = 'resize-marker';
  a.appendChild(marker);
  assert.ok(a.querySelector('.resize-marker'), 'marker 在位');
  dom.window.dispatchEvent(new dom.window.Event('resize'));
  // Poll instead of a fixed sleep (debounce 120ms; fixed 250ms is flaky under load).
  const t0 = Date.now();
  while (a.querySelector('.resize-marker') && Date.now() - t0 < 3000) await new Promise(r => setTimeout(r, 20));
  assert.ok(!a.querySelector('.resize-marker'), 'A 图 resize 后重绘（marker 被 draw 清空）——单槽 bug 下 A 监听被 B 移除、marker 保留');
  a.remove(); b.remove();
});
