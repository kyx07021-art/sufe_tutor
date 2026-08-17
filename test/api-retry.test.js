/**
 * F1 core/api 幂等 GET 网络抖动自动重试回归（B4：直接 import ESM）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api } from '../src/client/core/api.js';
import { CONFIG } from '../src/shared/config.js';

function scriptedFetch(script) {
  const calls = [];
  const impl = async (url) => {
    const step = calls.length < script.length ? script[calls.length] : script[script.length - 1];
    calls.push(String(url));
    if (step === 'network-error') throw new Error('Failed to fetch');
    if (step === 'hang') return new Promise(() => {});
    return { ok: step < 400, status: step, json: async () => ({ ok: 1 }) };
  };
  return { impl, calls };
}

test('GET 快速网络错 → 自动重试 1 次成功', async () => {
  const { impl, calls } = scriptedFetch(['network-error', 200]);
  const saved = globalThis.fetch; globalThis.fetch = impl;
  const data = await api('/api/teachers');
  globalThis.fetch = saved;
  assert.deepEqual(data, { ok: 1 });
  assert.equal(calls.length, 2);
});

test('GET 网络错重试耗尽 → 仍 NETWORK_ERROR', async () => {
  const { impl, calls } = scriptedFetch(['network-error', 'network-error']);
  const saved = globalThis.fetch; globalThis.fetch = impl;
  let err = null;
  try { await api('/api/teachers'); } catch (e) { err = e; }
  globalThis.fetch = saved;
  assert.ok(err);
  assert.equal(err.code, 'NETWORK_ERROR');
  assert.equal(calls.length, 2);
});

test('业务 5xx 不重试', async () => {
  const { impl, calls } = scriptedFetch([500]);
  const saved = globalThis.fetch; globalThis.fetch = impl;
  let err = null;
  try { await api('/api/teachers'); } catch (e) { err = e; }
  globalThis.fetch = saved;
  assert.ok(err);
  assert.equal(calls.length, 1);
});

test('401 不重试', async () => {
  const { impl, calls } = scriptedFetch([401]);
  const saved = globalThis.fetch; globalThis.fetch = impl;
  let err = null;
  try { await api('/api/contracts/my'); } catch (e) { err = e; }
  globalThis.fetch = saved;
  assert.ok(err);
  assert.equal(calls.length, 1);
});

test('POST 网络错不重试', async () => {
  const { impl, calls } = scriptedFetch(['network-error', 200]);
  const saved = globalThis.fetch; globalThis.fetch = impl;
  let err = null;
  try { await api('/api/posts', { method: 'POST', body: {} }); } catch (e) { err = e; }
  globalThis.fetch = saved;
  assert.ok(err);
  assert.equal(err.code, 'NETWORK_ERROR');
  assert.equal(calls.length, 1);
});

test('超时（挂死）不重试', async () => {
  const { impl, calls } = scriptedFetch(['hang']);
  const saved = globalThis.fetch; globalThis.fetch = impl;
  const old = CONFIG.API_TIMEOUT_MS; CONFIG.API_TIMEOUT_MS = 200;
  let err = null;
  try { await api('/api/teachers'); } catch (e) { err = e; }
  CONFIG.API_TIMEOUT_MS = old; globalThis.fetch = saved;
  assert.ok(err);
  assert.equal(err.code, 'NETWORK_ERROR');
  assert.equal(calls.length, 1);
});
