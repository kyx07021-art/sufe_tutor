/**
 * Q-2a-L5 守护：限流闸门先于 parseBody（DoS 放大消除）。
 * 审计：_worker.js parseBody 先于 rateGate——1.1MB body 在限流判定前被完整读入解析，限流拒绝不省成本。
 * 修复：rateGate 前置（不消费 body，参数预留）。
 * 变异：调回 parseBody 先于 rateGate → 超限大 body 返回 413 而非 429 → 红。
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
const ENV = { ADMIN_USERNAMES: ['admin_sufe'], ADMIN_DEFAULT_PASSWORD: 'test-pw-123' };

test('Q-2a-L5：限流超限请求优先 429（大 body 不被 parseBody 先读），未超限大 body 413', async (t) => {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  const shim = makeShim(raw);
  const env = { ASSETS: mockAssets(), DB: shim, LOG_DB: shim, LEDGER_DB: shim, ADMIN_USERNAMES: ENV.ADMIN_USERNAMES, ADMIN_DEFAULT_PASSWORD: ENV.ADMIN_DEFAULT_PASSWORD };
  t.after(() => { try { raw.close(); } catch { /* 已关 */ } });
  await initDb(shim, env);

  const ip = 'l5-ip-a';
  // 直接调 rateGate 填满限流桶（同模块实例内存 RL + D1 双桶，worker.fetch 共享）
  let blocked = false;
  for (let i = 0; i < 400 && !blocked; i++) {
    blocked = !(await rateGate(ip, '/api/posts', 'POST', null, Date.now(), shim));
  }
  assert.ok(blocked, '限流桶已填满（global 300 / write 60 均超）');

  const bigBody = JSON.stringify({ text: 'x'.repeat(1_200_000) }); // > BODY_LIMIT 1.1MB

  // 超限 ip + 大 body → rateGate 先拦 → 429（变异：parseBody 先 → 413 → 红）
  const res = await worker.fetch(new Request('https://test.local/api/posts', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'CF-Connecting-IP': ip },
    body: bigBody,
  }), env, ctx);
  assert.equal(res.status, 429, '限流超限优先 429，body 未被 parseBody 读取');

  // 对照：新 ip 未超限 → parseBody 体积闸门 413（顺序在后但大 body 仍被拦）
  const res2 = await worker.fetch(new Request('https://test.local/api/posts', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'CF-Connecting-IP': 'l5-ip-b' },
    body: bigBody,
  }), env, ctx);
  assert.equal(res2.status, 413, '未超限大 body → parseBody 413');
});
