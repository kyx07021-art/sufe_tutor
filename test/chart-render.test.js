/**
 * app-chart.js 组件真实渲染回归（jsdom）
 * 教训来源：v0.22.1 流量监测页一进去就报
 *   "Cannot read properties of undefined (reading 'slice')"——
 *   xLabels 的 fmtL 期望数据点对象却收到 label 字符串。语法检查/单测盖不到运行时渲染，
 *   此文件用 jsdom 真实跑一遍 renderGlassLineChart，确保图表任何数据形态都不炸。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><head></head><body><div id="c1"></div></body></html>', { pretendToBeVisual: true });
global.window = dom.window;
global.document = dom.window.document;
global.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);

// 经典脚本 IIFE：import 即执行并挂 window.renderGlassLineChart
await import('../app-chart.js');
const renderGlassLineChart = dom.window.renderGlassLineChart;

test('app-chart 渲染：小时粒度流量图产出完整图表结构', () => {
  const c = document.getElementById('c1');
  assert.doesNotThrow(() => renderGlassLineChart(c, {
    title: '站点总流量',
    colorVar: '--chart-traffic',
    data: Array.from({ length: 24 }, (_, i) => ({ label: `2026-08-07 ${String(i).padStart(2, '0')}:00`, value: i * 10 })),
    unit: 'hour',
    baselineAtZero: true,
  }));
  const html = c.innerHTML;
  assert.ok(html.includes('chart-line'), '应渲染折线');
  assert.ok(html.includes('chart-area'), '应渲染线下面积');
  assert.ok(html.includes('chart-axis-x'), '应渲染 X 轴');
  assert.ok(/07:00|06:00/.test(html), 'X 轴标签应为小时粒度');
  assert.ok(html.includes('chart-table'), '应有数据明细表');
});

test('app-chart 渲染：日粒度延迟图含 null 缺测不炸', () => {
  const c = document.createElement('div');
  document.body.appendChild(c);
  assert.doesNotThrow(() => renderGlassLineChart(c, {
    title: '平均延迟',
    colorVar: '--chart-latency',
    data: [
      { label: '2026-08-01', value: null },
      { label: '2026-08-02', value: 200 },
      { label: '2026-08-03', value: null },
      { label: '2026-08-04', value: 150 },
    ],
    unit: 'day',
    baselineAtZero: false,
    valueFmt: v => (v == null ? '—' : `${Math.round(v)} ms`),
  }));
  assert.ok(c.innerHTML.includes('chart-line'));
});

test('app-chart 渲染：空数据态显示占位而非抛错', () => {
  const c = document.createElement('div');
  document.body.appendChild(c);
  assert.doesNotThrow(() => renderGlassLineChart(c, { title: '空', data: [], unit: 'day' }));
  assert.ok(c.innerHTML.includes('chart-empty'));
});

test('app-chart 渲染：单点数据（极端数据形态）不炸', () => {
  const c = document.createElement('div');
  document.body.appendChild(c);
  assert.doesNotThrow(() => renderGlassLineChart(c, { title: '单点', data: [{ label: '2026-08-07', value: 5 }], unit: 'day' }));
});
