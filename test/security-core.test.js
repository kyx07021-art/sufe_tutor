/**
 * Z-13-F4：security.js 咽喉直接单测——网安咽喉（规则 48 身份/门禁、限流双路径、安全头）是
 * 全站安全承重面，此前仅经路由集成间接覆盖。本测试直测：corsPreflight 头精确值 /
 * applySecurityHeaders 作用域 / rateGate 内存限流（check 探测软限、写路径三振封禁、窗口滚动恢复）/
 * authRateBatch verdict 判定（block 行、写超限、认证超限）。
 *
 * 隔离策略：rateGate 内存态是模块级 Map，测试用唯一 ip（Date.now 后缀）防跨用例污染；
 * stub db 的 prepare/batch 抛错 → rlDual/maybeCleanRateLimits 的 catch 降级路径被走（内存判定生效）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rateGate, authRateBatch, corsPreflight, applySecurityHeaders } from '../src/server/core/security.js';
import { RATE_LIMITS, CORS_HEADERS, SECURITY_HEADERS } from '../src/shared/config.js';

// stub db A：prepare/batch 抛错 → 各限流 D1 路径 catch 降级内存（rateGate 测试只判内存闸语义）
const stubDb = { prepare() { throw new Error('no db'); }, batch() { throw new Error('no db'); } };
// stub db B：prepare 链式可 bind（authRateBatch 构造时只建 stmts 不执行）
const stubDbChain = { prepare() { return { bind() { return {}; } }; }, batch() { throw new Error('no db'); } };
const NOW = 1_800_000_000_000;
const uniqIp = tag => `z13-${tag}-${Date.now()}`;

test('corsPreflight：返回带 CORS_HEADERS 的预检响应（头单源精确值）', () => {
  const r = corsPreflight();
  assert.equal(r.status, 200, '预检 200');
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    assert.equal(r.headers.get(k), v, `CORS 头 ${k} 精确匹配单源`);
  }
});

test('applySecurityHeaders：仅 /api/* 加安全头 + no-store，静态路径不碰', () => {
  const api = new Response('ok', { status: 200 });
  applySecurityHeaders(api, '/api/posts');
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    assert.equal(api.headers.get(k), v, `安全头 ${k} 落位`);
  }
  assert.equal(api.headers.get('Cache-Control'), 'no-store', 'API 不缓存');
  const stat = new Response('css', { status: 200 });
  const out = applySecurityHeaders(stat, '/base.css');
  assert.equal(out, stat, '静态路径原样返回');
  assert.equal(stat.headers.get('Cache-Control'), null, '静态路径不注入 no-store（由 _headers 承担）');
});

test('rateGate：auth/check 探测软限（窗口内 limit 次放行，超限 429，窗口滚动恢复；软限不三振）', async () => {
  const ip = uniqIp('check');
  for (let i = 0; i < RATE_LIMITS.check.limit; i++) {
    assert.equal(await rateGate(ip, '/api/auth/check', 'GET', {}, NOW, stubDb), true, `第 ${i + 1} 次放行`);
  }
  assert.equal(await rateGate(ip, '/api/auth/check', 'GET', {}, NOW, stubDb), false, '超限即拒（check 为软限不记三振）');
  assert.equal(await rateGate(ip, '/api/auth/check', 'GET', {}, NOW, stubDb), false, '持续拒绝');
  // 窗口滚动（+windowMs+1s 严格大于 reset）后过期 → 放行
  assert.equal(await rateGate(ip, '/api/auth/check', 'GET', {}, NOW + RATE_LIMITS.check.windowMs + 1000, stubDb), true, '窗口重置后放行');
});

test('rateGate：写路径超限 → 内存三振封禁（strike×3 → blocked 全局拒绝）', async () => {
  const ip = uniqIp('write');
  for (let i = 0; i < RATE_LIMITS.write.limit; i++) {
    assert.equal(await rateGate(ip, '/api/posts', 'POST', {}, NOW, stubDb), true, `窗口内第 ${i + 1} 次写放行`);
  }
  // 超限后每次 return false 触发 rlStrike；3 次满 strike.count → blocked
  assert.equal(await rateGate(ip, '/api/posts', 'POST', {}, NOW, stubDb), false, '超限拒绝（strike 1）');
  assert.equal(await rateGate(ip, '/api/posts', 'POST', {}, NOW, stubDb), false, 'strike 2');
  assert.equal(await rateGate(ip, '/api/posts', 'POST', {}, NOW, stubDb), false, 'strike 3 → blocked');
  assert.equal(await rateGate(ip, '/api/other', 'GET', {}, NOW, stubDb), false, '封禁后全路径拒绝');
  assert.equal(await rateGate(ip, '/api/other', 'GET', {}, NOW + RATE_LIMITS.block.windowMs + 1, stubDb), true, '封禁窗口过期后放行');
});

test('rateGate：登录/注册/重认证路径不占写闸（认证限流由 authRateBatch 路由批承担）', async () => {
  const ip = uniqIp('auth');
  // 认证路径在 rateGate 内提前 return true（:170），但全局 g:ip 仍计数；多调几次验证不触写限流
  for (let i = 0; i < 10; i++) {
    assert.equal(await rateGate(ip, '/api/auth/login', 'POST', {}, NOW, stubDb), true, 'login 直放（写闸不消费）');
  }
});

test('authRateBatch.verdict：block 行 / 写超限 / 认证超限 任一命中即拒，未超限放行', () => {
  const gate = authRateBatch(stubDbChain, uniqIp('batch'), 'login');
  const results = (block, wN, aN) => [
    { results: block ? [{}] : [] },
    { results: [] },
    { results: [{ n: wN }] },
    { results: [] },
    { results: [{ n: aN }] },
  ];
  // verdict 返回 0/1（truthy/falsy），用 assert.ok/equal 判
  assert.ok(!gate.verdict(results(false, 1, 1)), '未超限放行');
  assert.ok(gate.verdict(results(true, 1, 1)), 'block 行存在 → 拒');
  assert.ok(gate.verdict(results(false, RATE_LIMITS.write.limit + 1, 1)), '写超限 → 拒');
  assert.ok(gate.verdict(results(false, 1, RATE_LIMITS.login.limit + 1)), '认证（login）超限 → 拒');
  // 边界：恰在 limit 内放行
  assert.ok(!gate.verdict(results(false, RATE_LIMITS.write.limit, RATE_LIMITS.login.limit)), '恰在 limit 内放行');
});
