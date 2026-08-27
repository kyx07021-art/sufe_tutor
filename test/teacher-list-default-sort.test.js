/**
 * ZF-2（2026-08-26）：教师列表首屏默认排序 + 排序控件默认同步 + match 无上下文 fallback。
 * 覆盖：loadTeachers 首屏应用默认排序（学生→match / 教师→rating）+ #teacher-sort 默认值同步；
 * 学生有需求 → 首屏按匹配度降序；学生无需求 → 保持服务端序（发配到默认排序）且照常渲染；
 * sortTeachers() 无参 match 无匹配数据不再 early return（write-back + 渲染恒执行）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { loadTeachers, sortTeachers } from '../src/client/features/teacher/actions.js';
import { state } from '../src/client/core/state.js';
import { dhInvalidateAll } from '../src/client/core/datahub.js';

const TEACHERS = [
  { user_id:1, username:'甲', rating:5, price_min:200, price_max:260, teaching_method:'online', time_slots:[{type:'week',dow:1,start:'18:00',end:'20:00'}], subjects:['math'], personality_tags:[], province:'shanghai', address:'' },
  { user_id:2, username:'乙', rating:3, price_min:100, price_max:150, teaching_method:'offline', time_slots:[{type:'week',dow:3,start:'16:00',end:'18:00'}], subjects:['physics'], personality_tags:[], province:'shanghai', address:'' },
  { user_id:3, username:'丙', rating:4, price_min:150, price_max:200, teaching_method:'both', time_slots:[{type:'week',dow:1,start:'09:00',end:'12:00'}], subjects:['math'], personality_tags:[], province:'shanghai', address:'' },
];

function setupDom() {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="browse-teachers-list"></div><select id="teacher-sort"></select><select id="filter-method"></select><select id="filter-day"></select></body></html>', { url: 'http://localhost/' });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.sessionStorage = dom.window.sessionStorage;
  globalThis.MutationObserver = class { observe() {} };
  dhInvalidateAll(); // 隔离跨测试的 datahub 缓存（G4）
  return dom;
}

function mockFetch({ demands } = {}) {
  globalThis.fetch = async (url) => {
    const u = String(url);
    // G4：返回深拷贝，防 attachStudentMatch 对共享 fixture 的 _matchForStudent 污染跨测试残留
    if (u.includes('/api/teachers')) return { ok:true, status:200, json: async () => ({ teachers: TEACHERS.map(t => ({ ...t })) }) };
    if (u.includes('/api/student/demands')) return { ok:true, status:200, json: async () => ({ demands: demands || [] }) };
    return { ok:true, status:200, json: async () => ({ ok:true }) };
  };
}

function cleanup() {
  delete globalThis.document; delete globalThis.window;
  delete globalThis.localStorage; delete globalThis.sessionStorage; delete globalThis.MutationObserver; delete globalThis.fetch;
}

test('ZF-2 学生无需求：默认 match + 首屏渲染 + 服务端序保持（发配到默认排序）', async () => {
  const dom = setupDom(); mockFetch({ demands: [] });
  state.user = { role: 'student', id: 1, username: 's' };
  await loadTeachers();
  assert.equal(state.teacherSort, 'match', '学生默认排序 match');
  assert.equal(dom.window.document.getElementById('teacher-sort').value, 'match', 'sort select 默认 match');
  assert.deepEqual(state.allTeachers.map(t => t.user_id), [1, 2, 3], '无匹配上下文保持服务端序（原序）');
  assert.ok(dom.window.document.getElementById('browse-teachers-list').innerHTML.includes('甲'), '首屏已渲染');
  cleanup();
});

test('ZF-2 教师角色：默认 rating + 首屏按评分降序渲染', async () => {
  const dom = setupDom(); mockFetch({});
  state.user = { role: 'teacher', id: 2, username: 't' };
  await loadTeachers();
  assert.equal(state.teacherSort, 'rating', '教师角色默认排序 rating');
  assert.equal(dom.window.document.getElementById('teacher-sort').value, 'rating', 'sort select 默认 rating');
  assert.deepEqual(state.allTeachers.map(t => t.user_id), [1, 3, 2], '首屏按 rating 降序');
  cleanup();
});

test('ZF-2 学生有需求：默认 match + 首屏按匹配度降序渲染', async () => {
  const dom = setupDom();
  mockFetch({ demands: [{ id: 1, status: 'open', target_type: 'academic', target_subjects: ['math'], teaching_method: 'online', preferred_personality_tags: [], province: 'shanghai', address: '' }] });
  state.user = { role: 'student', id: 1, username: 's' };
  await loadTeachers();
  assert.equal(state.teacherSort, 'match');
  assert.equal(dom.window.document.getElementById('teacher-sort').value, 'match');
  const ids = state.allTeachers.map(t => t.user_id);
  assert.ok([1, 3].includes(ids[0]), 'math 教师匹配在前: ' + ids.join(','));
  assert.equal(ids[2], 2, '不匹配教师（physics）排最后');
  cleanup();
});

test('ZF-2 sortTeachers() 无参：match 无匹配数据照常 write-back + 渲染（不再 early return）', async () => {
  const dom = setupDom();
  state.user = { role: 'student', id: 1, username: 's' };
  state.allTeachers = TEACHERS.map(t => ({ ...t }));
  state.teacherSort = 'match';
  sortTeachers();
  assert.deepEqual(state.allTeachers.map(t => t.user_id), [1, 2, 3], '无匹配保持原序');
  assert.ok(dom.window.document.getElementById('browse-teachers-list').innerHTML.includes('甲'), 'match 无匹配时仍渲染');
  cleanup();
});
