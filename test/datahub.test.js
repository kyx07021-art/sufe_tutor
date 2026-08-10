/**
 * 会话数据层（app-datahub.js，v0.23.0 静默数据层）回归
 *
 * 覆盖：
 *   - dhGet 缓存命中/miss（二次读取零请求）
 *   - 并发同 key 共享在途请求（预取与默认 tab 首次加载撞车不双发）
 *   - dhPeek 保底 TTL 过期判定
 *   - dhInvalidateDomain 只清指定域 / dhInvalidateAll 全清
 *   - dhPrefetch 批量（B2/F3 v0.27.0）：一次 /api/batch 往返、单键失败静默不阻断其余
 *   - dhProbeTick：域计数变化只重拉变化域（批量）、探测失败保留基线、标签页隐藏暂停
 *   - dhBatchGet：缓存跳过/在途共享/一次批量/部分失败/域 rebinder 执行（F3）
 *   - dhGet forceRefresh 绕过缓存
 *   - startVersionProbe 启动即建基线 / stopVersionProbe 安全
 *   - dhSnapshot/dhApply/dhRevert 乐观写辅助（F5）
 *
 * 沙箱：constants + app-state + app-api + app-datahub（与 api-timeout.test.js 同款 vm 模式），
 * fetch 用可控 mock（按 URL 路由，Error 值模拟失败；POST /api/batch 特殊合成批量结果）。
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

/** 可控 fetch：按 URL 路由返回；值为 Error 则抛错（模拟网络/服务端失败）。
 *  POST /api/batch 特殊处理（B2/F3）：从 body.gets 逐 path 查 routes 合成批量结果，
 *  并记录每次批量请求的 paths 到 batchGets（供「批量合并/去重」断言）。 */
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

test('dhPrefetch：批量一次往返、单键失败静默，不阻断其余键（B2/F3）', async () => {
  const { impl, calls, routes, batchGets } = makeFetch();
  routes.set('/api/teachers', new Error('boom')); // 该键失败
  routes.set('/api/contracts/my', { contracts: [] });
  const ctx = makeCtx({ fetchImpl: impl });
  vm.runInContext('CONFIG.DH_TTL_MS = 600000;', ctx);
  const r = await vm.runInContext('dhPrefetch("student")', ctx); // 绝不抛（Map 或空）
  assert.equal(Object.prototype.toString.call(r), '[object Map]', '应返回 Map');
  assert.equal(calls.filter(u => u === '/api/batch').length, 1, 'DH_PREFETCH 全键一次批量拉取');
  assert.equal(calls.filter(u => u === '/api/contracts/my').length, 0, '子请求不再单独打网（走批量）');
  assert.equal(vm.runInContext(`dhPeek('/api/contracts/my')`, ctx) !== null, true, '成功键已入缓存');
  assert.equal(vm.runInContext(`dhPeek('/api/teachers')`, ctx), null, '失败键不入缓存');
  // 批量 payload 覆盖角色全部端点（含 B6 设置页四表单）
  const lastGets = batchGets[batchGets.length - 1];
  assert.ok(lastGets.includes('/api/contracts/my'), '批量应含 contracts/my');
  assert.ok(lastGets.includes('/api/user/creds'), '批量应含设置页 creds（B6 account 域）');
});

test('dhBatchGet：缓存命中键跳过、在途键共享、缺键一次批量（F3）', async () => {
  const { impl, calls, routes, batchGets } = makeFetch();
  routes.set('/api/teachers', { teachers: [{ id: 1 }] });
  routes.set('/api/notifications', { notifications: [] });
  const ctx = makeCtx({ fetchImpl: impl });
  vm.runInContext('CONFIG.DH_TTL_MS = 600000;', ctx);
  await vm.runInContext(`dhGet('/api/teachers', { domain: 'teachers' })`, ctx); // 预置缓存
  const r = await vm.runInContext(`dhBatchGet([{path:'/api/teachers',domain:'teachers'},{path:'/api/notifications',domain:'notifications'}])`, ctx);
  assert.ok(r.has('/api/teachers'), '缓存命中键直出');
  assert.ok(r.has('/api/notifications'), '缺键批量拉取');
  assert.equal(calls.filter(u => u === '/api/batch').length, 1);
  assert.deepEqual(batchGets[0], ['/api/notifications'], '批量只拉缺键（teachers 已缓存不入批量）');
});

