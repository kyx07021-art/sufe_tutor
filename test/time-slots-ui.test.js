/**
 * 结构化时间组件前端回归（B4：直接 import core/ui-form）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderTimeSlotContainerHtml, addTimeSlot, removeTimeSlot, collectTimeSlots, validateTimeSlots, prefillTimeSlots } from '../src/client/core/ui-form.js';

function setup() {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost/' });
  globalThis.document = dom.window.document;
  const container = dom.window.document.createElement('div');
  container.className = 'time-slots';
  dom.window.document.body.appendChild(container);
  return { dom, container };
}

test('时间组件：空容器 + 新建/删除/上移', () => {
  const { dom, container } = setup();
  container.innerHTML = renderTimeSlotContainerHtml();
  assert.equal(container.querySelectorAll('.time-slot').length, 0);
  assert.ok(container.querySelector('.time-add-btn'));
  assert.equal(container.querySelector('.time-add-label').textContent, '新建时间段');
  addTimeSlot(container.querySelector('.time-add-btn'));
  assert.equal(container.querySelectorAll('.time-slot').length, 1);
  addTimeSlot(container.querySelector('.time-add-btn'));
  assert.equal(container.querySelectorAll('.time-slot').length, 2);
  removeTimeSlot(container.querySelector('.time-slot-del'));
  assert.equal(container.querySelectorAll('.time-slot').length, 1);
  delete globalThis.document;
});

test('时间组件：收集与校验', () => {
  const { container } = setup();
  container.innerHTML = renderTimeSlotContainerHtml();
  addTimeSlot(container.querySelector('.time-add-btn'));
  const row = container.querySelector('.time-slot');
  const hhS = row.querySelector('.time-field[data-time-role="start"] .slot-time-hh');
  const mmS = row.querySelector('.time-field[data-time-role="start"] .slot-time-mm');
  const hhE = row.querySelector('.time-field[data-time-role="end"] .slot-time-hh');
  const mmE = row.querySelector('.time-field[data-time-role="end"] .slot-time-mm');
  assert.equal(validateTimeSlots(container), '');
  assert.deepEqual(JSON.parse(JSON.stringify(collectTimeSlots(container))), []);
  row.querySelector('.slot-dow').value = '1';
  assert.ok(validateTimeSlots(container));
  hhS.value='18'; mmS.value='30'; hhE.value='20'; mmE.value='0';
  assert.equal(validateTimeSlots(container), '');
  assert.deepEqual(JSON.parse(JSON.stringify(collectTimeSlots(container))), [{ type:'week', dow:1, start:'18:30', end:'20:00' }]);
  hhE.value='17';
  assert.ok(validateTimeSlots(container));
  delete globalThis.document;
});

test('时间组件：回填与上限', () => {
  const { container } = setup();
  container.innerHTML = renderTimeSlotContainerHtml();
  prefillTimeSlots(container, '工作日晚上');
  assert.equal(container.querySelectorAll('.time-slot').length, 0);
  prefillTimeSlots(container, JSON.stringify([
    { type:'week', dow:3, start:'18:00', end:'21:00' },
    { type:'week', dow:7, start:'09:00', end:'11:00' },
  ]));
  assert.equal(container.querySelectorAll('.time-slot').length, 2);
  // T-6-F3: parsed-array form (teacher profile mapper output) — array branch direct coverage (G1)
  prefillTimeSlots(container, [{ type: 'week', dow: 1, start: '10:00', end: '12:00' }]);
  assert.equal(container.querySelectorAll('.time-slot').length, 3, '数组形态追加一行');
  delete globalThis.document;
});
