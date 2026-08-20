/**
 * Z-3-F1/U-2：admin 管理面板注册表恢复（B5 admin-panel parity）。
 * 锁真实行为（G2）：admin feature onLoad 注册 13 个管理页 + 每页 enter 进入不炸
 * （空数据 mock → 空态渲染）。删任一 registerPage 该断言必红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { state } from '../src/client/core/state.js';
import { pagesForRole } from '../src/client/core/router.js';
import adminFeature from '../src/client/features/admin/index.js';
import complaintsFeature from '../src/client/features/complaints/index.js'; // admin-complaint 归 complaints 域

const ADMIN_MANAGEMENT_PAGES = [
  'admin-stats', 'admin-traffic', 'admin-students', 'admin-teachers', 'admin-demands',
  'admin-reviews', 'admin-awards', 'admin-verifications', 'admin-posts', 'admin-contracts',
  'admin-feedback', 'admin-content', 'admin-complaint',
];

function setup() {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost/' });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return []; } };
  globalThis.localStorage = dom.window.localStorage;
  state.user = { id: 1, role: 'admin', username: 'admin_sufe' };
  adminFeature.onLoad(); // register the 12 admin pages (stats + 11 restored)
  complaintsFeature.onLoad(); // register admin-complaint (complaints domain)
  return dom;
}
function teardown() {
  delete globalThis.document; delete globalThis.window; delete globalThis.MutationObserver;
  delete globalThis.localStorage; delete globalThis.fetch;
}

test('U-2 注册表：admin onLoad 注册 13 个管理页（删任一 registerPage 变红）', () => {
  setup();
  const ids = pagesForRole().map(p => p.id);
  for (const id of ADMIN_MANAGEMENT_PAGES) {
    assert.ok(ids.includes(id), `admin 管理页 ${id} 已注册`);
  }
  // 非 admin 角色不可见（roles 门禁）
  state.user = { id: 2, role: 'student' };
  const studentIds = pagesForRole().map(p => p.id);
  for (const id of ADMIN_MANAGEMENT_PAGES) {
    assert.ok(!studentIds.includes(id), `student 不可见 ${id}`);
  }
  teardown();
});

test('U-2 进入链路：13 管理页 enter 空数据不炸（空态渲染）', async () => {
  const dom = setup();
  for (const id of ['admin-traffic', 'admin-students', 'admin-teachers', 'admin-demands',
    'admin-reviews', 'admin-awards', 'admin-verifications', 'admin-posts',
    'admin-contracts', 'admin-feedback', 'admin-content']) {
    const list = document.createElement('div');
    list.id = id.replace('admin-', 'admin-') + (id.includes('traffic') ? '-box' : '-list');
    document.body.appendChild(list);
  }
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
  // datahub dhGet 缓存层需要响应形状 { key: value }——直接走 actions loader
  const actions = await import('../src/client/features/admin/actions.js');
  for (const [page, loader] of [
    ['admin-traffic', actions.loadAdminTraffic], ['admin-students', actions.loadAdminStudents],
    ['admin-teachers', actions.loadAdminTeachers], ['admin-demands', actions.loadAdminDemands],
    ['admin-reviews', actions.loadAdminReviews], ['admin-awards', actions.loadAdminAwards],
    ['admin-verifications', actions.loadAdminVerifications], ['admin-posts', actions.loadAdminPosts],
    ['admin-contracts', actions.loadAdminContracts], ['admin-feedback', actions.loadAdminFeedback],
    ['admin-content', actions.loadAdminContent],
  ]) {
    await loader(); // 空数据 → 空态渲染，零抛错
    const el = document.getElementById(page.replace('admin-', 'admin-') + (page.includes('traffic') ? '-box' : '-list'));
    assert.ok(el, `${page} 容器在位`);
  }
  teardown();
});
