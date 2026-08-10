/**
 * v0.26.13 D3 401 预取风暴收敛（#313）—— app-api 401 兜底幂等化回归：
 *
 * 生产实证（会话失效后）：徽标轮询/预取并发在途请求同刻落回 401（同 IPv6 同刻 21 个 GET 401，
 * dur=0ms）。修复前每个 401 都走完整兜底——clearSession/runLogoutResets/showView('login')
 * 重复执行 N 次，登录页重渲染风暴。修复 = 幂等键 lastHandled401Token：同一死令牌的 401 只处理
 * 一次，后续同令牌 401 整体跳过；令牌换新后新 401 重新走兜底（每个令牌至多处理一次）。
 *
 * 覆盖：
 *   - 401 风暴：同刻并发 5 个死令牌 401 → 只清一次会话、只跳一次登录、只跑一次登出复位；
 *   - 幂等键按令牌隔离：重新登录（新令牌）后新 401 重新走兜底（非永久禁用）；
 *   - A1 语义保留：旧令牌在途 401 落回时若已重新登录（当前令牌≠旧令牌）→ 不误清新会话。
 * vm 环境：加载 constants/app-state/app-api（app-auth 未加载），注入可计数 ensureAuth/
 * runLogoutResets 钩子（typeof 守卫原样走）。
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
  // 注入可计数的 401 汇登录钩子（app-auth 未加载；app-api 的 typeof 守卫原样走）
  vm.runInContext(`
    ensureAuthCalls = 0; runLogoutResetsCalls = 0;
    const _origRunLogoutResets = runLogoutResets;
    runLogoutResets = function(){ runLogoutResetsCalls++; return _origRunLogoutResets(); };
    ensureAuth = function(){ ensureAuthCalls++; };
  `, sandbox);
  return sandbox;
}

/** 401 响应桩（非真 Response：api() 只消费 ok/status/json，够用） */
const UNAUTH = () => ({ ok: false, status: 401, json: async () => ({ error: '会话已过期', code: 'AUTH_EXPIRED' }) });

test('401 风暴：同刻并发 5 个死令牌 401 只清一次会话、只跳一次登录', async () => {
  const ctx = makeCtx({ fetchImpl: async () => UNAUTH() });
  const codes = await vm.runInContext(`(async () => {
    state.authToken = 'tok-dead'; state.user = { role: 'student' }; state.view = 'client';
    const results = await Promise.allSettled([0,1,2,3,4].map(() => api('/api/a')));
    return results.map(r => r.status === 'rejected' ? r.reason.code : 'resolved');
  })()`, ctx);
  assert.deepEqual(Array.from(codes), ['AUTH_EXPIRED', 'AUTH_EXPIRED', 'AUTH_EXPIRED', 'AUTH_EXPIRED', 'AUTH_EXPIRED'],
    '5 个请求全部抛业务错误码（跳过幂等分支不吞错）');
  assert.equal(ctx.ensureAuthCalls, 1, '登录跳转只发生 1 次（幂等键收敛风暴）');
  assert.equal(ctx.runLogoutResetsCalls, 1, '登出复位只跑 1 次');
  assert.equal(vm.runInContext('state.authToken', ctx), null, '会话已清');
});

test('幂等键按令牌隔离：重新登录（新令牌）后新 401 重新走兜底', async () => {
  const ctx = makeCtx({ fetchImpl: async () => UNAUTH() });
  await vm.runInContext(`(async () => {
    state.authToken = 'tok1'; state.user = { role: 'student' }; state.view = 'client';
    await api('/api/a').catch(() => {}); // tok1 死令牌 401 → 处理 1 次
    state.authToken = 'tok2'; state.user = { role: 'student' }; state.view = 'client'; // 重新登录
    await api('/api/b').catch(() => {}); // tok2 新令牌 401 → 必须重新处理
  })()`, ctx);
  assert.equal(ctx.ensureAuthCalls, 2, '两个不同令牌各处理一次（非永久禁用）');
  assert.equal(ctx.runLogoutResetsCalls, 2, '两次会话失效各跑登出复位');
  assert.equal(vm.runInContext('state.authToken', ctx), null, '新令牌会话同样被清');
});

test('A1 语义保留：旧令牌在途 401 落回时已重新登录 → 不误清新会话', async () => {
  const ctx = makeCtx({ fetchImpl: async () => UNAUTH() });
  await vm.runInContext(`(async () => {
    state.authToken = 'tok1'; state.user = { role: 'student' }; state.view = 'client';
    let release; const hold = new Promise(r => { release = r; });
    fetch = () => hold; // 挂住第一个请求（发起时捕获 sentToken='tok1'）
    const p1 = api('/api/a').catch(() => {});
    state.authToken = 'tok2'; state.user = { role: 'teacher' }; // 响应前已重新登录
    release({ ok: false, status: 401, json: async () => ({ error: '会话已过期', code: 'AUTH_EXPIRED' }) }); // 旧请求此刻落 401
    await p1;
  })()`, ctx);
  assert.equal(vm.runInContext('state.authToken', ctx), 'tok2', '新会话未被旧 401 清掉');
  assert.equal(vm.runInContext('state.user && state.user.role', ctx), 'teacher', '新账户身份保留');
  assert.equal(ctx.runLogoutResetsCalls, 0, '旧令牌≠当前令牌：未触发登出复位');
});
