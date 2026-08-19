/**
 * 需求一 教师列表筛选/排序（B4：直接 import teacher actions）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { sortTeachers, teacherSortMode, applyFilters, hasDaySlot } from '../src/client/features/teacher/actions.js';
import { state } from '../src/client/core/state.js';

const TEACHERS = [
  { user_id:1, username:'甲', rating:5, price_min:200, price_max:260, teaching_method:'online', time_slots:JSON.stringify([{type:'week',dow:1,start:'18:00',end:'20:00'}]), verified:1 },
  { user_id:2, username:'乙', rating:3, price_min:100, price_max:150, teaching_method:'offline', time_slots:JSON.stringify([{type:'week',dow:3,start:'16:00',end:'18:00'}]), verified:0 },
  { user_id:3, username:'丙', rating:4, price_min:150, price_max:200, teaching_method:'both', time_slots:JSON.stringify([{type:'week',dow:1,start:'09:00',end:'12:00'},{type:'week',dow:5,start:'19:00',end:'21:00'}]), verified:1 },
  { user_id:4, username:'丁', rating:4.5, price_min:null, price_max:null, teaching_method:'', time_slots:'历史纯文本', verified:0 },
];

function setup() {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="teachers-list"></div><select id="filter-method"></select><select id="filter-day"></select><select id="filter-verified"></select></body></html>', { url: 'http://localhost/' });
  globalThis.document = dom.window.document;
  state.user = { role:'teacher', id:1, username:'t' };
  state.allTeachers = TEACHERS.map(t => ({...t}));
  const method = dom.window.document.getElementById('filter-method');
  ['online','offline','both'].forEach(v => { const o = dom.window.document.createElement('option'); o.value=v; o.textContent=v; method.appendChild(o); });
  const day = dom.window.document.getElementById('filter-day');
  const emptyDay = dom.window.document.createElement('option'); emptyDay.value=''; emptyDay.textContent=''; day.appendChild(emptyDay);
  [1,2,3,4,5,6,7].forEach(v => { const o = dom.window.document.createElement('option'); o.value=String(v); o.textContent=String(v); day.appendChild(o); });
  const ver = dom.window.document.getElementById('filter-verified');
  const emptyVer = dom.window.document.createElement('option'); emptyVer.value=''; emptyVer.textContent=''; ver.appendChild(emptyVer);
  ['0','1'].forEach(v => { const o = dom.window.document.createElement('option'); o.value=v; o.textContent=v; ver.appendChild(o); });
  return dom;
}

test('sortTeachers：rating/price/match', () => {
  const dom = setup();
  sortTeachers(state.allTeachers, 'rating');
  assert.deepEqual(state.allTeachers.map(t=>t.user_id), [1,4,3,2]);
  sortTeachers(state.allTeachers, 'price');
  assert.deepEqual(state.allTeachers.map(t=>t.user_id), [2,3,1,4]);
  const withMatch = TEACHERS.map(t => ({...t}));
  withMatch[0]._matchForStudent = { md:88 };
  withMatch[2]._matchForStudent = { md:99 };
  sortTeachers(withMatch, 'match');
  assert.deepEqual(state.allTeachers.map(t=>t.user_id), [3,1,2,4]);
  delete globalThis.document;
});

test('teacherSortMode 默认按角色', () => {
  const dom = setup();
  assert.equal(teacherSortMode(), 'rating');
  delete globalThis.document;
});

test('hasDaySlot：JSON 星期命中/纯文本不参与（Q-4a-M1a 误匹配修复）', () => {
  const dom = setup();
  assert.equal(hasDaySlot(TEACHERS[0].time_slots, 1), true);
  assert.equal(hasDaySlot(TEACHERS[0].time_slots, 3), false);
  assert.equal(hasDaySlot('历史纯文本', 1), false);
  assert.equal(hasDaySlot('', 1), false);
  // Q-4a-M1a: dow=3 但 start 时间含数字 1（18:00）——旧 String.includes 误命中 day=1（潜伏 bug）
  const t5 = { ...TEACHERS[0], time_slots: JSON.stringify([{ type: 'week', dow: 3, start: '18:00', end: '20:00' }]) };
  assert.equal(hasDaySlot(t5.time_slots, 1), false, 'dow=3 不命中 day=1（start 含 1 不误匹配）');
  assert.equal(hasDaySlot(t5.time_slots, 3), true, 'dow=3 命中 day=3');
  delete globalThis.document;
});

test('applyFilters：方法/星期/认证叠加', () => {
  const dom = setup();
  dom.window.document.getElementById('filter-method').value = 'online';
  applyFilters();
  assert.deepEqual(state.allTeachers.map(t=>t.user_id), [1]);
  delete globalThis.document;
});
