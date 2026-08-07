/**
 * app-api.js fetch 挂死保护回归（v0.22.7）
 * 教训来源（v0.22.6 门控事故彻查）：无超时 fetch 在停滞 SW/异常网络下永不 settle，
 * 登录按钮「永远加载中」无法收口。api() 现按 CONFIG.API_TIMEOUT_MS 超时中止 → 归 NETWORK_ERROR。
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
    SUFE_DISPLAY: {}, // app-state 读取 globalThis.SUFE_DISPLAY
  };
  vm.createContext(sandbox);
  for (const f of ['constants.js', 'app-state.js', 'app-api.js']) {
    vm.runInContext(readFileSync('./' + f, 'utf8'), sandbox, { filename: f });
  }
  return sandbox;
}

/** 挂死 fetch：不 resolve，仅响应调用方 signal 的 abort 信号拒绝（模拟停滞 SW 下的挂死请求） */
function hangWithAbort() {
  return (url, cfg) => new Promise((resolve, reject) => {
    if (cfg && cfg.signal) {
      cfg.signal.addEventListener('abort', () => reject(new Error('Aborted by timeout')));
    }
  });
}

test('api()：挂死请求超时后抛 NETWORK_ERROR（不无限转圈）', async () => {
  const ctx = makeCtx({ fetchImpl: hangWithAbort() });
  vm.runInContext('CONFIG.API_TIMEOUT_MS = 200;', ctx); // 测试提速
  const t0 = Date.now();
  let err = null;
  try {
    await vm.runInContext(`api('/api/auth/login', { method: 'POST', body: { username: 'a', password: 'b' } })`, ctx);
  } catch (e) { err = e; }
  const elapsed = Date.now() - t0;
  assert.ok(err, '应抛错而非永远挂起');
  assert.equal(err.code, 'NETWORK_ERROR', '超时应归为网络错误（统一文案/收口）');
  assert.ok(elapsed < 3000, `应约在超时阈值收口（实测 ${elapsed}ms）`);
});

test('api()：正常响应不受超时影响', async () => {
  const ctx = makeCtx({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ hello: 1 }) }) });
  vm.runInContext('CONFIG.API_TIMEOUT_MS = 200;', ctx);
  const data = await vm.runInContext(`api('/api/auth/me')`, ctx);
  assert.deepEqual(data, { hello: 1 });
});
