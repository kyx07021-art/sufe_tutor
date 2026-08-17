/**
 * 需求九 标准浮窗「点击界外关闭」配置项（B4：直接 import core/ui-modal）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { openModal, closeModal, confirm } from '../src/client/core/ui-modal.js';

function setup() {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="modal-container"></div></body></html>', { url: 'http://localhost/' });
  globalThis.document = dom.window.document;
  return dom;
}
function overlayOnclick() {
  return globalThis.document.querySelector('.modal-overlay')?.getAttribute('onclick') || '';
}

test('openModal 默认：overlay 挂点遮罩关闭', () => {
  const dom = setup();
  openModal({ title: 't', body: 'b' });
  dom.window.document.querySelector('.modal-overlay').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(dom.window.document.querySelector('#modal-container').innerHTML, '', '默认点遮罩关闭');
  delete globalThis.document;
});

test('openModal({ closable:false })：overlay 无点遮罩关闭，✕ 仍保留', () => {
  const dom = setup();
  openModal({ title: 't', body: 'b', closable: false });
  assert.equal(overlayOnclick(), '');
  const closeBtn = globalThis.document.querySelector('.modal-header button');
  assert.ok(closeBtn, '✕ 关闭按钮存在');
  closeBtn.click();
  assert.equal(globalThis.document.querySelector('#modal-container').innerHTML, '', '✕ 可关闭');
  delete globalThis.document;
});

test('confirm 重认证：overlay 点遮罩不关；普通确认点遮罩关', async () => {
  const dom = setup();
  confirm({ message: 'danger', needReAuth: true, onConfirm: () => {} });
  dom.window.document.querySelector('.modal-overlay').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.ok(dom.window.document.querySelector('.modal-overlay'), '重认证点遮罩不关');
  closeModal();
  confirm({ message: 'ok', onConfirm: () => {} });
  dom.window.document.querySelector('.modal-overlay').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(dom.window.document.querySelector('#modal-container').innerHTML, '', '普通确认点遮罩关闭');
  await new Promise(r => setTimeout(r, 60)); // let reauth focus timer settle before deleting document
  delete globalThis.document;
});
