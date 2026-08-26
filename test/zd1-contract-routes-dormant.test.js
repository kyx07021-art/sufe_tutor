/**
 * ZD-1（2026-08-26 休眠签约）：服务端 contract 域路由停用守护测试。
 * 语义 = contract 域 12 条路由（/api/contracts 7 + admin contracts 2 + conversations/signing +
 * bindable-demands + signing-requests/respond）从 app.js 路由表移除 → 全部 404（ROUTE_NOT_FOUND）。
 * 恢复 = 还原 app.js `...contractRoutes` spread 并同步本测试（12 路径重新命中）与 v1-5-route-contract 路由数。
 *
 * G2 变异守护：还原 app.js `// ...contractRoutes,` 为 `...contractRoutes,` → 本文件「路由表零残留」断言必红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routes } from '../src/server/app.js';
import { routeApi } from '../_worker.js';

const DORMANT_PATHS = [
  ['POST', '/api/contracts'],
  ['GET', '/api/contracts/my'],
  ['POST', '/api/contracts/1/sign'],
  ['GET', '/api/contracts/1/verify'],
  ['POST', '/api/contracts/1/revoke'],
  ['PUT', '/api/contracts/1'],
  ['DELETE', '/api/contracts/1'],
  ['GET', '/api/admin/contracts'],
  ['DELETE', '/api/admin/contracts/1'],
  ['POST', '/api/conversations/1/signing'],
  ['GET', '/api/conversations/1/bindable-demands'],
  ['POST', '/api/signing-requests/1/respond'],
];

const headers = new Headers({ 'Content-Type': 'application/json' });

test('ZD-1 contract 12 路由已从路由表移除（休眠，零残留）', () => {
  const found = routes.filter(r => /contract|signing|bindable/.test(r.path));
  assert.equal(found.length, 0, `路由表应零 contract/signing/bindable 残留（实测 ${found.length} 条：${found.map(r => r.path).join(', ')}）`);
});

test('ZD-1 routeApi 分发 12 端点全 404（ROUTE_NOT_FOUND）', async () => {
  for (const [method, path] of DORMANT_PATHS) {
    const r = await routeApi(null, path, method, null, new URL(`http://x${path}`), { headers }, {});
    assert.equal(r.status, 404, `${method} ${path} 应 404（实测 status=${r.status}）`);
    const body = JSON.parse(await r.text());
    assert.equal(body.code, 'ROUTE_NOT_FOUND', `${method} ${path} 404 码应为 ROUTE_NOT_FOUND`);
  }
});
