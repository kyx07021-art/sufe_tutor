/**
 * core/api.js fetch 挂死保护回归（B4：直接 import ESM）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api } from '../src/client/core/api.js';
import { CONFIG } from '../src/shared/config.js';

function hangWithAbort() {
  return (url, cfg) => new Promise((resolve, reject) => {
    if (cfg && cfg.signal) {
      cfg.signal.addEventListener('abort', () => reject(new Error('Aborted by timeout')));
    }
  });
}

test('api()：挂死请求超时后抛 NETWORK_ERROR', async () => {
  const old = CONFIG.API_TIMEOUT_MS;
  CONFIG.API_TIMEOUT_MS = 200;
  const savedFetch = globalThis.fetch;
  globalThis.fetch = hangWithAbort();
  const t0 = Date.now();
  let err = null;
  try { await api('/api/auth/login', { method: 'POST', body: { username: 'a', password: 'b' } }); } catch (e) { err = e; }
  const elapsed = Date.now() - t0;
  globalThis.fetch = savedFetch;
  CONFIG.API_TIMEOUT_MS = old;
  assert.ok(err, '应抛错而非永远挂起');
  assert.equal(err.code, 'NETWORK_ERROR', '超时应归为网络错误');
  assert.ok(elapsed < 3000, `应约在超时阈值收口（实测 ${elapsed}ms）`);
});

test('api()：正常响应不受超时影响', async () => {
  const old = CONFIG.API_TIMEOUT_MS;
  CONFIG.API_TIMEOUT_MS = 200;
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ hello: 1 }) });
  const data = await api('/api/auth/me');
  globalThis.fetch = savedFetch;
  CONFIG.API_TIMEOUT_MS = old;
  assert.deepEqual(data, { hello: 1 });
});
