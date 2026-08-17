/**
 * 前端启动回归（B4：直接 import src/client/app.js boot）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { boot } from '../src/client/app.js';

test('v2 app boot 可执行且不抛错', () => {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="modal-container"></div><div id="toast-container"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  const store = () => { const m = new Map(); return { getItem:k=>m.has(k)?m.get(k):null, setItem:(k,v)=>m.set(k,String(v)), removeItem:k=>m.delete(k) }; };
  globalThis.localStorage = store();
  globalThis.sessionStorage = store();
  globalThis.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return []; } };
  const result = boot();
  assert.ok(result && result.api, 'boot 返回 api');
  // 幂等：二次 boot 不抛
  boot();
  delete globalThis.document;
  delete globalThis.window;
  delete globalThis.localStorage;
  delete globalThis.sessionStorage;
});
