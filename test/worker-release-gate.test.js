/**
 * S0-10: Release Gate worker wiring integration test (server/startup.js x _worker.js)
 *
 * In production runtime (CF_PAGES_URL production signal) with required Secrets missing:
 *   - /api/health returns 503 + checks array exposed (per-item locatable, no secret value leak);
 *   - non-health /api/* returns 503 not-ready (mutation: remove the _worker.js gate wiring ->
 *     that path is no longer 503-not-ready -> red; this assertion locks the wiring itself);
 *   - static assets still served (mutation: gate wrongly blocks static path -> red; this
 *     assertion locks the gate's /api-only path scoping).
 *
 * Note productionReady is computed once per isolate (env immutable, no self-heal), so this file
 * only exercises the not-ready state; the ready state is locked at unit level by
 * startup-gate.test.js (all secrets present + admin rotated + manual provider -> ready).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import worker from '../_worker.js';

const REPO = fileURLToPath(new URL('../', import.meta.url));

// Minimal ASSETS stub: every path returns index.html (only needed for the "static still served" branch)
function mockAssets() {
  return {
    async fetch() {
      const html = readFileSync(REPO + 'web/index.html');
      return new Response(html, {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'max-age=0, must-revalidate',
          'content-length': String(html.byteLength),
        },
      });
    },
  };
}

// Production runtime signal + all required Secrets missing (fail-closed scenario)
const PROD_ENV_MISSING = { CF_PAGES_URL: 'https://jingshi-zhitu.pages.dev', ASSETS: mockAssets() };
const ctx = { waitUntil: fn => (typeof fn === 'function' ? fn() : fn) };
const get = (p, env = PROD_ENV_MISSING) => worker.fetch(new Request('https://test.local' + p), env, ctx);

test('S0-10：生产缺必需 Secret → /api/health 503 + checks 暴露（逐项可定位）', async () => {
  const res = await get('/api/health');
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.status, 'not-ready');
  assert.equal(body.ready, false);
  assert.ok(Array.isArray(body.checks) && body.checks.length > 0, 'checks 数组暴露');
  assert.ok(body.timestamp, '时间戳暴露');
  // With all Secrets missing every key/credential check must be flagged (mutation: drop any key check -> red)
  const failCodes = new Set(body.checks.filter(c => !c.pass).map(c => c.code));
  for (const code of ['LOG_ENCRYPT_KEY', 'FIELD_ENC_KEY', 'SMS_OTP_TEMPLATE_CODE', 'EMAIL_OTP_TEMPLATE_CODE', 'TEXT_AUDIT_API_KEY', 'ADMIN_CREDENTIAL_ROTATED', 'ADMIN_USERNAMES', 'CRYPTO_ROTATION_READY']) {
    assert.ok(failCodes.has(code), `缺 Secret 应标记 ${code}`);
  }
});

test('S0-10：生产缺必需 Secret → 非 health API 一律 503 not-ready（变异：删网关接线 → 红）', async () => {
  const res = await get('/api/auth/check');
  assert.equal(res.status, 503, '网关短路发生在路由分发之前');
  const body = await res.json();
  assert.equal(body.status, 'not-ready');
});

test('S0-10：生产缺必需 Secret → 静态资源照常服务（变异：gate 误拦静态路径 → 红）', async () => {
  const res = await get('/');
  assert.equal(res.status, 200, '静态首页不被 Release Gate 拦截');
  const html = await res.text();
  assert.ok(html.includes('type="module"'), 'HTML 文档正常服务并改写引用');
});

test('S0-10：not-ready 应答不泄露 env（只暴露已知 check code 白名单；变异：dump env → 红）', async () => {
  const res = await get('/api/health');
  const text = await res.text();
  // Only check codes (design identifiers) may be exposed; no env value may appear (the prod site URL is in env but must not show)
  assert.ok(!text.includes('jingshi-zhitu.pages.dev'), '不泄露生产站点 URL');
  // Check-code whitelist lock: a new code must be added explicitly, preventing the response from carrying env keys/values
  const body = JSON.parse(text);
  const known = new Set([
    'LOG_ENCRYPT_KEY', 'FIELD_ENC_KEY', 'SMS_OTP_TEMPLATE_CODE', 'EMAIL_OTP_TEMPLATE_CODE',
    'TEXT_AUDIT_API_KEY', 'ADMIN_CREDENTIAL_ROTATED', 'ADMIN_USERNAMES', 'CHSI_PROVIDER_MANUAL',
    'CRYPTO_ROTATION_READY', 'INVITE_GATE_CONSISTENT',
  ]);
  for (const c of body.checks) {
    assert.ok(known.has(c.code), `未知 check code ${c.code}`);
    assert.deepEqual(Object.keys(c).sort(), ['code', 'pass'], 'check 对象只含 code/pass，不带值');
  }
});
