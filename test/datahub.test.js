/**
 * 会话数据层（core/datahub.js）回归（直接 import ESM）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dhGet, dhPeek, dhInvalidateDomain, dhInvalidateAll, dhPrefetch, dhBatchGet,
  dhCheckAppVersion, DH_PREFETCH, _dhResetForTests,
} from '../src/client/core/datahub.js';
import { CONFIG, APP_VERSION } from '../src/shared/config.js';

function setup() {
  _dhResetForTests();
  CONFIG.DH_TTL_MS = 600000;
}

function makeFetch() {
  const calls = [];
  const batchGets = [];
  const routes = new Map();
  const impl = async (url, opts) => {
    const u = String(url);
    calls.push(u);
    if (u === '/api/batch') {
      let gets = [];
      try { gets = JSON.parse((opts && opts.body) || '{}').gets || []; } catch { gets = []; }
      batchGets.push(gets);
      const results = gets.map(p => {
        const r = routes.get(p);
        if (r instanceof Error) return { path: p, status: 500, data: { error: 'boom' } };
        const body = typeof r === 'function' ? r() : (r !== undefined ? r : {});
        return { path: p, status: 200, data: body };
      });
      return { ok: true, status: 200, json: async () => ({ results }) };
    }
    const r = routes.get(u);
    if (r instanceof Error) throw r;
    const body = typeof r === 'function' ? await r() : (r !== undefined ? r : {});
    return { ok: true, status: 200, json: async () => body };
  };
  return { impl, calls, routes, batchGets };
}

test('dhGet：缓存命中即返，miss 才发请求', async () => {
  setup();
  const { impl, calls, routes } = makeFetch();
  routes.set('/api/teachers', { teachers: [{ id: 1 }] });
  globalThis.fetch = impl;
  const a = await dhGet('/api/teachers', { domain: 'teachers' });
  const b = await dhGet('/api/teachers', { domain: 'teachers' });
  assert.deepEqual(b, a);
  assert.equal(calls.length, 1, '第二次命中缓存，零请求');
});

test('dhGet：并发同 key 共享一个在途请求（预取与 tab 首载撞车不双发）', async () => {
  setup();
  let resolveFn;
  const calls = [];
  globalThis.fetch = (url) => { calls.push(String(url)); return new Promise(r => { resolveFn = r; }); };
  const p1 = dhGet('/api/teachers', { domain: 'teachers' });
  const p2 = dhGet('/api/teachers', { domain: 'teachers' });
  assert.equal(calls.length, 1, '并发应共享一个请求');
  resolveFn({ ok: true, status: 200, json: async () => ({ teachers: [{ id: 9 }] }) });
  const [a, b] = await Promise.all([p1, p2]);
  assert.deepEqual(a, b);
  await dhGet('/api/teachers', { domain: 'teachers' });
  assert.equal(calls.length, 1);
});

test('dhPeek：保底 TTL 过期后视为未命中', async () => {
  setup();
  const { impl, calls, routes } = makeFetch();
  routes.set('/api/teachers', { teachers: [] });
  globalThis.fetch = impl;
  CONFIG.DH_TTL_MS = -1;
  await dhGet('/api/teachers', { domain: 'teachers' });
  assert.equal(dhPeek('/api/teachers'), null, '过期应返回 null');
  CONFIG.DH_TTL_MS = 600000;
  await dhGet('/api/teachers', { domain: 'teachers' });
  assert.notEqual(dhPeek('/api/teachers'), null);
  assert.equal(calls.length, 2);
});

test('dhInvalidateDomain：只清指定域；dhInvalidateAll 全清', async () => {
  setup();
  const { impl, routes } = makeFetch();
  routes.set('/api/teachers', { teachers: [] });
  routes.set('/api/student/demands?scope=mine', { demands: [] });
  globalThis.fetch = impl;
  await dhGet('/api/teachers', { domain: 'teachers' });
  await dhGet('/api/student/demands?scope=mine', { domain: 'demands' });
  dhInvalidateDomain('demands');
  assert.equal(dhPeek('/api/student/demands?scope=mine'), null);
  assert.notEqual(dhPeek('/api/teachers'), null);
  dhInvalidateAll();
  assert.equal(dhPeek('/api/teachers'), null);
});

test('dhPrefetch：批量一次往返、单键失败静默，不阻断其余键（B2/F3）', async () => {
  setup();
  const { impl, calls, routes, batchGets } = makeFetch();
  routes.set('/api/teachers', new Error('boom'));
  routes.set('/api/contracts/my', { contracts: [] });
  globalThis.fetch = impl;
  const r = await dhPrefetch('student');
  assert.equal(Object.prototype.toString.call(r), '[object Map]');
  assert.equal(calls.filter(u => u === '/api/batch').length, 1);
  assert.equal(calls.filter(u => u === '/api/contracts/my').length, 0);
  assert.notEqual(dhPeek('/api/contracts/my'), null);
  assert.equal(dhPeek('/api/teachers'), null);
  const lastGets = batchGets[batchGets.length - 1];
  assert.ok(lastGets.includes('/api/contracts/my'));
  assert.ok(lastGets.includes('/api/user/creds'));
});

test('dhBatchGet：缓存命中键跳过、在途键共享、缺键一次批量（F3）', async () => {
  setup();
  const { impl, calls, routes, batchGets } = makeFetch();
  routes.set('/api/teachers', { teachers: [{ id: 1 }] });
  routes.set('/api/notifications', { notifications: [] });
  globalThis.fetch = impl;
  await dhGet('/api/teachers', { domain: 'teachers' });
  const r = await dhBatchGet([{ path: '/api/teachers', domain: 'teachers' }, { path: '/api/notifications', domain: 'notifications' }]);
  assert.ok(r.has('/api/teachers'));
  assert.ok(r.has('/api/notifications'));
  assert.equal(calls.filter(u => u === '/api/batch').length, 1);
  assert.deepEqual(batchGets[0], ['/api/notifications']);
});

test('dhGet forceRefresh：绕过缓存重拉', async () => {
  setup();
  let n = 0;
  const { impl, calls, routes } = makeFetch();
  routes.set('/api/teachers', () => ({ teachers: [{ n: ++n }] }));
  globalThis.fetch = impl;
  const a = await dhGet('/api/teachers', { domain: 'teachers' });
  assert.equal(a.teachers[0].n, 1);
  await dhGet('/api/teachers', { domain: 'teachers' });
  assert.equal(calls.length, 1);
  const b = await dhGet('/api/teachers', { domain: 'teachers', forceRefresh: true });
  assert.equal(b.teachers[0].n, 2);
  assert.equal(calls.length, 2);
});

test('dhGet 会话代次：登出后（dhInvalidateAll）在途请求回落后不写入缓存（审计 m1）', async () => {
  setup();
  let resolveFn;
  const calls = [];
  globalThis.fetch = (url) => { calls.push(String(url)); return new Promise(r => { resolveFn = r; }); };
  const p = dhGet('/api/teachers', { domain: 'teachers' });
  dhInvalidateAll();
  resolveFn({ ok: true, status: 200, json: async () => ({ teachers: [{ id: 1 }] }) });
  await p;
  assert.equal(dhPeek('/api/teachers'), null);
});

test('dhCheckAppVersion：版本变化 → 强清缓存并覆写版本号；同版本 → 不动（v0.25.12 发版强清）', async () => {
  setup();
  const store = new Map();
  globalThis.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  };
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ teachers: [] }) });
  dhCheckAppVersion();
  await dhGet('/api/teachers', { domain: 'teachers' });
  assert.notEqual(dhPeek('/api/teachers'), null);
  globalThis.localStorage.setItem('sufe_app_version', '0.0.0');
  dhCheckAppVersion();
  assert.equal(dhPeek('/api/teachers'), null);
  assert.equal(globalThis.localStorage.getItem('sufe_app_version'), String(APP_VERSION));
  await dhGet('/api/teachers', { domain: 'teachers' });
  dhCheckAppVersion();
  assert.notEqual(dhPeek('/api/teachers'), null);
  delete globalThis.localStorage;
});

test('T6 发版重预取：版本变化清缓存后进客户端 dhPrefetch 立即一次批量重灌（F7/F3）', async () => {
  setup();
  const store = new Map();
  const { impl, calls, routes, batchGets } = makeFetch();
  routes.set('/api/teachers', { teachers: [{ id: 1 }] });
  routes.set('/api/contracts/my', { contracts: [] });
  globalThis.fetch = impl;
  globalThis.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  };
  await dhGet('/api/teachers', { domain: 'teachers' });
  assert.notEqual(dhPeek('/api/teachers'), null);
  calls.length = 0; batchGets.length = 0;
  globalThis.localStorage.setItem('sufe_app_version', '0.0.0');
  dhCheckAppVersion();
  assert.equal(dhPeek('/api/teachers'), null);
  const r = await dhPrefetch('student');
  assert.equal(calls.filter(u => u === '/api/batch').length, 1);
  assert.notEqual(dhPeek('/api/teachers'), null);
  assert.notEqual(dhPeek('/api/contracts/my'), null);
  assert.equal(calls.filter(u => u === '/api/teachers').length, 0);
  assert.equal(Object.prototype.toString.call(r), '[object Map]');
  delete globalThis.localStorage;
});

test('B6 DH_PREFETCH：设置页四表单并入预取（account 域，登录即后台拉取）', () => {
  setup();
  const eps = ['/api/auth/sessions', '/api/privacy-settings', '/api/user/username/status', '/api/user/creds'];
  for (const role of ['student', 'teacher', 'admin']) {
    const keys = DH_PREFETCH[role].map(([e]) => e);
    for (const ep of eps) assert.ok(keys.includes(ep), `${role} 预取清单应含 ${ep}`);
    assert.equal(DH_PREFETCH[role].filter(([, d]) => d === 'account').length, 4, `${role} account 域端点 4
个`);
  }
});
