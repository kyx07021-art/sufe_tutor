/**
 * v0.25.98 弹窗栈回归（B4：直接 import core/ui-modal）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { openModal, closeModal, closeAllModals, confirm } from '../src/client/core/ui-modal.js';

function setup() {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="modal-container"></div></body></html>', { url: 'http://localhost/' });
  globalThis.document = dom.window.document;
  return dom;
}
function title() {
  const h = globalThis.document.querySelector('#modal-container .modal-header h2');
  return h ? h.textContent : null;
}

test('核心回归：表单 → 预览 → 关闭 → 下层表单恢复且已输入内容保留', () => {
  const dom = setup();
  openModal({ title: '发帖表单', closable: false, body: '<input id="post-title" class="form-input">' });
  globalThis.document.getElementById('post-title').value = '用户已输入标题';
  openModal({ title: '预览', body: '<p>preview</p>' });
  assert.equal(title(), '预览');
  closeModal();
  assert.equal(title(), '发帖表单');
  assert.equal(globalThis.document.getElementById('post-title').value, '用户已输入标题');
  delete globalThis.document;
});

test('confirm 二次确认：关闭后恢复下层表单', () => {
  const dom = setup();
  openModal({ title: '需求表单', closable: false, body: '<input id="f" value="v">' });
  confirm({ message: '确定要这么做吗？', onConfirm: () => {} });
  assert.ok(globalThis.document.querySelector('.confirm-msg'));
  closeModal();
  assert.equal(title(), '需求表单');
  assert.equal(globalThis.document.getElementById('f').value, 'v');
  delete globalThis.document;
});

test('replace:true：同流程 loading→表单直接替换', () => {
  const dom = setup();
  openModal({ title: '加载中', closable: false, body: '<div class="empty-state">loading</div>' });
  openModal({ title: '签约表单', closable: false, replace: true, body: '<div id="form-marker"></div>' });
  assert.equal(title(), '签约表单');
  assert.equal(globalThis.document.querySelectorAll('#modal-container .modal').length, 1);
  closeModal();
  assert.equal(globalThis.document.getElementById('modal-container').innerHTML, '');
  delete globalThis.document;
});

test('三层连续嵌套：依次弹栈恢复到底', () => {
  const dom = setup();
  openModal({ title: 'A', body: '1' });
  openModal({ title: 'B', body: '2' });
  openModal({ title: 'C', body: '3' });
  assert.equal(title(), 'C');
  closeModal(); assert.equal(title(), 'B');
  closeModal(); assert.equal(title(), 'A');
  closeModal();
  assert.equal(globalThis.document.getElementById('modal-container').innerHTML, '');
  delete globalThis.document;
});

test('closeAllModals：清栈 + 清容器，后续 closeModal 不复活', () => {
  const dom = setup();
  openModal({ title: 'A', body: '1' });
  openModal({ title: 'B', body: '2' });
  closeAllModals();
  assert.equal(globalThis.document.getElementById('modal-container').innerHTML, '');
  closeModal();
  assert.equal(globalThis.document.getElementById('modal-container').innerHTML, '');
  delete globalThis.document;
});
