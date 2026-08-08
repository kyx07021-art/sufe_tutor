/**
 * 会话数据层（app-datahub.js，v0.23.0 静默数据层）回归
 *
 * 覆盖：
 *   - dhGet 缓存命中/miss（二次读取零请求）
 *   - 并发同 key 共享在途请求（预取与默认 tab 首次加载撞车不双发）
 *   - dhPeek 保底 TTL 过期判定
 *   - dhInvalidateDomain 只清指定域 / dhInvalidateAll 全清
 *   - dhPrefetch 单键失败静默，不阻断其余
 *   - dhProbeTick：域计数变化只重拉变化域（不动未变域缓存）
 *   - 探测失败保留基线，不误触发全量重拉
 *   - 标签页隐藏暂停探测
 *   - dhGet forceRefresh 绕过缓存
 *   - startVersionProbe 启动即建基线 / stopVersionProbe 安全
 *
 * 沙箱：constants + app-state + app-api + app-datahub（与 api-timeout.test.js 同款 vm 模式），
 * fetch 用可控 mock（按 URL 路由，Error 值模拟失败）。
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
    setInterval: () => 99, clearInterval: () => {}, // 桩：探测轮询不真起定时器，防测试进程挂起
    AbortController: globalThis.AbortController,
    fetch: fetchImpl,
    SUFE_DISPLAY: {},
    document: { hidden: false, addEventListener: () => {} },
  };
  vm.createContext(sandbox);
  for (const f of ['constants.js', 'app-state.js', 'app-api.js', 'app-datahub.js']) {
    vm.runInContext(readFileSync('./' + f, 'utf8'), sandbox, { filename: f });
  }
  return sandbox;
}

/** 可控 fetch：按 URL 路由返回；值为 Error 则抛错（模拟网络/服务端失败） */
function makeFetch() {
  const calls = [];
  const routes = new Map();
  const impl = async (url) => {
    calls.push(String(url));
    const r = routes.get(String(url));
    if (r instanceof Error) throw r;
    const body = typeof r === 'function' ? await r() : (r !== undefined ? r : {});
    return { ok: true, status: 200, json: async () => body };
  };
  return { impl, calls, routes };
}

test('dhGet：缓存命中即返，miss 才发请求', async () => {
  const { impl, calls, routes } = makeFetch();
  routes.set('/api/teachers', { teachers: [{ id: 1 }] });
  const ctx = makeCtx({ fetchImpl: impl });
  vm.runInContext('CONFIG.DH_TTL_MS = 600000;', ctx);
  const a = await vm.runInContext(`dhGet('/api/teachers', { domain: 'teachers' })`, ctx);
  assert.deepEqual(a, { teachers: [{ id: 1 }] });
  const b = await vm.runInContext(`dhGet('/api/teachers', { domain: 'teachers' })`, ctx);
  assert.deepEqual(b, a);
  assert.equal(calls.length, 1, '第二次命中缓存，零请求');
});

test('dhGet：并发同 key 共享一个在途请求（预取与 tab 首载撞车不双发）', async () => {
  let resolveFn;
  const calls = [];
  const ctx = makeCtx({ fetchImpl: (url) => { calls.push(String(url)); return new Promise(r => { resolveFn = r; }); } });
  const p1 = vm.runInContext(`dhGet('/api/teachers', { domain: 'teachers' })`, ctx);
  const p2 = vm.runInContext(`dhGet('/api/teachers', { domain: 'teachers' })`, ctx);
  assert.equal(calls.length, 1, '并发应共享一个请求');
  resolveFn({ ok: true, status: 200, json: async () => ({ teachers: [{ id: 9 }] }) });
  const [a, b] = await Promise.all([p1, p2]);
  assert.deepEqual(a, b, '两个调用方拿同一份数据');
  await vm.runInContext(`dhGet('/api/teachers', { domain: 'teachers' })`, ctx);
  assert.equal(calls.length, 1, '请求完成后走缓存，不再发请求');
});

test('dhPeek：保底 TTL 过期后视为未命中', async () => {
  const { impl, calls, routes } = makeFetch();
  routes.set('/api/teachers', { teachers: [] });
  const ctx = makeCtx({ fetchImpl: impl });
  vm.runInContext('CONFIG.DH_TTL_MS = -1;', ctx); // 立即过期
  await vm.runInContext(`dhGet('/api/teachers', { domain: 'teachers' })`, ctx);
  assert.equal(vm.runInContext(`dhPeek('/api/teachers')`, ctx), null, '过期应返回 null');
  vm.runInContext('CONFIG.DH_TTL_MS = 600000;', ctx);
  await vm.runInContext(`dhGet('/api/teachers', { domain: 'teachers' })`, ctx);
  assert.notEqual(vm.runInContext(`dhPeek('/api/teachers')`, ctx), null, 'TTL 内应命中');
  assert.equal(calls.length, 2, '过期那次 miss 触发重拉');
});

