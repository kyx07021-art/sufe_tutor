/**
 * Q-3b-F2 守护：chat 缓存重挂（独立文件——需依赖源码 import 时 dhOnDomainRefresh('chat', rebindChatCache)
 * 注册存活；cache-invalidate-guard.test.js 的 _dhResetForTests 会清 dhRebinders，无法在共享文件内测）
 *
 * dhRefreshDomain('chat')（版本探针检测 chat 域 bump 后 forceRefresh 替换缓存）后，chat.list 仍持旧
 * 数组引用 → 列表行的未读数/预览陈旧而徽标轮询（router 直读 dhGet）已用新缓存 → 红点有但列表无对应行。
 * rebindChatCache 把新缓存镜像回 chat.list。
 * 变异：删 actions-list.js 的 dhOnDomainRefresh('chat', rebindChatCache) 注册 → 测试红。
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { dhRefreshDomain, _dhSeedForTests } from '../src/client/core/datahub.js';
import { CONFIG } from '../src/shared/config.js';
import { state } from '../src/client/core/state.js';
import { chat } from '../src/client/features/chat/chat-state.js';
import '../src/client/features/chat/actions-list.js'; // 副作用 import：源码注册 dhOnDomainRefresh('chat', rebindChatCache)

let dom;
before(() => {
  dom = new JSDOM('<!DOCTYPE html><html><body><div id="modal-container"></div><div id="toast-container"></div></body></html>', { url: 'http://localhost/' });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return []; } };
  state.user = { id: 1, role: 'admin', username: 'admin_sufe' };
  state.authToken = 'tok-admin';
  CONFIG.DH_TTL_MS = 600000;
  // 注意：不调 _dhResetForTests（它会清 dhRebinders 含 chat 注册）——本文件依赖模块加载时的源码注册
});

test('Q-3b-F2：dhRefreshDomain(chat) 后 chat.list 镜像新缓存（源码注册的重挂生效）', async () => {
  const listEl = document.createElement('div'); listEl.id = 'my-chats-list'; document.body.appendChild(listEl);
  _dhSeedForTests({ cache: [{ endpoint: '/api/conversations', domain: 'chat', data: { conversations: [{ id: 1 }] } }] });
  chat.list = [{ id: 1 }];
  globalThis.fetch = async url => {
    const u = String(url);
    if (u === '/api/batch') {
      return { ok: true, status: 200, json: async () => ({ results: [{ path: '/api/conversations', status: 200, data: { conversations: [{ id: 1 }, { id: 2 }] } }] }) };
    }
    return { ok: true, status: 200, json: async () => ({ conversations: [{ id: 1 }, { id: 2 }] }) };
  };
  await dhRefreshDomain('chat');
  // rebindChatCache（源码 dhOnDomainRefresh('chat', rebindChatCache) 注册）把新缓存镜像回 chat.list
  // ——变异：删 actions-list.js 的注册行 → dhRebinders 无 chat → chat.list 仍旧引用 [{id:1}] → 红
  assert.equal(chat.list.length, 2, 'dhRefreshDomain(chat) 后 chat.list 更新为 2 条（徽标与列表不分叉）');
  assert.ok(chat.list.some(c => c.id === 2), '新数据进入列表');
});
