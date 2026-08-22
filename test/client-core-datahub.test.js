/**
 * datahub core tests（旧 app-datahub parity semantics）.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dhGet, dhPeek, dhReady, dhBatchGet, dhInvalidateDomain, dhInvalidateAll,
  dhCapCache, dhTouchAll, dhPrefetch, dhCheckAppVersion,
  startVersionProbe, stopVersionProbe,
} from '../src/client/core/datahub.js';
import { invalidate, runLogoutResets } from '../src/client/core/state.js';
import { APP_VERSION } from '../src/shared/config.js';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html></html>', { url: 'http://localhost/' });
globalThis.localStorage = dom.window.localStorage;

function mockFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => { calls.push({ url: String(url), opts }); return handler(String(url), opts, calls.length); };
  return calls;
}

test('dhGet cache + forceRefresh + single-flight', async () => {
  dhInvalidateAll();
  let n = 0;
  mockFetch(async () => { n++; return { ok: true, status: 200, json: async () => ({ list: [1] }) }; });
  const first = await dhGet('/api/teachers');
  assert.deepEqual(first, { list: [1] });
  assert.equal(await dhGet('/api/teachers'), first);
  assert.equal(n, 1);
  assert.equal(dhReady('/api/teachers'), true);
  assert.deepEqual(await dhGet('/api/teachers', { forceRefresh: true }), { list: [1] });
  assert.equal(n, 2);

  dhInvalidateAll();
  let release; const gate = new Promise(r => { release = r; });
  let inflight = 0;
  mockFetch(async () => { inflight++; await gate; return { ok: true, status: 200, json: async () => ({ ok: true }) }; });
  const a = dhGet('/api/x'); const b = dhGet('/api/x');
  release();
  const [ra, rb] = await Promise.all([a, b]);
  assert.deepEqual(ra, { ok: true }); assert.deepEqual(rb, { ok: true });
  assert.equal(inflight, 1);
});

test('dhBatchGet returns Map<path,data> and chunks', async () => {
  dhInvalidateAll();
  const paths = Array.from({ length: 20 }, (_, i) => `/api/p/${i}`);
  const sizes = [];
  mockFetch(async (url, opts) => {
    assert.equal(url, '/api/batch');
    const gets = JSON.parse(opts.body).gets;
    sizes.push(gets.length);
    return { ok: true, status: 200, json: async () => ({ results: gets.map(p => ({ path: p, status: 200, data: { path: p } })) }) };
  });
  const map = await dhBatchGet(paths);
  assert.equal(map.size, 20);
  assert.deepEqual(map.get('/api/p/0'), { path: '/api/p/0' });
  assert.deepEqual(sizes, [16, 4]);
});

test('domain invalidation / state invalidate / logout reset / version check', async () => {
  dhInvalidateAll();
  let n = 0;
  mockFetch(async () => { n++; return { ok: true, status: 200, json: async () => ({ ok: true }) }; });
  await dhGet('/api/teachers', { domain: 'teachers' });
  await dhGet('/api/posts', { domain: 'posts' });
  dhInvalidateDomain('teachers');
  assert.equal(dhReady('/api/teachers'), false);
  assert.equal(dhReady('/api/posts'), true);
  await dhGet('/api/notifications', { domain: 'notifications' });
  invalidate('notifications');
  assert.equal(dhReady('/api/notifications'), false);

  globalThis.localStorage.setItem('sufe_app_version', '0.0.0');
  await dhGet('/api/teachers', { domain: 'teachers' });
  dhCheckAppVersion();
  assert.equal(dhReady('/api/teachers'), false, '版本切换整缓存作废');
  assert.equal(globalThis.localStorage.getItem('sufe_app_version'), String(APP_VERSION));

  await dhGet('/api/teachers', { domain: 'teachers' });
  runLogoutResets();
  assert.equal(dhReady('/api/teachers'), false, '登出清空缓存');
});

test('dhPrefetch(role) + version probe start/stop', async () => {
  dhInvalidateAll();
  let batchN = 0;
  mockFetch(async (url, opts) => {
    if (url === '/api/batch') {
      batchN++;
      const gets = JSON.parse(opts.body).gets;
      return { ok: true, status: 200, json: async () => ({ results: gets.map(p => ({ path: p, status: 200, data: { path: p } })) }) };
    }
    return { ok: true, status: 200, json: async () => ({ versions: { teachers: 2 } }) };
  });
  const map = await dhPrefetch('student');
  assert.ok(map instanceof Map);
  assert.ok(dhReady('/api/teachers'));
  assert.ok(batchN >= 1);
  startVersionProbe();
  stopVersionProbe();
  stopVersionProbe();
});
