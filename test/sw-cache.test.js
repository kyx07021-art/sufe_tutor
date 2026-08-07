/**
 * sw.js 缓存缺陷回归（v0.22.7）
 * 教训来源（v0.22.6 门控事故彻查）：
 *   - 版本激活只清 sufe-v* 静态缓存、从不清 sufe-api → 旧版本边界下缓存的 API 条目跨版本残留；
 *   - 公开读缓存注释承诺 30s 短缓存，实现却命中即返、无限期服务陈旧数据。
 * 此测试用 node:vm 真实加载 sw.js，驱动 activate/fetch 事件：
 *   1. activate 预填新版本缓存，清旧版本静态缓存 + API 缓存；
 *   2. 过期/无时间戳条目不被服务（走网络重拉），回填带新时间戳；
 *   3. TTL 内新鲜条目命中即返。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SW = readFileSync('./sw.js', 'utf8');
const DEMANDS_URL = 'http://localhost/api/student/demands';

/** 假 CacheStorage：entries 结构 { name: { key: { status, headers, bodyText } } } */
function makeCacheStorage(seed = {}) {
  const store = new Map();
  for (const [name, entries] of Object.entries(seed)) {
    const m = new Map();
    for (const [k, e] of Object.entries(entries)) m.set(k, { ...e, headers: e.headers ? { ...e.headers } : {} });
    store.set(name, m);
  }
  const responseOf = e => new Response(e.bodyText, { status: e.status || 200, headers: new Headers(e.headers || {}) });
  return {
    store,
    open: async name => {
      if (!store.has(name)) store.set(name, new Map());
      const map = store.get(name);
      return {
        match: async key => { const e = map.get(String(key)); return e ? responseOf(e) : undefined; },
        put: async (key, res) => {
          const headers = {};
          res.headers.forEach((v, k) => { headers[k] = v; });
          map.set(String(key), { status: res.status, headers, bodyText: await res.text() });
        },
        addAll: async list => { for (const u of list) if (!map.has(String(u))) map.set(String(u), { status: 200, headers: {}, bodyText: 'prefilled' }); },
        delete: async key => map.delete(String(key)),
      };
    },
    keys: async () => [...store.keys()],
    delete: async name => store.delete(name),
  };
}

function makeHarness(seed = {}) {
  const listeners = {};
  const caches = makeCacheStorage(seed);
  const fetchCalls = [];
  const sandbox = {
    caches,
    self: {
      location: { origin: 'http://localhost' },
      addEventListener: (type, fn) => { listeners[type] = fn; },
      skipWaiting: () => {},
      clients: { claim: async () => {} },
    },
    location: { origin: 'http://localhost' },
    fetch: input => {
      const key = typeof input === 'string' ? input : input.url;
      fetchCalls.push(String(key));
      if (String(key).endsWith('/constants.js')) {
        return Promise.resolve(new Response("globalThis.APP_CONSTANTS = { APP_VERSION: '0.22.7' };"));
      }
      return Promise.resolve(new Response('{"demands":[{"id":99}]}', { headers: { 'Content-Type': 'application/json' } }));
    },
    Response, Headers, Request, URL, console,
  };
  vm.createContext(sandbox);
  vm.runInContext(SW, sandbox, { filename: 'sw.js' });
  return { sandbox, listeners, caches, fetchCalls };
}

/** 触发一个 fetch 事件，返回 respondWith 捕获的 promise */
function triggerFetch(h, url, method = 'GET') {
  let captured;
  h.listeners.fetch({ request: new Request(url, { method }), respondWith: p => { captured = p; } });
  return captured;
}

test('activate：预填新版本缓存，清旧版本静态缓存 + API 缓存', async () => {
  const h = makeHarness({
    'sufe-v0.22.5': { '/app-shell.js': { status: 200, headers: {}, bodyText: 'old' } },
    'sufe-api': { [DEMANDS_URL]: { status: 200, headers: { 'x-sw-cached-at': '0' }, bodyText: 'stale' } },
  });
  const activatePromise = new Promise(res => h.listeners.activate({ waitUntil: p => res(p) }));
  await activatePromise;

  const keys = await h.caches.keys();
  assert.ok(keys.includes('sufe-v0.22.7'), '新版本缓存应被创建并预填');
  assert.ok(!keys.includes('sufe-v0.22.5'), '旧版本静态缓存应被清掉');
  assert.ok(!keys.includes('sufe-api'), 'API 缓存应随版本激活清空（杜绝旧边界条目跨版本残留）');
  // 新版本缓存已预填（addAll 落盘）
  const newCache = await h.caches.open('sufe-v0.22.7');
  const hit = await newCache.match('/app-shell.js');
  assert.equal(hit && (await hit.text()), 'prefilled', '新版本缓存应已预填资产');
});

test('公开读：过期条目（超 TTL）不被服务，走网络重拉并回填新时间戳', async () => {
  const h = makeHarness({
    'sufe-api': { [DEMANDS_URL]: { status: 200, headers: { 'x-sw-cached-at': String(Date.now() - 60000) }, bodyText: 'STALE' } },
  });
  const p = triggerFetch(h, DEMANDS_URL);
  const res = await p;
  assert.equal(await res.text(), '{"demands":[{"id":99}]}', '过期条目不应命中，应返回网络新数据');
  const cache = await h.caches.open('sufe-api');
  const entry = await cache.match(DEMANDS_URL);
  const ts = Number(entry.headers.get('x-sw-cached-at'));
  assert.ok(ts > Date.now() - 5000, '回填应带新时间戳（x-sw-cached-at）');
});

test('公开读：无时间戳条目（旧版本 SW 遗留）视为过期，走网络', async () => {
  const h = makeHarness({
    'sufe-api': { [DEMANDS_URL]: { status: 200, headers: {}, bodyText: 'OLDCACHE' } },
  });
  const p = triggerFetch(h, DEMANDS_URL);
  const res = await p;
  assert.equal(await res.text(), '{"demands":[{"id":99}]}', '无时间戳 = 旧版本条目，不得服务');
});

test('公开读：TTL 内新鲜条目命中即返，后台刷新不阻塞', async () => {
  const h = makeHarness({
    'sufe-api': { [DEMANDS_URL]: { status: 200, headers: { 'x-sw-cached-at': String(Date.now()) }, bodyText: 'CACHED' } },
  });
  const p = triggerFetch(h, DEMANDS_URL);
  const res = await p;
  assert.equal(await res.text(), 'CACHED', 'TTL 内应命中缓存而非走网络');
});

test('apiEntryFresh：时间戳判定', () => {
  const h = makeHarness();
  const run = code => vm.runInContext(code, h.sandbox);
  assert.equal(run(`apiEntryFresh(new Response('x', { headers: { 'x-sw-cached-at': String(Date.now()) } }))`), true, '新鲜');
  assert.equal(run(`apiEntryFresh(new Response('x', { headers: { 'x-sw-cached-at': String(Date.now() - 60000) } }))`), false, '过期');
  assert.equal(run(`apiEntryFresh(new Response('x'))`), false, '无时间戳');
});
