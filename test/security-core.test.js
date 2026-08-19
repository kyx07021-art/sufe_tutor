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
import { rateGate, authRateBatch, authUser, corsPreflight, applySecurityHeaders } from '../src/server/core/security.js';
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
  // 超限累积 ≥ strike.count（3 次）：check 是软限不记三振（:174 超限 return false 无 rlStrike）
  for (let i = 0; i < RATE_LIMITS.strike.count; i++) {
    assert.equal(await rateGate(ip, '/api/auth/check', 'GET', {}, NOW, stubDb), false, `超限第 ${i + 1} 次拒绝`);
  }
  // 关键锁定：若 check 误记三振，3 次已触发封禁（:168 blocked）→ 同 ip 其他路径 GET 也被拒；软限下应放行
  assert.equal(await rateGate(ip, '/api/posts', 'GET', {}, NOW, stubDb), true, '软限不三振——同 ip 其他路径不受封禁影响');
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
  // 认证路径在 rateGate 内提前 return true（:170，写闸 w:ip 零消费）；循环数须 > write.limit，
  // 否则若回归使 login 改走写闸（删 :170 提前 return），超写限前的放行无法观测差异
  for (let i = 0; i < RATE_LIMITS.write.limit + 5; i++) {
    assert.equal(await rateGate(ip, '/api/auth/login', 'POST', {}, NOW, stubDb), true,
      `第 ${i + 1} 次 login 直放（${RATE_LIMITS.write.limit + 5} 次 > 写闸 ${RATE_LIMITS.write.limit}，写闸被消费则此处必 429）`);
  }
});

test('authRateBatch.verdict：block 行 / 认证超限 命中即拒，写超限不再拒（Q-2a-F2），未超限放行', () => {
  const gate = authRateBatch(stubDbChain, uniqIp('batch'), 'login');
  // Q-2a-F2 回滚重做：删 wSel 死 SELECT 后基础语句 = [block, wUp, aUp, aSel]，aN 移到 index 3
  const results = (block, wN, aN) => [
    { results: block ? [{}] : [] },
    { results: [] }, // wUp（保留 upsert 维护写桶计数，verdict 不读）
    { results: [] }, // aUp
    { results: [{ n: aN }] },
  ];
  // verdict 返回 0/1（truthy/falsy），用 assert.ok/equal 判
  assert.ok(!gate.verdict(results(false, 1, 1)), '未超限放行');
  assert.ok(gate.verdict(results(true, 1, 1)), 'block 行存在 → 拒');
  // Q-2a-F2: 认证路径不再判写桶 w:ip——写超限不再拒（活跃用户写满不被误伤 429+三振），认证限流由 authKey 独立桶承担
  assert.ok(!gate.verdict(results(false, RATE_LIMITS.write.limit + 1, 1)), '写超限不再拒（认证桶独立）');
  assert.ok(gate.verdict(results(false, 1, RATE_LIMITS.login.limit + 1)), '认证（login）超限 → 拒');
  // 边界：恰在 limit 内放行
  assert.ok(!gate.verdict(results(false, RATE_LIMITS.write.limit, RATE_LIMITS.login.limit)), '恰在 limit 内放行');
});

test('rateGate：OTP 请求专用 per-IP 桶（Q-2a-F3）——10/min 放行后第 11 次 429，换 IP 不受牵连', async () => {
  const ip = uniqIp('otp');
  // OTP 请求先过全局桶 + 写闸（POST，w:ip 计数 < 60 不触发）再过 otp 桶；stubDb 抛错降级内存判定
  for (let i = 0; i < RATE_LIMITS.otp.limit; i++) {
    assert.equal(await rateGate(ip, '/api/auth/otp/request', 'POST', {}, NOW, stubDb), true, `第 ${i + 1} 次放行`);
  }
  assert.equal(await rateGate(ip, '/api/auth/otp/request', 'POST', {}, NOW, stubDb), false, '第 11 次（> otp.limit 10）拒绝');
  // 关键锁定：桶键是 o:${ip}（专用），其他 IP 不受该桶牵连
  assert.equal(await rateGate(uniqIp('otp-other'), '/api/auth/otp/request', 'POST', {}, NOW, stubDb), true, '其他 IP 的 OTP 请求不受影响');
});

test('authUser：注销账户残留会话（deactivated=1, banned=0）令牌路径拒绝（Q-2a-F6）', async () => {
  // Q-2a-F6 守护：dbDeactivateUser 恒同步写 banned=1+deactivated=1，常态由 banned 判定覆盖；
  // 本用例锁「半程注销/异常状态 deactivated=1,banned=0」——删 deactivated 判定则该用户被放行（变异必红）。
  const mkDb = user => ({ prepare() { return { bind() { return { first: async () => user, all: async () => ({ results: [] }) }; } }; } });
  const req = { headers: { get: h => (h === 'X-Auth-Token' ? 'token-deactivated-user' : null) } };
  assert.equal(await authUser(mkDb({ id: 1, username: 'u', role: 'student', avatar: '', banned: 0, deactivated: 1, token_expires: '2099-01-01 00:00:00' }), req), null, 'deactivated=1,banned=0 残留会话 → 拒绝');
  const req2 = { headers: { get: h => (h === 'X-Auth-Token' ? 'token-normal-user' : null) } };
  const u2 = await authUser(mkDb({ id: 2, username: 'u2', role: 'student', avatar: '', banned: 0, deactivated: 0, token_expires: '2099-01-01 00:00:00' }), req2);
  assert.equal(u2 && u2.id, 2, '正常用户仍放行');
});
