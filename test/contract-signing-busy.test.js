/**
 * Q-4a-M2：submitSigning 双提交守卫（POST 在途时 ✕ 关→重开→重交产生重复签约请求）。
 * 变异：删 signingBusy 锁 → 并发双调用发两次请求 → 红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { doSubmitSigning } from '../src/client/features/contract/actions-draft.js';

function setup() {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="modal-container"></div><div id="toast-container"></div></body></html>', { url: 'http://localhost/' });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.sessionStorage = dom.window.sessionStorage;
  globalThis.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return []; } };
  return dom;
}
function teardown() {
  delete globalThis.document; delete globalThis.window;
  delete globalThis.localStorage; delete globalThis.sessionStorage; delete globalThis.MutationObserver;
}

test('doSubmitSigning：POST 在途时并发第二次调用被锁（只发一次请求，Q-4a-M2）', async () => {
  setup();
  let apiCalls = 0;
  let release;
  const gate = new Promise(r => { release = r; });
  globalThis.fetch = async () => { apiCalls++; await gate; return { ok: true, status: 200, json: async () => ({ ok: true }) }; };
  const p1 = doSubmitSigning(7, { demandId: 1, price: 100, schedule: '周六上午', method: 'offline' });
  const p2 = doSubmitSigning(7, { demandId: 1, price: 100, schedule: '周六上午', method: 'offline' });
  await new Promise(r => setTimeout(r, 10));
  assert.equal(apiCalls, 1, 'POST 在途时第二次调用被锁（只发一次）');
  release();
  await Promise.all([p1, p2]);
  assert.equal(apiCalls, 1, '全程只发一次签约请求');
  delete globalThis.fetch; teardown();
});
