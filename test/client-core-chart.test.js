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