test('dhProbeTick：域计数变化只重拉变化域（批量；不动未变域缓存）', async () => {
  const { impl, calls, routes, batchGets } = makeFetch();
  routes.set('/api/student/demands?scope=mine', { demands: [{ id: 1 }] });
  routes.set('/api/teachers', { teachers: [{ user_id: 1 }] });
  routes.set('/api/data-version', { versions: { demands: 1, teachers: 1 } });
  const ctx = makeCtx({ fetchImpl: impl });
  vm.runInContext('CONFIG.DH_TTL_MS = 600000;', ctx);
  await vm.runInContext(`dhGet('/api/student/demands?scope=mine', { domain: 'demands' })`, ctx);
  await vm.runInContext(`dhGet('/api/teachers', { domain: 'teachers' })`, ctx);
  const demandsN0 = calls.filter(u => u === '/api/student/demands?scope=mine').length;
  const teachersN0 = calls.filter(u => u === '/api/teachers').length;

  await vm.runInContext('dhProbeTick()', ctx); // tick1：建基线，prev undefined → 不重拉
  assert.equal(calls.filter(u => u === '/api/batch').length, 0, '首次仅建基线，不重拉');

  routes.set('/api/data-version', { versions: { demands: 2, teachers: 1 } }); // 仅 demands 变化
  await vm.runInContext('dhProbeTick()', ctx);
  const batch = batchGets[batchGets.length - 1] || [];
  assert.ok(batch.includes('/api/student/demands?scope=mine'), 'demands 变化应批量重拉该键');
  assert.ok(!batch.includes('/api/teachers'), 'teachers 未变不应进批量');
  assert.equal(calls.filter(u => u === '/api/teachers').length, teachersN0, 'teachers 未变不应重拉');
  assert.equal(vm.runInContext(`dhPeek('/api/student/demands?scope=mine')`, ctx) !== null, true, '重拉后缓存更新');
});

