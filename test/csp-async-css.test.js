/**
 * V-3-1b CSP 收口：web/index.html 异步 CSS 去内联 onload → 外置 async-css.js media 交换。
 * 锁定：
 *   1. web/index.html 零内联事件/样式属性（onload/onclick/style）——onload 是 V-3-1a 盘点出的
 *      3 处内联，archtest 现有契约不查 onload，此处独立锁定（c3 再进 archtest）。
 *   2. async-css.js 双路径：sheet 已加载立即切 all；未加载注册 load 事件后切 all（时序兜底）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync('web/index.html', 'utf8');
const script = readFileSync('web/async-css.js', 'utf8');

test('web/index.html 零内联事件/样式属性；3 个异步 CSS link 走 data-async-css', () => {
  assert.ok(!/onload=/.test(html), '无内联 onload');
  assert.ok(!/onclick=/.test(html), '无内联 onclick');
  assert.ok(!/style=/.test(html), '无内联 style');
  assert.equal((html.match(/<link[^>]*data-async-css/g) || []).length, 3, '3 个异步 CSS link 带 data-async-css');
  assert.ok(html.includes('/async-css.js'), '引用外置 async-css.js');
  assert.ok(html.includes('media="print"'), '异步 CSS 保持 print 起始媒体');
});

test('async-css.js：sheet 已加载直接切 all；未加载注册 load 事件后切 all（双路径时序兜底）', () => {
  const dom = new JSDOM(`<!DOCTYPE html><html><head>
    <link rel="stylesheet" href="/a.css" media="print" data-async-css>
    <link rel="stylesheet" href="/b.css" media="print" data-async-css>
    <link rel="stylesheet" href="/plain.css" media="all">
  </head><body></body></html>`, { url: 'http://localhost/', pretendToBeVisual: true });
  const doc = dom.window.document;
  const links = doc.querySelectorAll('link[data-async-css]');
  assert.equal(links.length, 2, '只选中 data-async-css');
  // a：已加载（sheet 有值）；b：未加载（sheet 为 null，jsdom 默认）
  Object.defineProperty(links[0], 'sheet', { value: {} });
  // 在 jsdom 全局执行经典 IIFE（window.eval 的 realm 不暴露 document，用 node 全局 + 挂载）
  const prevDoc = globalThis.document, prevEvent = globalThis.Event;
  globalThis.document = doc;
  globalThis.Event = dom.window.Event;
  try { (0, eval)(script); } finally { globalThis.document = prevDoc; globalThis.Event = prevEvent; }
  assert.equal(links[0].media, 'all', 'sheet 已加载 → 立即切 all');
  assert.equal(links[1].media, 'print', '未加载 → 保留 print 等 load');
  links[1].dispatchEvent(new dom.window.Event('load'));
  assert.equal(links[1].media, 'all', 'load 事件 → 切 all');
  assert.equal(doc.querySelector('link[href="/plain.css"]').media, 'all', '非 data-async-css 的 link 不受影响');
});

test('async-css.js 自身无内联面（纯 IIFE，无 eval/new Function/fetch）', () => {
  assert.ok(!/\beval\(/.test(script), '无 eval');
  assert.ok(!/new Function/.test(script), '无 new Function');
  assert.ok(!/\bfetch\s*\(/.test(script), '无 fetch');
});