test('dhInvalidateDomain：只清指定域；dhInvalidateAll 全清', async () => {
  const { impl, routes } = makeFetch();
  routes.set('/api/teachers', { teachers: [] });
  routes.set('/api/student/demands?scope=mine', { demands: [] });
  const ctx = makeCtx({ fetchImpl: impl });
  vm.runInContext('CONFIG.DH_TTL_MS = 600000;', ctx);
  await vm.runInContext(`dhGet('/api/teachers', { domain: 'teachers' })`, ctx);
  await vm.runInContext(`dhGet('/api/student/demands?scope=mine', { domain: 'demands' })`, ctx);
  vm.runInContext(`dhInvalidateDomain('demands')`, ctx);
  assert.equal(vm.runInContext(`dhPeek('/api/student/demands?scope=mine')`, ctx), null, 'demands 域应被清');
  assert.notEqual(vm.runInContext(`dhPeek('/api/teachers')`, ctx), null, 'teachers 域不受牵连');
  vm.runInContext('dhInvalidateAll()', ctx);
  assert.equal(vm.runInContext(`dhPeek('/api/teachers')`, ctx), null, '全清后 teachers 也空');
});

test('dhPrefetch：单键失败静默，不阻断其余键', async () => {
  const { impl, calls, routes } = makeFetch();
  routes.set('/api/teachers', new Error('boom')); // 该键失败
  routes.set('/api/contracts/my', { contracts: [] });
  const ctx = makeCtx({ fetchImpl: impl });
  vm.runInContext('CONFIG.DH_TTL_MS = 600000;', ctx);
  const r = await vm.runInContext('dhPrefetch("student")', ctx); // allSettled：绝不抛
  assert.ok(Array.isArray(r), '应返回 allSettled 结果数组');
  assert.equal(calls.filter(u => u === '/api/contracts/my').length, 1, '其余键照常预取');
  assert.equal(vm.runInContext(`dhPeek('/api/contracts/my')`, ctx) !== null, true, '成功键已入缓存');
});

test('dhProbeTick：域计数变化只重拉变化域（不动未变域缓存）', async () => {
  const { impl, calls, routes } = makeFetch();
  routes.set('/api/student/demands?scope=mine', { demands: [{ id: 1 }] });
  routes.set('/api/teachers', { teachers: [{ user_id: 1 }] });
  routes.set('/api/data-version', { versions: { demands: 1, teachers: 1 } });
  const ctx = makeCtx({ fetchImpl: impl });
  vm.runInContext('CONFIG.DH_TTL_MS = 600000;', ctx);
  await vm.runInContext(`dhGet('/api/student/demands?scope=mine', { domain: 'demands' })`, ctx);
  await vm.runInContext(`dhGet('/api/teachers', { domain: 'teachers' })`, ctx);
  const demandsN0 = calls.filter(u => u.includes('/api/student/demands?scope=mine')).length;
  const teachersN0 = calls.filter(u => u === '/api/teachers').length;

  await vm.runInContext('dhProbeTick()', ctx); // tick1：建基线，prev undefined → 不重拉
  assert.equal(calls.filter(u => u.includes('/api/student/demands?scope=mine')).length, demandsN0, '首次仅建基线');
  assert.equal(calls.filter(u => u === '/api/teachers').length, teachersN0);

  routes.set('/api/data-version', { versions: { demands: 2, teachers: 1 } }); // 仅 demands 变化
  await vm.runInContext('dhProbeTick()', ctx);
  assert.equal(calls.filter(u => u.includes('/api/student/demands?scope=mine')).length, demandsN0 + 1, 'demands 变化应重拉');
  assert.equal(calls.filter(u => u === '/api/teachers').length, teachersN0, 'teachers 未变不应重拉');
});

