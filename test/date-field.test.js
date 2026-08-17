/**
 * 需求四十五 首次上课日期分段输入（B4：直接 import core/ui-form）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { dateFieldHtml, readDateField, clampYear, clampDateDay } from '../src/client/core/ui-form.js';

function setup() {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost/' });
  globalThis.document = dom.window.document;
  return dom;
}
function build(y, m, d) {
  const dom = setup();
  const el = dom.window.document.createElement('div');
  el.innerHTML = dateFieldHtml();
  const f = el.querySelector('#contract-first-lesson-field');
  if (y != null) f.querySelector('.seg-year').value = String(y);
  if (m != null) f.querySelector('.seg-month').value = String(m);
  if (d != null) f.querySelector('.seg-day').value = String(d);
  return { dom, f };
}

test('M5 dateFieldHtml：三独立输入框 + 单位后缀', () => {
  const dom = setup();
  const html = dateFieldHtml();
  assert.ok(html.includes('id="contract-first-lesson-field"'));
  assert.equal((html.match(/class="seg-part"/g) || []).length, 3);
  assert.ok(html.includes('seg-year') && html.includes('seg-month') && html.includes('seg-day'));
  assert.ok(html.includes('aria-label="年"') && html.includes('aria-label="月"') && html.includes('aria-label="日"'));
  assert.ok(html.includes('data-maxlen="4"') && html.includes('data-maxlen="2"'));
  delete globalThis.document;
});

test('readDateField：空→""、半填→null、年份不足四位→null、完整→YYYY-MM-DD', () => {
  const empty = build();
  assert.equal(readDateField(empty.f), '');
  const half = build('2026', null, null);
  assert.equal(readDateField(half.f), null);
  const short = build('25', '8', '15');
  assert.equal(readDateField(short.f), null);
  const full = build('2026', '8', '15');
  assert.equal(readDateField(full.f), '2026-08-15');
  delete globalThis.document;
});

test('真实日历校验', () => {
  assert.equal(readDateField(build('2026','2','31').f), '2026-02-28');
  assert.equal(readDateField(build('2028','2','29').f), '2028-02-29');
  assert.equal(readDateField(build('2028','2','30').f), '2028-02-29');
  assert.equal(readDateField(build('2026','4','31').f), '2026-04-30');
  assert.equal(readDateField(build('2026','13','15').f), '2026-12-15');
  delete globalThis.document;
});

test('clampSegment/clampYear/clampDateDay blur 钳制', () => {
  const dom = setup();
  dom.window.document.body.innerHTML = dateFieldHtml();
  const year = dom.window.document.querySelector('.seg-year');
  year.value = '25'; clampYear(year); assert.equal(year.value, '25');
  year.value = '12000'; clampYear(year); assert.equal(year.value, '9999');
  const day = dom.window.document.querySelector('.seg-day');
  day.value = '45'; clampDateDay(day); assert.equal(day.value, '31');
  delete globalThis.document;
});
