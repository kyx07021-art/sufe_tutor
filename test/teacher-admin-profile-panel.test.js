/**
 * ZR-A2（2026-08-27）：admin 教师详情卡接线。
 * 用户原话：「管理员页面的教师详情卡完全断线，什么详情都加载不出来」。
 *
 * 根因：openProfilePanel 仅 `role===STUDENT` 拉完整 /api/teacher/profile；
 * admin 走列表数据（admin 域不维护 teachers 列表缓存 → t undefined）或 /api/users/:id 极简
 * fallback（{id,username,role,avatar}）→ 详情卡空白。ZR-A1 服务端已放行 admin 全字段，
 * 本基元 = 前端 openProfilePanel 的 STUDENT 分支扩为 STUDENT||ADMIN（拉全档案渲染）。
 *
 * G2 变异：还原 admin 分支（改回仅 role===STUDENT）→ 本文件 admin 用例「应拉
 * /api/teacher/profile」断言必红（admin 走极简 fallback，无 profile-name 王老师）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import * as actions from '../src/client/features/teacher/actions.js';
import { state } from '../src/client/core/state.js';
import { setEnsureAuth } from '../src/client/core/api.js';

const dom = new JSDOM('<!doctype html><html><body><div id="modal-container"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
globalThis.document = dom.window.document;
globalThis.window = dom.window;
globalThis.localStorage = dom.window.localStorage;
globalThis.sessionStorage = dom.window.sessionStorage;
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
setEnsureAuth(() => true);

const BASE_PROFILE = {
  user_id: 7, username: 'wang', real_name: '王老师', grade: 'senior1', school: '上财',
  price_min: 100, price_max: 200, time_slots: [], gender: 'male', avatar: '',
  rating: 4.5, rating_count: 1,
};

function mockFetch() {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, opts });
    if (u.startsWith('/api/teacher/profile')) {
      return { ok: true, status: 200, json: async () => ({ profile: { ...BASE_PROFILE } }) };
    }
    if (u.startsWith('/api/reviews')) {
      return { ok: true, status: 200, json: async () => ({ reviews: [] }) };
    }
    if (u.startsWith('/api/teacher/awards')) {
      return { ok: true, status: 200, json: async () => ({ awards: [] }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
  return calls;
}

test('ZR-A2: admin openProfilePanel fetches full profile from /api/teacher/profile (detail card was empty)', async () => {
  const calls = mockFetch();
  state.allTeachers = []; // admin 域不维护 teachers 列表缓存 → 修复前 t=undefined 走极简 fallback
  state.user = { id: 1, role: 'admin' };
  await actions.openProfilePanel(7);
  const profCall = calls.find(c => c.url.startsWith('/api/teacher/profile'));
  assert.ok(profCall, 'admin 应拉 /api/teacher/profile 全档案（修复前走 /api/users/:id 极简 fallback 不触发本调用）');
  const name = document.querySelector('#modal-container .profile-name');
  assert.ok(name && name.textContent.includes('王老师'), `详情卡应显示平台内名称（实测 ${name && name.textContent}）`);
  assert.ok(document.querySelector('#modal-container .profile-panel'), '详情卡已渲染');
  // 管理员侧不因 matched 误显示「写评价」入口（mapper 默认 matched:false）
  assert.ok(!document.querySelector('#modal-container [data-action="teacher.openReview"]'), 'admin 详情卡零写评价入口');
});

test('ZR-A2: student path still fetches /api/teacher/profile (no regression)', async () => {
  const calls = mockFetch();
  state.allTeachers = [{ ...BASE_PROFILE }];
  state.user = { id: 99, role: 'student' };
  await actions.openProfilePanel(7);
  const profCall = calls.find(c => c.url.startsWith('/api/teacher/profile'));
  assert.ok(profCall, '学生路径仍拉 /api/teacher/profile');
});

test('ZR-A2: guest (no session) falls back to list data, never crashes', async () => {
  const calls = mockFetch();
  state.allTeachers = [{ ...BASE_PROFILE }];
  state.user = null;
  await actions.openProfilePanel(7);
  assert.ok(!calls.find(c => c.url.startsWith('/api/teacher/profile')), '访客不拉完整档案');
  const name = document.querySelector('#modal-container .profile-name');
  assert.ok(name && name.textContent.includes('王老师'), '访客用列表数据渲染详情卡');
});
