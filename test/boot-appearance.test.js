/**
 * Q-6-M2：boot 装配 appearance（--g-grid 注入 + .lg-orb 生成，Z-14-F2 复发锁）。
 * Z-14-F2 根因：appearance.js 定义 applyLg/applyOrbs/applyTheme/initAppearance 但 boot 从未装配 →
 * 光球零生成 + --g-grid 未注入 → 主页背景元素全没了。此断言锁 boot 后装配真实发生。
 * 独立文件（booted 幂等标志跨测试共享，同文件第二个 boot 会跳过 initAppearance）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { boot } from '../src/client/app.js';

test('boot 装配 appearance：--g-grid 主题变量注入 + .lg-orb 光球生成', () => {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="modal-container"></div><div id="toast-container"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  const store = () => { const m = new Map(); return { getItem:k=>m.has(k)?m.get(k):null, setItem:(k,v)=>m.set(k,String(v)), removeItem:k=>m.delete(k) }; };
  globalThis.localStorage = store();
  globalThis.sessionStorage = store();
  globalThis.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return []; } };
  boot();
  assert.ok(dom.window.document.documentElement.style.getPropertyValue('--g-grid'), '--g-grid 主题变量已注入（applyTheme 装配）');
  assert.ok(dom.window.document.querySelectorAll('.lg-orb').length > 0, '.lg-orb 光球已生成（applyOrbs 装配）');
  delete globalThis.document;
  delete globalThis.window;
  delete globalThis.localStorage;
  delete globalThis.sessionStorage;
});
