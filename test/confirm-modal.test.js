/**
 * v0.25.10 confirm 回归（B4：直接 import core/ui-modal）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { confirm, closeModal } from '../src/client/core/ui-modal.js';

function setup() {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="modal-container"></div></body></html>', { url: 'http://localhost/' });
  globalThis.document = dom.window.document;
  return dom;
}

test('confirm() 普通二次确认：confirm-msg 正文、确认触发闭包并关窗', async () => {
  const dom = setup();
  let fired = 0;
  confirm({ title: '删除确认', message: '真的要删吗', onConfirm: () => { fired++; } });
  const h = dom.window.document.querySelector('#modal-container .modal-header');
  assert.ok(h && h.textContent.includes('删除确认'));
  assert.ok(dom.window.document.querySelector('.confirm-msg'));
  const btns = [...dom.window.document.querySelectorAll('.modal-footer .btn')];
  const confirmBtn = btns.find(b => b.textContent === '确定');
  assert.ok(confirmBtn);
  confirmBtn.click();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(fired, 1);
  assert.equal(dom.window.document.querySelector('#modal-container .modal-overlay'), null);
  delete globalThis.document;
});

test('confirm({ needReAuth: true })：密码换 capToken 后 onConfirm(capToken) 并关窗', async () => {
  const dom = setup();
  const saved = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/api/auth/re-auth')) return { ok: true, status: 200, json: async () => ({ capToken: 'CAP_TOKEN_1' }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  let got = null;
  confirm({ message: '重认证', needReAuth: true, onConfirm: capToken => { got = capToken; } });
  const pwd = dom.window.document.getElementById('reauth-password');
  pwd.value = 'pw';
  const okBtn = [...dom.window.document.querySelectorAll('.modal-footer .btn')].find(b => b.textContent === '确定');
  okBtn.click();
  await new Promise(r => setTimeout(r, 50));
  globalThis.fetch = saved;
  assert.equal(got, 'CAP_TOKEN_1');
  assert.equal(dom.window.document.querySelector('#modal-container .modal-overlay'), null);
  delete globalThis.document;
});
