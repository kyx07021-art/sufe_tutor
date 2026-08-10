/**
 * F1（v0.27.0 网络层重构）—— app-api 幂等 GET 网络抖动自动重试回归
 *
 * 覆盖：
 *   - 快速网络错（fetch 抛 NETWORK_ERROR）GET 重试 1 次成功（自愈，共 2 次调用）
 *   - 网络错重试耗尽仍 NETWORK_ERROR（不吞错）
 *   - 业务 4xx（HTTP 响应，非网络错）不重试
 *   - 401 不重试（走幂等兜底语义，重放不可）
 *   - POST（写路径）不重试（防双写）
 *   - 超时（20s 停滞形态）不重试（已等太久重试更糟）
 *
 * 沙箱：constants + app-state + app-api（同 api-timeout.test.js vm 模式），fetch 可控脚本化。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function makeCtx({ fetchImpl }) {
  const sandbox = {
    console,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    AbortController: globalThis.AbortController,
    fetch: fetchImpl,
    SUFE_DISPLAY: {},
  };
  vm.createContext(sandbox);
  for (const f of ['constants.js', 'app-state.js', 'app-api.js']) {
    vm.runInContext(readFileSync('./' + f, 'utf8'), sandbox, { filename: f });
  }
  return sandbox;
}

/** 脚本化 fetch：按调用次数序列返回（reject=网络错 / Response 形状 / 挂起=超时形态） */
function scriptedFetch(script) {
  const calls = [];
  const impl = async (url, cfg) => {
    const step = calls.length < script.length ? script[calls.length] : script[script.length - 1];
    calls.push(String(url));
    if (step === 'network-error') throw new Error('Failed to fetch');
    if (step === 'hang') return new Promise(() => {}); // 挂死 → 超时掐断
    return { ok: step < 400, status: step, json: async () => ({ ok: 1 }) };
  };
  return { impl, calls };
}

test('GET 快速网络错 → 自动重试 1 次成功（自愈）', async () => {
  const { impl, calls } = scriptedFetch(['network-error', 200]);
  const ctx = makeCtx({ fetchImpl: impl });
  const data = await vm.runInContext(`api('/api/teachers')`, ctx);
  assert.deepEqual(data, { ok: 1 }, '重试后返回数据');
  assert.equal(calls.length, 2, '首次失败 + 一次重试');
});

test('GET 网络错重试耗尽 → 仍 NETWORK_ERROR（不吞错）', async () => {
  const { impl, calls } = scriptedFetch(['network-error', 'network-error']);
  const ctx = makeCtx({ fetchImpl: impl });
  let err = null;
  try { await vm.runInContext(`api('/api/teachers')`, ctx); } catch (e) { err = e; }
  assert.ok(err, '应抛错');
  assert.equal(err.code, 'NETWORK_ERROR', '重试耗尽仍归网络错误');
  assert.equal(calls.length, 2, '重试 1 次（GET_RETRY=1）');
});

test('业务 4xx（HTTP 响应）不重试（不可重放）', async () => {
  const { impl, calls } = scriptedFetch([500]);
  const ctx = makeCtx({ fetchImpl: impl });
  let err = null;
  try { await vm.runInContext(`api('/api/teachers')`, ctx); } catch (e) { err = e; }
  assert.ok(err, '5xx 抛业务错误');
  assert.equal(err.code, undefined, '5xx 无稳定 code 时原样抛（不重试）');
  assert.equal(calls.length, 1, '5xx 不重试');
});

test('401 不重试（走幂等兜底，不可重放）', async () => {
  const { impl, calls } = scriptedFetch([401]);
  const ctx = makeCtx({ fetchImpl: impl });
  let err = null;
  try { await vm.runInContext(`api('/api/contracts/my')`, ctx); } catch (e) { err = e; }
  assert.ok(err, '401 抛业务错误');
  assert.equal(calls.length, 1, '401 不重试');
});

test('POST（写路径）网络错不重试（防双写）', async () => {
  const { impl, calls } = scriptedFetch(['network-error', 200]);
  const ctx = makeCtx({ fetchImpl: impl });
  let err = null;
  try { await vm.runInContext(`api('/api/posts', { method: 'POST', body: {} })`, ctx); } catch (e) { err = e; }
  assert.ok(err, 'POST 网络错应抛');
  assert.equal(err.code, 'NETWORK_ERROR');
  assert.equal(calls.length, 1, '写路径不重试');
});

test('超时（挂死）不重试（已等 20s，重试更糟）', async () => {
  const { impl, calls } = scriptedFetch(['hang']);
  const ctx = makeCtx({ fetchImpl: impl });
  vm.runInContext('CONFIG.API_TIMEOUT_MS = 200;', ctx);
  let err = null;
  try { await vm.runInContext(`api('/api/teachers')`, ctx); } catch (e) { err = e; }
  assert.ok(err, '超时应抛');
  assert.equal(err.code, 'NETWORK_ERROR');
  assert.equal(calls.length, 1, '超时不重试（非 isTimeout 网络错才重试）');
});