test('dhProbeTick：探测失败保留基线，不误触发全量重拉', async () => {
  const { impl, calls, routes } = makeFetch();
  routes.set('/api/student/demands?scope=mine', { demands: [] });
  routes.set('/api/data-version', { versions: { demands: 1 } });
  const ctx = makeCtx({ fetchImpl: impl });
  vm.runInContext('CONFIG.DH_TTL_MS = 600000;', ctx);
  await vm.runInContext(`dhGet('/api/student/demands?scope=mine', { domain: 'demands' })`, ctx);
  await vm.runInContext('dhProbeTick()', ctx); // 基线 {demands:1}
  const demandsN0 = calls.filter(u => u.includes('/api/student/demands?scope=mine')).length;

  routes.set('/api/data-version', new Error('探测断线'));
  await vm.runInContext('dhProbeTick()', ctx); // 失败静默，不抛
  assert.equal(calls.filter(u => u.includes('/api/student/demands?scope=mine')).length, demandsN0, '探测失败不重拉');

  routes.set('/api/data-version', { versions: { demands: 2 } }); // 恢复后对比基线
  await vm.runInContext('dhProbeTick()', ctx);
  assert.equal(calls.filter(u => u.includes('/api/student/demands?scope=mine')).length, demandsN0 + 1, '基线保留，变化仍能检出');
});

test('dhProbeTick：标签页隐藏暂停探测', async () => {
  const { impl, calls, routes } = makeFetch();
  routes.set('/api/data-version', { versions: {} });
  const ctx = makeCtx({ fetchImpl: impl });
  ctx.document.hidden = true;
  await vm.runInContext('dhProbeTick()', ctx);
  assert.equal(calls.filter(u => u === '/api/data-version').length, 0, 'hidden 时不应发探测请求');
  ctx.document.hidden = false;
  await vm.runInContext('dhProbeTick()', ctx);
  assert.equal(calls.filter(u => u === '/api/data-version').length, 1, '可见后正常探测');
});

test('dhGet forceRefresh：绕过缓存重拉', async () => {
  let n = 0;
  const { impl, calls, routes } = makeFetch();
  routes.set('/api/teachers', () => ({ teachers: [{ n: ++n }] }));
  const ctx = makeCtx({ fetchImpl: impl });
  vm.runInContext('CONFIG.DH_TTL_MS = 600000;', ctx);
  const a = await vm.runInContext(`dhGet('/api/teachers', { domain: 'teachers' })`, ctx);
  assert.equal(a.teachers[0].n, 1);
  await vm.runInContext(`dhGet('/api/teachers', { domain: 'teachers' })`, ctx);
  assert.equal(calls.length, 1, '缓存命中');
  const b = await vm.runInContext(`dhGet('/api/teachers', { domain: 'teachers', forceRefresh: true })`, ctx);
  assert.equal(b.teachers[0].n, 2, 'forceRefresh 应重拉新数据');
  assert.equal(calls.length, 2);
});

test('startVersionProbe 立即建基线；stopVersionProbe 安全', async () => {
  const { impl, calls, routes } = makeFetch();
  routes.set('/api/data-version', { versions: {} });
  const ctx = makeCtx({ fetchImpl: impl });
  vm.runInContext('startVersionProbe()', ctx);
  vm.runInContext('stopVersionProbe()', ctx);
  await new Promise(r => setTimeout(r, 0)); // 等立即 tick 的微任务落定
  assert.ok(calls.includes('/api/data-version'), '启动即探测建基线');
  vm.runInContext('stopVersionProbe()', ctx); // 幂等：重复 stop 不炸
});

test('dhOnDomainRefresh：探测刷新后重挂函数执行、别名指向新缓存数组（审计 M1）', async () => {
  let alias = null;
  const { impl, routes } = makeFetch();
  routes.set('/api/teachers', { teachers: [{ user_id: 1, name: 'v1' }] });
  const ctx = makeCtx({ fetchImpl: impl });
  vm.runInContext('CONFIG.DH_TTL_MS = 600000;', ctx);
  await vm.runInContext(`dhGet('/api/teachers', { domain: 'teachers' })`, ctx);
  // 注册重挂：刷新后从缓存取新数组写进别名
  vm.runInContext(`
    dhOnDomainRefresh('teachers', () => {
      const c = dhPeek('/api/teachers');
      alias = c ? c.teachers : null;
    });
  `, ctx);
  routes.set('/api/teachers', { teachers: [{ user_id: 1, name: 'v2' }] }); // 服务端数据变化
  await vm.runInContext(`dhRefreshDomain('teachers')`, ctx);
  assert.equal(vm.runInContext('alias[0].name', ctx), 'v2', '重挂后别名应指向新缓存数组');
});

