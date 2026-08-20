/**
 * Z-10-F1 回归：教师资料面板写评价入口（signed 门控 + 点击→提交链路）
 *
 * 初审 FAIL 根因（1101 级）：ACTION_MAP 的 'teacher.openReview' 调 openReviewModal() 不传参，
 * 而 openReviewModal 无条件 `profilePanelUserId = teacherId`（undefined）→ 覆写 openProfilePanel
 * 刚设好的模块态 → submitReview 提交 teacherUserId=undefined → 服务端 dbIsContracted 无行 → 恒 403。
 * 修复 = openReviewModal 仅在参数非空时覆写（按钮无 data-id，读模块态）。
 *
 * 覆盖：
 *   - renderProfilePanel：signed:true 渲染写评价按钮 / signed 缺省不渲染（门控）；
 *   - 链路：openProfilePanel 查 /api/teacher/profile 数据源 → openReviewModal() 不清模块态 →
 *     submitReview POST body 含正确 teacherUserId（修复前为 undefined）；
 *   - openReviewModal(显式 id) 覆写仍生效（既有 v1 入口语义保留）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderProfilePanel } from '../src/client/features/teacher/render.js';
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
  user_id: 1, username: 'wang', real_name: '王老师', grade: 'senior1', school: '上财',
  price_min: 100, price_max: 200, time_slots: [], gender: 'male',
};

test('Z-10-F1: renderProfilePanel gates write-review button on server signed flag', () => {
  const signedHtml = renderProfilePanel({ ...BASE_PROFILE, signed: true }, '');
  assert.ok(signedHtml.includes('data-action="teacher.openReview"'), 'signed:true 渲染写评价按钮');
  assert.ok(!/onclick=/.test(signedHtml), '无内联事件');
  const unsignedHtml = renderProfilePanel({ ...BASE_PROFILE }, ''); // 列表数据无 signed
  assert.ok(!unsignedHtml.includes('teacher.openReview'), '无 signed 不渲染按钮');
});

test('Z-10-F1: openProfilePanel reads signed from /api/teacher/profile then openReviewModal() keeps module state and submitReview posts correct teacherUserId', async () => {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, opts });
    if (u.startsWith('/api/teacher/profile')) {
      return { ok: true, status: 200, json: async () => ({ profile: { ...BASE_PROFILE, signed: true } }) };
    }
    if (u.startsWith('/api/reviews')) {
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
  state.allTeachers = [{ ...BASE_PROFILE }];
  state.user = { id: 99, role: 'student' };
  await actions.openProfilePanel(1);
  const profCall = calls.find(c => c.url.startsWith('/api/teacher/profile'));
  assert.ok(profCall, '资料面板改查 /api/teacher/profile 数据源');
  actions.openReviewModal(); // 按钮点击：不传参
  // 模拟用户评分 + 填写
  const star = document.querySelector('#review-stars .star[data-rating="5"]');
  assert.ok(star, '评星组件已渲染');
  star.classList.add('selected');
  document.getElementById('review-comment').value = '教得很好';
  await actions.submitReview();
  const reviewCall = calls.find(c => c.url.startsWith('/api/reviews') && c.opts.method === 'POST');
  assert.ok(reviewCall, '提交评价请求发出');
  const posted = JSON.parse(reviewCall.opts.body);
  assert.equal(posted.teacherUserId, 1, 'submitReview 提交正确 teacherUserId（修复前恒 undefined → 403）');
  assert.equal(posted.rating, 5);
  assert.equal(posted.comment, '教得很好');
  state.allTeachers = [];
  state.user = null;
});

test('Z-10-F1: openReviewModal(explicitId) still overrides module state (legacy entry)', async () => {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, opts });
    if (u.startsWith('/api/teacher/profile')) return { ok: true, status: 200, json: async () => ({ profile: { ...BASE_PROFILE, user_id: 7, signed: true } }) };
    if (u.startsWith('/api/reviews')) return { ok: true, status: 200, json: async () => ({ ok: true }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  state.allTeachers = [{ ...BASE_PROFILE, user_id: 7 }];
  state.user = { id: 99, role: 'student' };
  await actions.openProfilePanel(7);
  actions.openReviewModal(7); // 显式 id：覆写生效（锁覆写语义——守卫整体删除则本用例红）
  const star = document.querySelector('#review-stars .star[data-rating="4"]');
  assert.ok(star, '评星组件渲染');
  star.classList.add('selected');
  document.getElementById('review-comment').value = '显式入口评价';
  await actions.submitReview();
  const reviewCall = calls.find(c => c.url.startsWith('/api/reviews') && c.opts.method === 'POST');
  assert.ok(reviewCall, '提交评价请求发出');
  assert.equal(JSON.parse(reviewCall.opts.body).teacherUserId, 7, '显式 id 覆写后提交正确 teacherUserId');
  state.allTeachers = [];
  state.user = null;
});

// Z-10-F1 复审 FAIL 修正：游客点教师卡不得被弹登录——profile 数据源仅学生发起（401 会触发 api()
// 死令牌处理 → ensureAuth → 登录视图，复审实证的回归）；游客/非学生走列表数据（signed 恒缺 → 无按钮）
test('Z-10-F1: guest (no token) opens profile panel from list data without auth bounce', async () => {
  const calls = [];
  let ensureAuthCalls = 0;
  setEnsureAuth(() => { ensureAuthCalls++; return true; });
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, opts });
    return { ok: true, status: 200, json: async () => ({ user: { ...BASE_PROFILE, user_id: 1 } }) };
  };
  state.allTeachers = [{ ...BASE_PROFILE }]; // 游客列表数据
  state.user = null; // 游客
  await actions.openProfilePanel(1);
  assert.equal(ensureAuthCalls, 0, '游客不发 profile 请求 → 零 ensureAuth（不弹登录视图）');
  assert.ok(!calls.some(c => c.url.startsWith('/api/teacher/profile')), '游客不查 /api/teacher/profile');
  const modal = document.querySelector('#modal-container .profile-panel');
  assert.ok(modal, '资料面板正常打开');
  assert.ok(!modal.innerHTML.includes('teacher.openReview'), '游客无写评价按钮');
  state.allTeachers = [];
});
