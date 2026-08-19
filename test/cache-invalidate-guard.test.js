/**
 * Q-3b 缓存 invalidate 契约守护（规则 43 补充：动作后失效）：
 *   - F1：/api/posts?sort=new 域标签统一 'posts'（admin 域争用 → invalidate('posts') 不命中永久陈旧）
 *   - F3：admin 写操作成功后 invalidate 对应域（loadAdminX 走 dhGet 缓存，不失效读旧）
 *   - F4：setPrivacyField 成功后 invalidate('account')（/api/privacy-settings 域 account 且服务端不 bump）
 *   - F2 独立于 test/chat-rebind-guard.test.js（需依赖源码 import 注册存活，_dhResetForTests 会清 dhRebinders）
 *   - F5 服务端 versionDomainOf 映射在 test/version.test.js 补断言
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  dhGet, dhPeek, dhInvalidateDomain, _dhResetForTests, _dhSeedForTests,
} from '../src/client/core/datahub.js';
import { CONFIG } from '../src/shared/config.js';
import { state } from '../src/client/core/state.js';
import {
  loadAdminPosts, resolveAdminFeedback, loadAdminContracts,
  approveAward, doAwardAction, verifApprove, verifRevoke,
} from '../src/client/features/admin/actions.js';
import { setPrivacyField } from '../src/client/features/settings/actions.js';

let dom;
before(() => {
  dom = new JSDOM('<!DOCTYPE html><html><body><div id="modal-container"></div><div id="toast-container"></div></body></html>', { url: 'http://localhost/' });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return []; } };
  state.user = { id: 1, role: 'admin', username: 'admin_sufe' };
  state.authToken = 'tok-admin';
  CONFIG.DH_TTL_MS = 600000;
});
function teardown() {
  delete globalThis.document; delete globalThis.window; delete globalThis.MutationObserver; delete globalThis.fetch;
  _dhResetForTests();
}

test('Q-3b-F1：loadAdminPosts 用域 posts（/api/posts?sort=new 与 posts 域共用单槽）', async () => {
  try {
    _dhResetForTests();
    const list = document.createElement('div'); list.id = 'admin-posts-list'; document.body.appendChild(list);
    globalThis.fetch = async url => ({ ok: true, status: 200, json: async () => ({ posts: [{ id: 5, title: '帖' }] }) });
    await loadAdminPosts();
    // 缓存条目域必须是 'posts'——invalidate('posts')/dhRefreshDomain('posts') 命中
    dhInvalidateDomain('posts');
    assert.equal(dhPeek('/api/posts?sort=new'), null, '域 posts 被失效（变异：域 admin → invalidate(posts) 不命中 → 非 null → 红）');
    // 对照：admin 域失效不影响它
    const again = await dhGet('/api/posts?sort=new', { domain: 'posts' });
    assert.ok(again && again.posts, '重新拉取正常');
  } finally { teardown(); }
});

test('Q-3b-F3：resolveAdminFeedback 写后 invalidate(admin)（反馈列表缓存被清）', async () => {
  try {
    _dhResetForTests();
    _dhSeedForTests({ cache: [{ endpoint: '/api/feedbacks', domain: 'admin', data: { feedbacks: [{ id: 1 }] } }] });
    globalThis.fetch = async url => {
      const u = String(url);
      if (u.includes('/api/feedbacks')) return { ok: true, status: 200, json: async () => ({ feedbacks: [{ id: 1 }] }) };
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };
    await resolveAdminFeedback(1);
    assert.equal(dhPeek('/api/feedbacks'), null, '写后缓存被清（变异：去掉 invalidate → 缓存仍在 → 红）');
  } finally { teardown(); }
});

test('Q-3b-F4：setPrivacyField 写后 invalidate(account)（隐私设置缓存被清）', async () => {
  try {
    _dhResetForTests();
    _dhSeedForTests({ cache: [{ endpoint: '/api/privacy-settings', domain: 'account', data: { allowGuestProfile: 1 } }] });
    globalThis.fetch = async url => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
    await setPrivacyField('allowGuestProfile', 0);
    assert.equal(dhPeek('/api/privacy-settings'), null, '写后 account 域缓存被清（变异：去掉 invalidate → 永久陈旧 → 红）');
  } finally { teardown(); }
});

// Q-3b 复审（agent 2）：M-2 声称 7 处无守护——实际 5 处纯 api 直调可低成本补守护（approveAward/
// doAwardAction/verifApprove/verifRevoke + index ACTION_MAP approveReview）。补变异守护如下。
// 模式：api POST 分流 resolve（触发 invalidate），写后 reload（loadAdminX）的 dhGet 用 pending fetch
// 保持断言窗口（invalidate 已清、重填未完成）。
function pendingWriteFetch(actionUrlPart, reloadUrlPart) {
  return async url => {
    const u = String(url);
    if (u.includes(actionUrlPart)) return { ok: true, status: 200, json: async () => ({ ok: true }) };
    if (reloadUrlPart && !u.includes(reloadUrlPart)) return { ok: true, status: 200, json: async () => ({ ok: true }) };
    return new Promise(() => {}); // reload 重拉 pending：缓存保持 invalidate 后的 null 窗口
  };
}

test('Q-3b-F3b：approveAward 写后 invalidate(admin)（变异：去掉 invalidate → 红）', async () => {
  try {
    globalThis.document = dom.window.document;
    _dhResetForTests();
    _dhSeedForTests({ cache: [{ endpoint: '/api/admin/awards', domain: 'admin', data: { awards: [{ id: 1 }] } }] });
    globalThis.fetch = pendingWriteFetch('/api/admin/awards/1/action', '/api/admin/awards');
    await approveAward(1); await new Promise(r => setTimeout(r, 10)); // non-async fire-and-forget .then: tick for invalidate
    assert.equal(dhPeek('/api/admin/awards'), null, 'approve 写后 admin 域缓存清');
  } finally { teardown(); }
});

test('Q-3b-F3c：doAwardAction(reject) 写后 invalidate(admin)（变异：去掉 invalidate → 红）', async () => {
  try {
    globalThis.document = dom.window.document;
    _dhResetForTests();
    _dhSeedForTests({ cache: [{ endpoint: '/api/admin/awards', domain: 'admin', data: { awards: [{ id: 1 }] } }] });
    globalThis.fetch = pendingWriteFetch('/api/admin/awards/1/action', '/api/admin/awards');
    await doAwardAction(1, 'reject');
    assert.equal(dhPeek('/api/admin/awards'), null, 'reject 写后 admin 域缓存清');
  } finally { teardown(); }
});

test('Q-3b-F3d：verifApprove 写后 invalidate(admin)（变异：去掉 invalidate → 红）', async () => {
  try {
    globalThis.document = dom.window.document;
    _dhResetForTests();
    _dhSeedForTests({ cache: [{ endpoint: '/api/admin/verifications', domain: 'admin', data: { verifications: [{ id: 1 }] } }] });
    globalThis.fetch = pendingWriteFetch('/api/admin/verifications/1/action', '/api/admin/verifications');
    await verifApprove(1); await new Promise(r => setTimeout(r, 10));
    assert.equal(dhPeek('/api/admin/verifications'), null, '核验 approve 写后 admin 域缓存清');
  } finally { teardown(); }
});

test('Q-3b-F3e：verifRevoke 写后 invalidate(admin)（变异：去掉 invalidate → 红）', async () => {
  try {
    globalThis.document = dom.window.document;
    _dhResetForTests();
    _dhSeedForTests({ cache: [{ endpoint: '/api/admin/verifications', domain: 'admin', data: { verifications: [{ id: 1 }] } }] });
    globalThis.fetch = pendingWriteFetch('/api/admin/verifications/1/action', '/api/admin/verifications');
    await verifRevoke(1); await new Promise(r => setTimeout(r, 10));
    assert.equal(dhPeek('/api/admin/verifications'), null, '核验 revoke 写后 admin 域缓存清');
  } finally { teardown(); }
});

test('Q-3b-F3f：admin.approveReview ACTION_MAP 写后 invalidate(admin)（复审 M-2 点名：纯 api 直调可低成本守护；变异：去掉 invalidate → 红）', async () => {
  try {
    globalThis.document = dom.window.document;
    _dhResetForTests();
    _dhSeedForTests({ cache: [{ endpoint: '/api/admin/reviews', domain: 'admin', data: { reviews: [{ id: 1 }] } }] });
    const mod = await import('../src/client/features/admin/index.js');
    let cleanup = null;
    if (typeof mod.default.onLoad === 'function') cleanup = mod.default.onLoad();
    globalThis.fetch = async url => {
      const u = String(url);
      if (u.includes('/reviews/1/approve')) return { ok: true, status: 200, json: async () => ({ ok: true }) };
      return new Promise(() => {}); // loadAdminReviews 重拉 pending：保持 invalidate 后窗口
    };
    const btn = document.createElement('button');
    btn.dataset.action = 'admin.approveReview';
    btn.dataset.id = '1';
    document.body.appendChild(btn);
    btn.click();
    await new Promise(r => setTimeout(r, 10));
    assert.equal(dhPeek('/api/admin/reviews'), null, 'approve 写后 admin 域缓存清');
    if (cleanup) cleanup();
  } finally { teardown(); }
});

test('Q-3b-M1：loadAdminContracts 域标签 contracts（审计 F1 完整性缺口：与 DH_PREFETCH /api/admin/contracts=\'contracts\' 及 adminRemoveContract invalidate(\'contracts\') 对齐）', async () => {
  try {
    globalThis.document = dom.window.document; // teardown 删除 document，重设（dom 为文件级 before 实例）
    _dhResetForTests();
    const list = document.createElement('div'); list.id = 'admin-contracts-list'; document.body.appendChild(list);
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ contracts: [{ id: 7 }] }) });
    await loadAdminContracts();
    // 缓存条目域必须是 'contracts'——invalidate('contracts') 命中（变异：域 admin → invalidate 不命中 → 非 null → 红）
    dhInvalidateDomain('contracts');
    assert.equal(dhPeek('/api/admin/contracts'), null, '域 contracts 被失效');
  } finally { teardown(); }
});
