/**
 * Z-13-F1：admin 客户端行为测试——loadAdminUsers/loadAdminContent/loadAdminFeedback
 * 拉取 + 渲染链路、renderAdminReviewRow/renderAdminContentRow 结构（data-action 委托按钮）、
 * openContentPenaltyModal 弹窗内容。既有 client-feature-settings-admin-onboard.test.js 只做
 * 存在性冒烟，本测试锁真实行为。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { loadAdminUsers, loadAdminContent, loadAdminFeedback, renderAdminReviewRow, renderAdminContentRow, openContentPenaltyModal } from '../src/client/features/admin/actions.js';
import { state } from '../src/client/core/state.js';

function setup() {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="modal-container"></div><div id="toast-container"></div></body></html>', { url: 'http://localhost/' });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return []; } };
  state.user = { id: 1, role: 'admin', username: 'admin_sufe' };
  state.authToken = 'tok-admin';
  return dom;
}
function teardown() {
  delete globalThis.document; delete globalThis.window; delete globalThis.MutationObserver;
  delete globalThis.fetch;
}

test('loadAdminUsers：拉取后渲染用户名行到列表容器', async () => {
  const dom = setup();
  const list = document.createElement('div');
  list.id = 'admin-users-list';
  document.body.appendChild(list);
  globalThis.fetch = async (url) => {
    assert.ok(String(url).includes('/api/admin/users?role=student'), '带 role 参数');
    return { ok: true, status: 200, json: async () => ({ users: [{ id: 11, username: '学生甲', role: 'student' }, { id: 12, username: '学生乙', role: 'student' }] }) };
  };
  await loadAdminUsers('student');
  assert.ok(list.innerHTML.includes('学生甲') && list.innerHTML.includes('学生乙'), '两行用户名渲染');
  teardown();
});

test('loadAdminContent：按 type 拉取并渲染内容行', async () => {
  const dom = setup();
  const list = document.createElement('div');
  list.id = 'admin-content-list';
  document.body.appendChild(list);
  globalThis.fetch = async (url) => {
    assert.ok(String(url).includes('/api/admin/content?type=post'), 'type 下推');
    return { ok: true, status: 200, json: async () => ({ items: [{ id: 7, title: '某帖子', type: 'post' }] }) };
  };
  await loadAdminContent('post');
  assert.ok(list.innerHTML.includes('某帖子'), '内容行渲染');
  assert.ok(list.querySelector('[data-action="admin.penalty"]'), '处罚按钮 data-action 委托');
  teardown();
});

test('loadAdminFeedback：渲染反馈标题列表', async () => {
  const dom = setup();
  const list = document.createElement('div');
  list.id = 'admin-feedback-list';
  document.body.appendChild(list);
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ feedbacks: [{ id: 3, title: '登录问题反馈' }] }) });
  await loadAdminFeedback();
  assert.ok(list.innerHTML.includes('登录问题反馈'), '反馈标题渲染');
  teardown();
});

test('renderAdminReviewRow：评论 + approve/reject 委托按钮', () => {
  const html = renderAdminReviewRow({ id: 9, comment: '评价内容' });
  assert.ok(html.includes('评价内容'), '评论文本');
  assert.ok(html.includes('data-action="admin.approveReview" data-id="9"'), '通过按钮委托');
  assert.ok(html.includes('data-action="admin.rejectReview" data-id="9"'), '拒绝按钮委托');
  assert.ok(!/onclick=/.test(html), '零内联事件');
});

test('renderAdminContentRow：标题 + 处罚按钮 data-action/data-id/data-type', () => {
  const html = renderAdminContentRow({ id: 5, title: '违规帖子', type: 'post' });
  assert.ok(html.includes('违规帖子'), '标题');
  assert.ok(html.includes('data-action="admin.penalty" data-id="5" data-type="post"'), '处罚按钮完整委托');
});

test('openContentPenaltyModal：危险操作弹窗含理由输入 + 确认按钮', () => {
  const dom = setup();
  openContentPenaltyModal(21, 'post');
  const modal = dom.window.document.querySelector('.modal');
  assert.ok(modal, '弹窗出现');
  assert.ok(modal.querySelector('#penalty-reason'), '理由 textarea');
  assert.ok(modal.querySelector('[data-action="admin.submitPenalty"][data-id="21"][data-type="post"]'), '确认按钮带 id/type');
  teardown();
});