test('dhGet 会话代次：登出后（dhInvalidateAll）在途请求回落后不写入缓存（审计 m1）', async () => {
  let resolveFn;
  const calls = [];
  const ctx = makeCtx({ fetchImpl: (url) => { calls.push(String(url)); return new Promise(r => { resolveFn = r; }); } });
  const p = vm.runInContext(`dhGet('/api/teachers', { domain: 'teachers' })`, ctx); // 在途
  vm.runInContext('dhInvalidateAll()', ctx); // 会话切换
  resolveFn({ ok: true, status: 200, json: async () => ({ teachers: [{ id: 1 }] }) });
  await p;
  assert.equal(vm.runInContext(`dhPeek('/api/teachers')`, ctx), null, '旧账户数据不得残留进缓存');
});

test('dhProbeTick：域刷新失败保留旧基线，下轮重试（审计 m5）', async () => {
  const { impl, calls, routes } = makeFetch();
  routes.set('/api/student/demands?scope=mine', { demands: [{ id: 1 }] });
  routes.set('/api/data-version', { versions: { demands: 1 } });
  const ctx = makeCtx({ fetchImpl: impl });
  vm.runInContext('CONFIG.DH_TTL_MS = 600000;', ctx);
  await vm.runInContext(`dhGet('/api/student/demands?scope=mine', { domain: 'demands' })`, ctx);
  await vm.runInContext('dhProbeTick()', ctx); // 基线 {demands:1}
  const n0 = calls.filter(u => u.includes('/api/student/demands?scope=mine')).length;

  routes.set('/api/data-version', { versions: { demands: 2 } });
  routes.set('/api/student/demands?scope=mine', new Error('刷新失败')); // 域刷新失败
  await vm.runInContext('dhProbeTick()', ctx);
  routes.set('/api/student/demands?scope=mine', { demands: [{ id: 1 }] }); // 恢复
  await vm.runInContext('dhProbeTick()', ctx);
  assert.equal(calls.filter(u => u.includes('/api/student/demands?scope=mine')).length, n0 + 2,
    '失败那轮后基线保留，恢复后仍会重拉一次');
});

test('dhCheckAppVersion：版本变化 → 强清缓存并覆写版本号；同版本 → 不动（v0.25.12 发版强清）', async () => {
  const store = new Map();
  const ctx = makeCtx({ fetchImpl: () => Promise.resolve({ ok: true, status: 200, json: async () => ({ teachers: [] }) }) });
  ctx.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
  vm.runInContext('CONFIG.DH_TTL_MS = 600000;', ctx);
  const cur = vm.runInContext('String(APP_CONSTANTS.APP_VERSION)', ctx);
  vm.runInContext('dhCheckAppVersion()', ctx); // boot 时 localStorage 未注入已静默跳过；此调用落版本基线
  await vm.runInContext(`dhGet('/api/teachers', { domain: 'teachers' })`, ctx);
  assert.notEqual(vm.runInContext(`dhPeek('/api/teachers')`, ctx), null, '先有缓存数据');
  // 模拟发版：localStorage 版本为旧版本 → 强清缓存 + 覆写新版本号
  vm.runInContext(`localStorage.setItem(DH_VERSION_KEY, '0.0.0')`, ctx);
  vm.runInContext('dhCheckAppVersion()', ctx);
  assert.equal(vm.runInContext(`dhPeek('/api/teachers')`, ctx), null, '版本变化 → 整体作废缓存');
  assert.equal(vm.runInContext('localStorage.getItem(DH_VERSION_KEY)', ctx), cur, '清后覆写为当前版本号');
  // 同版本再查 → 不再误清
  await vm.runInContext(`dhGet('/api/teachers', { domain: 'teachers' })`, ctx);
  vm.runInContext('dhCheckAppVersion()', ctx);
  assert.notEqual(vm.runInContext(`dhPeek('/api/teachers')`, ctx), null, '同版本不误清');
});

test('dhProbeTick：getVersions 全域补零后首写 0→1 触发重拉（审计 m1）', async () => {
  const { impl, calls, routes } = makeFetch();
  routes.set('/api/teachers', { teachers: [] });
  routes.set('/api/data-version', { versions: { demands: 0, teachers: 0 } });
  const ctx = makeCtx({ fetchImpl: impl });
  vm.runInContext('CONFIG.DH_TTL_MS = 600000;', ctx);
  await vm.runInContext(`dhGet('/api/teachers', { domain: 'teachers' })`, ctx);
  await vm.runInContext('dhProbeTick()', ctx); // 基线 {teachers:0}
  const n0 = calls.filter(u => u === '/api/teachers').length;
  routes.set('/api/data-version', { versions: { demands: 0, teachers: 1 } }); // 全站首条教师相关写
  await vm.runInContext('dhProbeTick()', ctx);
  assert.equal(calls.filter(u => u === '/api/teachers').length, n0 + 1, '0→1 应触发重拉');
});
