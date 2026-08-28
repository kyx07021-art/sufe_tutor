/**
 * LOW-1 守护：health/keepalive 探活端点豁免 rateGate。
 * 审计：_worker.js 对全部 /api/ 路径过 rateGate（global 300/min/IP 共享桶）——独立保活
 * Worker 的 /api/keepalive 与发版脚本的 /api/health 探活与该 IP 的用户流量共用一个桶：
 * ① 探活可能被 429（部署/保活假失败）；② 高频探活挤占桶预算会确定性误伤同 IP 真实用户。
 * 修复：_worker.js 定义 PROBE_PATHS（/api/health、/api/keepalive），rateGate 调用前跳过。
 * 变异：删掉 `!PROBE_PATHS.has(p)` 短路 → 探活 IP 桶耗尽后 /api/health 429 → 红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import { rateGate } from '../src/server/core/security.js';
import worker from '../_worker.js';

function makeShim(raw) {
  return {
    prepare(sql) {
      const st = { _sql: sql, _params: [], bind(...p) { st._params = p; return st; },
        all(...p) { return { results: raw.prepare(st._sql).all(...(p.length ? p : st._params)) }; },
        first(...p) { return raw.prepare(st._sql).get(...(p.length ? p : st._params)) ?? undefined; },
        run(...p) { const info = raw.prepare(st._sql).run(...(p.length ? p : st._params)); return { meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } }; } };
      return st;
    },
    batch(stmts) {
      raw.exec('BEGIN');
      try {
        const out = [];
        for (const s of stmts) {
          if (/^\s*(SELECT|PRAGMA|WITH|EXPLAIN)/i.test(s._sql)) out.push({ results: raw.prepare(s._sql).all(...s._params) });
          else { const info = raw.prepare(s._sql).run(...s._params); out.push({ meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } }); }
        }
        raw.exec('COMMIT');
        return out;
      } catch (e) { try { raw.exec('ROLLBACK'); } catch { /* ignore */ } throw e; }
    },
  };
}
const mockAssets = () => ({ async fetch() { return new Response('Not Found', { status: 404 }); } });
const ctx = { waitUntil: async fn => { const r = typeof fn === 'function' ? fn() : fn; if (r && typeof r.then === 'function') await r; } };

test('PA-2f LOW-1：探活端点豁免限流（桶耗尽仍 200），普通路径照常 429', async (t) => {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  const shim = makeShim(raw);
  const env = { ASSETS: mockAssets(), DB: shim, LOG_DB: shim, LEDGER_DB: shim, ADMIN_USERNAMES: ['admin_sufe'], ADMIN_DEFAULT_PASSWORD: 'test-pw-123' };
  t.after(() => { try { raw.close(); } catch { /* 已关 */ } });
  await initDb(shim, env);

  const probeIp = 'probe-ip-a';
  // 直接调 rateGate 填满该 IP 的 global 桶（worker.fetch 共享同一模块内存 RL + D1 双桶）。
  // 用 GET 填充：POST 会先撞 write 桶（60/min）在 global 300 之前停循环（写桶耗尽 ≠ global 耗尽，
  // 之后 GET 普通路径仍放行）。GET /api/posts 只 bump global 桶。
  let blocked = false;
  for (let i = 0; i < 400 && !blocked; i++) {
    blocked = !(await rateGate(probeIp, '/api/posts', 'GET', null, Date.now(), shim));
  }
  assert.ok(blocked, '探活 IP 限流桶已填满（global 300 超限）');

  // 探活端点：桶耗尽仍 200（变异：删 PROBE_PATHS 短路 → 429 → 红）
  const health = await worker.fetch(new Request('https://test.local/api/health', {
    headers: { 'CF-Connecting-IP': probeIp },
  }), env, ctx);
  assert.equal(health.status, 200, 'health 探活不被限流（桶耗尽仍 200）');

  const keepalive = await worker.fetch(new Request('https://test.local/api/keepalive', {
    headers: { 'CF-Connecting-IP': probeIp },
  }), env, ctx);
  assert.equal(keepalive.status, 200, 'keepalive 探活不被限流（桶耗尽仍 200）');

  // 普通路径：同 IP 照常 429——豁免只覆盖探活端点，不误伤限流本身
  const posts = await worker.fetch(new Request('https://test.local/api/posts', {
    headers: { 'CF-Connecting-IP': probeIp },
  }), env, ctx);
  assert.equal(posts.status, 429, '普通 /api/ 路径对耗尽 IP 仍 429（不过度豁免）');

  // 干净 IP：普通路径不受影响（不被探活豁免连带放行）
  const fresh = await worker.fetch(new Request('https://test.local/api/posts', {
    headers: { 'CF-Connecting-IP': 'fresh-ip-b' },
  }), env, ctx);
  assert.notEqual(fresh.status, 429, '干净 IP 普通路径不被限流（无连带误伤）');
});
