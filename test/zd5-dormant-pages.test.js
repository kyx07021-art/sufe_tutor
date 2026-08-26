/**
 * ZD-5（2026-08-26 休眠签约）守卫测试：my-contracts / admin-contracts 页注册停用。
 * 用户原话：「把签约和合同相关逻辑、模块…全休眠掉」——前端 contract 模块休眠后，
 * 两页不得出现在任何角色的 pagesForRole 注册表（侧边栏无入口、直访回退默认页）。
 *
 * G2 变异守护：取消注释 contract/index.js 或 admin/index.js 中休眠的 registerPage
 * → 本文件对应断言必红；还原 → 绿。两页各独立承重。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { state } from '../src/client/core/state.js';
import { pagesForRole } from '../src/client/core/router.js';
import contractFeature from '../src/client/features/contract/index.js';
import adminFeature from '../src/client/features/admin/index.js';

function setup(role) {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost/' });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return []; } };
  globalThis.localStorage = dom.window.localStorage;
  state.user = { id: 1, role, username: 'u' };
  state.guestRole = 'student';
  contractFeature.onLoad();
  adminFeature.onLoad();
  return () => {
    delete globalThis.document; delete globalThis.window;
    delete globalThis.MutationObserver; delete globalThis.localStorage;
  };
}

test('ZD-5 我的合同页休眠：student/teacher 注册表零 my-contracts', () => {
  for (const role of ['student', 'teacher']) {
    const teardown = setup(role);
    const ids = pagesForRole().map(p => p.id);
    assert.ok(!ids.includes('my-contracts'), `${role} 注册表不得含 my-contracts（休眠停用，实测含）`);
    teardown();
  }
});

test('ZD-5 合同管理页休眠：admin 注册表零 admin-contracts', () => {
  const teardown = setup('admin');
  const ids = pagesForRole().map(p => p.id);
  assert.ok(!ids.includes('admin-contracts'), 'admin 注册表不得含 admin-contracts（休眠停用，实测含）');
  teardown();
});