test('dhProbeTick：探测失败保留基线，不误触发全量重拉', async () => {
  const { impl, calls, routes, batchGets } = makeFetch();
  routes.set('/api/student/demands?scope=mine', { demands: [] });
  routes.set('/api/data-version', { versions: { demands: 1 } });
  const ctx = makeCtx({ fetchImpl: impl });
  vm.runInContext('CONFIG.DH_TTL_MS = 600000;', ctx);
  await vm.runInContext(`dhGet('/api/student/demands?scope=mine', { domain: 'demands' })`, ctx);
  await vm.runInContext('dhProbeTick()', ctx); // 基线 {demands:1}
  const demandsN0 = calls.filter(u => u === '/api/student/demands?scope=mine').length;

  routes.set('/api/data-version', new Error('探测断线'));
  await vm.runInContext('dhProbeTick()', ctx); // 失败静默，不抛
  assert.equal(calls.filter(u => u === '/api/batch').length, 0, '探测失败不批量重拉');
  assert.equal(calls.filter(u => u === '/api/student/demands?scope=mine').length, demandsN0, '探测失败不重拉');

  routes.set('/api/data-version', { versions: { demands: 2 } }); // 恢复后对比基线
  await vm.runInContext('dhProbeTick()', ctx);
  assert.equal(calls.filter(u => u === '/api/batch').length, 1, '基线保留，变化仍能检出（批量）');
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

test('dhProbeTick：域刷新失败保留旧基线，下轮重试（审计 m5，批量）', async () => {
  const { impl, calls, routes, batchGets } = makeFetch();
  routes.set('/api/student/demands?scope=mine', { demands: [{ id: 1 }] });
  routes.set('/api/data-version', { versions: { demands: 1 } });
  const ctx = makeCtx({ fetchImpl: impl });
  vm.runInContext('CONFIG.DH_TTL_MS = 600000;', ctx);
  await vm.runInContext(`dhGet('/api/student/demands?scope=mine', { domain: 'demands' })`, ctx);
  await vm.runInContext('dhProbeTick()', ctx); // 基线 {demands:1}

  routes.set('/api/data-version', { versions: { demands: 2 } });
  routes.set('/api/student/demands?scope=mine', new Error('刷新失败')); // 域刷新失败
  await vm.runInContext('dhProbeTick()', ctx);
  routes.set('/api/student/demands?scope=mine', { demands: [{ id: 1 }] }); // 恢复
  await vm.runInContext('dhProbeTick()', ctx);
  assert.equal(calls.filter(u => u === '/api/batch').length, 2,
    '失败那轮后基线保留，恢复后仍会重拉一次（批量）');
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

test('T6 发版重预取：版本变化清缓存后进客户端 dhPrefetch 立即一次批量重灌（F7/F3）', async () => {
  const store = new Map();
  const { impl, calls, routes, batchGets } = makeFetch();
  routes.set('/api/teachers', { teachers: [{ id: 1 }] });
  routes.set('/api/contracts/my', { contracts: [] });
  const ctx = makeCtx({ fetchImpl: impl });
  ctx.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
  vm.runInContext('CONFIG.DH_TTL_MS = 600000;', ctx);
  // boot：进客户端前已预取（旧版本数据在缓存里）
  await vm.runInContext(`dhGet('/api/teachers', { domain: 'teachers' })`, ctx);
  assert.notEqual(vm.runInContext(`dhPeek('/api/teachers')`, ctx), null, '旧版本缓存有数据');
  calls.length = 0; batchGets.length = 0;
  // 发版：boot 期版本探针检测到版本变化 → 强清缓存 + 覆写版本号
  vm.runInContext(`localStorage.setItem(DH_VERSION_KEY, '0.0.0')`, ctx);
  vm.runInContext('dhCheckAppVersion()', ctx);
  assert.equal(vm.runInContext(`dhPeek('/api/teachers')`, ctx), null, '版本变化缓存全清');
  // 进客户端（enterClient 内 dhPrefetch(role)）：一次批量重灌全部预取键
  const r = await vm.runInContext('dhPrefetch("student")', ctx);
  assert.equal(calls.filter(u => u === '/api/batch').length, 1, '发版后进客户端 = 1 次批量，无串行瀑布');
  assert.notEqual(vm.runInContext(`dhPeek('/api/teachers')`, ctx), null, '批量重灌后教师缓存就绪');
  assert.notEqual(vm.runInContext(`dhPeek('/api/contracts/my')`, ctx), null, '批量重灌后合同缓存就绪');
  assert.equal(calls.filter(u => u === '/api/teachers').length, 0, '子请求不打网（全走批量）');
  assert.equal(Object.prototype.toString.call(r), '[object Map]', '返回 Map');
});

test('dhProbeTick：getVersions 全域补零后首写 0→1 触发重拉（审计 m1，批量）', async () => {
  const { impl, calls, routes, batchGets } = makeFetch();
  routes.set('/api/teachers', { teachers: [] });
  routes.set('/api/data-version', { versions: { demands: 0, teachers: 0 } });
  const ctx = makeCtx({ fetchImpl: impl });
  vm.runInContext('CONFIG.DH_TTL_MS = 600000;', ctx);
  await vm.runInContext(`dhGet('/api/teachers', { domain: 'teachers' })`, ctx);
  await vm.runInContext('dhProbeTick()', ctx); // 基线 {teachers:0}
  routes.set('/api/data-version', { versions: { demands: 0, teachers: 1 } }); // 全站首条教师相关写
  await vm.runInContext('dhProbeTick()', ctx);
  assert.equal(calls.filter(u => u === '/api/batch').length, 1, '0→1 应批量重拉');
  assert.ok((batchGets[batchGets.length - 1] || []).includes('/api/teachers'), '0→1 批量应含 teachers');
});

// B6（用户反馈「后台静默加载无效：挂机十分钟后点模块仍现场拉表单，且拉取要 8 秒」）：
// 根因 = DH_TTL_MS 60s 保底 TTL——挂机期间预取数据过期，进模块缓存 miss 现场拉。
// 修复 = 版本探测成功后续期全缓存（dhTouchAll）：数据版本一致则缓存长期有效，进任何模块秒开；
// 探测停摆/失败时保留 TTL 兜底防陈旧。
// 注：dhPeek 在 TTL 过期时主动删除缓存条目（防陈旧读取），所以「续期验证」不能先调 dhPeek——
// 用 dhGet 的请求计数验证（续期成功 = 进模块 dhGet 命中缓存零请求，即用户「点模块秒开」的实测语义）
test('B6 dhProbeTick：探测成功全缓存续期——TTL 过期后进模块零请求（不现场拉）', async () => {
  const { impl, calls, routes } = makeFetch();
  routes.set('/api/teachers', { teachers: [{ user_id: 1 }] });
  routes.set('/api/data-version', { versions: { teachers: 1 } });
  const ctx = makeCtx({ fetchImpl: impl });
  vm.runInContext('CONFIG.DH_TTL_MS = 50;', ctx); // 极短 TTL 模拟挂机超时
  await vm.runInContext(`dhGet('/api/teachers', { domain: 'teachers' })`, ctx);
  await new Promise(r => setTimeout(r, 80)); // TTL 过期（条目仍在缓存，fetchedAt 旧）
  const n0 = calls.filter(u => u === '/api/teachers').length;
  await vm.runInContext('dhProbeTick()', ctx); // 挂机恢复：探测成功（数据版本未变）→ 续期
  const data = await vm.runInContext(`dhGet('/api/teachers', { domain: 'teachers' })`, ctx);
  assert.ok(Array.isArray(data.teachers), '续期后 dhGet 命中缓存返回数据');
  assert.equal(calls.filter(u => u === '/api/teachers').length, n0, '续期后进模块零请求（缓存命中，不现场拉表单）');
});

test('B6 探测失败不续期：TTL 过期后 dhGet 现场拉（防陈旧兜底仍在）', async () => {
  const { impl, calls, routes } = makeFetch();
  routes.set('/api/teachers', { teachers: [{ user_id: 1 }] });
  routes.set('/api/data-version', { versions: { teachers: 1 } });
  const ctx = makeCtx({ fetchImpl: impl });
  vm.runInContext('CONFIG.DH_TTL_MS = 50;', ctx);
  await vm.runInContext(`dhGet('/api/teachers', { domain: 'teachers' })`, ctx);
  await new Promise(r => setTimeout(r, 80)); // TTL 过期
  const n0 = calls.filter(u => u === '/api/teachers').length;
  routes.set('/api/data-version', new Error('探测断线'));
  await vm.runInContext('dhProbeTick()', ctx); // 失败静默（不续期）
  await vm.runInContext(`dhGet('/api/teachers', { domain: 'teachers' })`, ctx);
  assert.equal(calls.filter(u => u === '/api/teachers').length, n0 + 1, '探测失败不续期，进模块现场拉（TTL 兜底）');
});

test('B6 DH_PREFETCH：设置页四表单并入预取（account 域，登录即后台拉取）', () => {
  const { impl } = makeFetch();
  const ctx = makeCtx({ fetchImpl: impl });
  const prefetch = vm.runInContext('DH_PREFETCH', ctx);
  const eps = ['/api/auth/sessions', '/api/privacy-settings', '/api/user/username/status', '/api/user/creds'];
  for (const role of ['student', 'teacher', 'admin']) {
    const keys = prefetch[role].map(([e]) => e);
    for (const ep of eps) assert.ok(keys.includes(ep), `${role} 预取清单应含 ${ep}`);
    assert.equal(prefetch[role].filter(([, d]) => d === 'account').length, 4, `${role} account 域端点 4 个`);
  }
});

test('F5 乐观写辅助：dhApply 就地改缓存、dhRevert 失败恢复、dhSnapshot 快照', async () => {
  const { impl, routes } = makeFetch();
  routes.set('/api/student/demands?scope=mine', { demands: [{ id: 1, status: 'open' }] });
  const ctx = makeCtx({ fetchImpl: impl });
  vm.runInContext('CONFIG.DH_TTL_MS = 600000;', ctx);
  await vm.runInContext(`dhGet('/api/student/demands?scope=mine', { domain: 'demands' })`, ctx);
  // 整段在 vm 内执行（快照/应用/回滚共用同一 vm-realm 的 Map，避免跨 realm 引用）
  const results = vm.runInContext(`
    const snap = dhSnapshot(['/api/student/demands?scope=mine']);
    dhApply('/api/student/demands?scope=mine', d => ({ ...d, demands: d.demands.filter(x => x.id !== 1) }));
    const afterApply = dhPeek('/api/student/demands?scope=mine').demands.length;
    dhRevert('/api/student/demands?scope=mine', snap);
    const afterRevert = dhPeek('/api/student/demands?scope=mine').demands.length;
    // 乐观新增场景：条目不存在 → dhApply 跳过、dhRevert 原样无
    const snap2 = dhSnapshot(['/api/notifications']);
    dhApply('/api/notifications', d => ({ notifications: [] }));
    dhRevert('/api/notifications', snap2);
    ({ afterApply, afterRevert, afterNew: dhPeek('/api/notifications') === null });
  `, ctx);
  assert.equal(results.afterApply, 0, '乐观删除即时生效');
  assert.equal(results.afterRevert, 1, '失败回滚恢复原数据');
  assert.equal(results.afterNew, true, '原无条目回滚后仍无');
});
