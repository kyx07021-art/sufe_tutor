/**
 * U-4: admin registry completeness — the 13 admin pages must all be registerPage'd with a
 * real enter function (no dormant empty enter), visible for the admin role. Catches the
 * v2 "module defined but never assembled" / dormant-page class (Z-14-F2 / U-3 series).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { state } from '../src/client/core/state.js';
import { pagesForRole } from '../src/client/core/router.js';
import adminFeature from '../src/client/features/admin/index.js';
import complaintsFeature from '../src/client/features/complaints/index.js';

test('U-4 admin 13 管理页 registerPage 接线 + enter 非空函数', () => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return []; } };
  state.user = { id: 1, role: 'admin', username: 'admin_sufe' };
  state.guestRole = 'student';
  const teardownAdmin = adminFeature.onLoad();
  const teardownComplaints = complaintsFeature.onLoad();
  const pages = pagesForRole();
  const ids = pages.map(p => p.id);
  const EXPECTED = [
    'admin-stats', 'admin-traffic', 'admin-students', 'admin-teachers', 'admin-demands', 'admin-reviews',
    'admin-awards', 'admin-verifications', 'admin-posts', 'admin-contracts', 'admin-feedback', 'admin-content',
    'admin-complaint', 'about',
  ];
  for (const id of EXPECTED) {
    assert.ok(ids.includes(id), `管理页注册缺失: ${id}`);
    const p = pages.find(x => x.id === id);
    assert.equal(typeof p.enter, 'function', `${id} enter 必须是函数（非休眠空 enter）`);
    assert.ok(p.auth !== undefined, `${id} auth 门禁已声明`);
  }
  teardownAdmin(); teardownComplaints();
  delete globalThis.document; delete globalThis.window; delete globalThis.MutationObserver;
});
