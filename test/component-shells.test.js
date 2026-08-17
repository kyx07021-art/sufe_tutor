/**
 * 标准组件壳回归（B4：直接 import core/ui + core/anim）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { showToast, btnLoading, btnDone, checkboxItemsHtml } from '../src/client/core/ui.js';
import { positionFloatCard } from '../src/client/core/anim.js';

function setup() {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="box"></div><div id="toast-container"></div></body></html>', { url: 'http://localhost/' });
  globalThis.document = dom.window.document;
  globalThis.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return []; } };
  return dom;
}

test('showToast：全风格 kind 类名 + textContent 转义', () => {
  const dom = setup();
  showToast('<img src=x onerror=alert(1)>', 'error');
  const el = dom.window.document.querySelector('#toast-container .toast');
  assert.ok(el);
  assert.ok(el.classList.contains('toast--error'));
  assert.equal(el.querySelector('img'), null);
  assert.equal(el.textContent, '<img src=x onerror=alert(1)>');
  delete globalThis.document;
});

test('showToast：success/warn 类 + info 缺省 + 多条堆叠', () => {
  const dom = setup();
  showToast('a', 'success'); showToast('b'); showToast('c', 'warn');
  const els = [...dom.window.document.querySelectorAll('#toast-container .toast')];
  assert.equal(els.length, 3);
  assert.ok(els[0].classList.contains('toast--success'));
  assert.ok(els[1].classList.contains('toast--info'));
  assert.ok(els[2].classList.contains('toast--warn'));
  assert.equal(els[0].textContent, 'a');
  delete globalThis.document;
});

test('btnLoading/btnDone：禁用+spinner，还原后 textContent 恢复', () => {
  const dom = setup();
  const btn = dom.window.document.createElement('button');
  btn.textContent = '发送';
  dom.window.document.body.appendChild(btn);
  btnLoading(btn, '发送中');
  assert.equal(btn.disabled, true);
  assert.ok(btn.querySelector('.spinner'));
  assert.ok(btn.textContent.includes('发送中'));
  btnDone(btn, '发送');
  assert.equal(btn.disabled, false);
  assert.equal(btn.textContent, '发送');
  delete globalThis.document;
});

test('checkboxItemsHtml：label 结构 + checked 集合 + 值转义', () => {
  const dom = setup();
  const html = checkboxItemsHtml([{id:'math',name:'数学'},{id:'eng',name:'英语'}], ['eng']);
  assert.ok(html.includes('class="checkbox-item glass glass--solid"'));
  assert.ok(html.includes('value="math"') && !html.includes('value="math" checked'));
  assert.ok(html.includes('value="eng" checked'));
  assert.ok(html.includes('数学') && html.includes('英语'));
  delete globalThis.document;
});

test('positionFloatCard：锚定函数可调用', () => {
  const dom = setup();
  const btn = dom.window.document.createElement('button');
  const card = dom.window.document.createElement('div');
  dom.window.document.body.append(btn, card);
  positionFloatCard(btn, card);
  delete globalThis.document;
});
