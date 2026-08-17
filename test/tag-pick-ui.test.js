/**
 * tag-pick 多选 pill 前端回归（B4：直接 import core/ui）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { toggleTagPick } from '../src/client/core/ui.js';

function setup() {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="toast-container"></div></body></html>', { url: 'http://localhost/' });
  globalThis.document = dom.window.document;
  globalThis.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return []; } };
  return dom;
}
function mount(doc, ids, containerId) {
  const container = doc.createElement('div');
  container.id = containerId;
  doc.body.appendChild(container);
  ids.forEach(id => {
    const btn = doc.createElement('button');
    btn.className = 'tag-pick';
    btn.dataset.id = id;
    btn.textContent = id;
    container.appendChild(btn);
  });
  return container;
}

test('tag-pick：上限内可选、超限拒绝、取消后释放名额', () => {
  const dom = setup();
  const container = mount(dom.window.document, ['a','b','c','d'], 'tags');
  const buttons = [...container.querySelectorAll('.tag-pick')];
  buttons.slice(0,3).forEach(b => toggleTagPick(b, 'tags', 3));
  assert.equal(container.querySelectorAll('.tag-pick.selected').length, 3);
  toggleTagPick(buttons[3], 'tags', 3);
  assert.equal(container.querySelectorAll('.tag-pick.selected').length, 3);
  assert.ok(!buttons[3].classList.contains('selected'));
  assert.ok(dom.window.document.querySelector('#toast-container .toast'), '超限有 toast');
  toggleTagPick(buttons[0], 'tags', 3);
  toggleTagPick(buttons[3], 'tags', 3);
  assert.equal(container.querySelectorAll('.tag-pick.selected').length, 3);
  assert.ok(buttons[3].classList.contains('selected'));
  delete globalThis.document;
});

test('tag-pick：max<=0 不设上限', () => {
  const dom = setup();
  const container = mount(dom.window.document, ['a','b','c','d','e'], 'projects');
  container.querySelectorAll('.tag-pick').forEach(b => toggleTagPick(b, 'projects', 0));
  assert.equal(container.querySelectorAll('.tag-pick.selected').length, 5);
  delete globalThis.document;
});
