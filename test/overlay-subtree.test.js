/**
 * 浮窗幽灵下拉栏：组件附属树（B4：直接 import core/anim + core/ui-modal）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { openModal, closeModal } from '../src/client/core/ui-modal.js';
import { registerOverlay, closeHostOverlays, toggleCustomSelect } from '../src/client/core/anim.js';
import { initCustomSelects } from '../src/client/core/ui.js';

function setup() {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="modal-container"></div></body></html>', { url: 'http://localhost/' });
  globalThis.document = dom.window.document;
  globalThis.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return []; } };
  return dom;
}

test('浮窗内呼出下拉、关浮窗后下拉面板级联关闭', () => {
  const dom = setup();
  openModal({ title: '测试', body: '<select class="form-select" id="demo-sel"><option value="a">A</option></select>' });
  initCustomSelects(dom.window.document.getElementById('modal-container'));
  toggleCustomSelect(dom.window.document.querySelector('#modal-container .custom-select'));
  assert.equal(dom.window.document.querySelectorAll('.custom-select-panel.open').length, 1);
  closeModal();
  assert.equal(dom.window.document.querySelectorAll('.custom-select-panel.open').length, 0);
  delete globalThis.document;
});

test('换弹窗时旧窗内的打开下拉一并级联关闭', () => {
  const dom = setup();
  openModal({ title: '旧', body: '<select class="form-select"><option value="a">A</option></select>' });
  initCustomSelects(dom.window.document.getElementById('modal-container'));
  toggleCustomSelect(dom.window.document.querySelector('#modal-container .custom-select'));
  assert.equal(dom.window.document.querySelectorAll('.custom-select-panel.open').length, 1);
  openModal({ title: '新', body: '<p>新内容</p>' });
  assert.equal(dom.window.document.querySelectorAll('.custom-select-panel.open').length, 0);
  delete globalThis.document;
});

test('附属树接口：registerOverlay 幂等登记、closeHostOverlays 级联关闭', () => {
  const dom = setup();
  const host = dom.window.document.getElementById('modal-container');
  const key = dom.window.document.createElement('div');
  let fired = 0;
  registerOverlay(host, () => fired++, key);
  registerOverlay(host, () => fired++, key);
  closeHostOverlays(host);
  assert.equal(fired, 1);
  closeHostOverlays(host);
  assert.equal(fired, 1);
  delete globalThis.document;
});

test('页面级下拉打开不登记宿主，关弹窗不影响页面级下拉', () => {
  const dom = setup();
  dom.window.document.body.insertAdjacentHTML('beforeend', '<select class="form-select" id="page-sel"><option value="a">A</option></select>');
  initCustomSelects(dom.window.document.body);
  toggleCustomSelect(dom.window.document.querySelector('#page-sel').closest('.custom-select'));
  assert.equal(dom.window.document.querySelectorAll('.custom-select-panel.open').length, 1);
  closeModal();
  assert.equal(dom.window.document.querySelectorAll('.custom-select-panel.open').length, 1);
  delete globalThis.document;
});
