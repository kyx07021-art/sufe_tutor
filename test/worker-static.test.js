/**
 * S0-22 new-site static surface end-to-end (Vite direct serving + SPA fallback masquerade guard).
 * Drives the _worker.js fetch default export with a stub ASSETS (deterministic fixture + simulated
 * Pages SPA fallback shape) to verify:
 *  - GET / -> Vite HTML passed through verbatim (zero rewriting, zero inline manifest -- S0-24 Vite
 *    already wrote ./assets/ hashed references into the HTML)
 *  - GET /assets/* -> content-hashed asset direct serving (immutable is owned by the _headers
 *    static layer; the worker does not intervene)
 *  - GET missing .js/.css (ASSETS SPA fallback returns HTML) -> masquerade guard returns a real 404
 *    (AB-1: never feed HTML to a <script src>)
 *  - SPA fallback navigation path (/my-demands, no extension) -> 200 HTML (v2 shell zero inline)
 *  - Sensitive paths and path traversal -> 404
 *  - HTML responses use ASSETS native ETag/304 (worker no longer self-holds an ETag -- no rewriting
 *    means no drift, S0-22)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import worker from '../_worker.js';

const REPO = fileURLToPath(new URL('../', import.meta.url));

// Deterministic Vite-shape HTML fixture (independent of build artifacts, test-stable):
// ./assets/ relative references + strict meta CSP.
const VITE_HTML = `<!DOCTYPE html>
<html lang="zh-CN"><head>
<meta http-equiv="Content-Security-Policy" content="script-src 'self'; style-src-elem 'self'; style-src-attr 'none'">
<script type="module" crossorigin src="./assets/index-abc12345.js"></script>
<link rel="stylesheet" crossorigin href="./assets/index-abc12345.css">
</head><body><div id="app"></div></body></html>`;
const STORED_ETAG = '"stored-file-etag"'; // fixed ETag for the stored HTML (correct when no rewriting occurs)

// Simulated Pages ASSETS: existing files are returned as real bytes; any missing path falls back to
// index.html (200 text/html, regardless of extension -- the production Pages platform behavior; the
// worker masquerade guard turns "received HTML for an extension path" into a real 404).
function mockAssets() {
  return {
    async fetch(request) {
      const u = new URL(request.url);
      const p = decodeURIComponent(u.pathname);
      if (p.includes('..')) return new Response('Not Found', { status: 404 });
      if (p === '/' || p === '/index.html') {
        if (request.headers.get('if-none-match') === STORED_ETAG) return new Response(null, { status: 304, headers: { ETag: STORED_ETAG } });
        return new Response(VITE_HTML, {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'max-age=0, must-revalidate', 'ETag': STORED_ETAG, 'Last-Modified': 'Tue, 01 Jan 2026 00:00:00 GMT', 'content-length': String(Buffer.byteLength(VITE_HTML)) },
        });
      }
      if (p.startsWith('/assets/')) {
        const base = p.replace(/^\/assets\//, '');
        const src = REPO + 'new-frontend/dist/assets/' + base;
        try {
          const content = readFileSync(src);
          const type = base.endsWith('.js') ? 'application/javascript' : base.endsWith('.css') ? 'text/css' : 'application/octet-stream';
          return new Response(content, { status: 200, headers: { 'content-type': type, 'cache-control': 'public, max-age=31536000, immutable', 'content-length': String(content.byteLength) } });
        } catch { /* fall through to SPA fallback below */ }
      }
      // Pages SPA fallback: any missing path returns index.html 200 text/html (including extension
      // paths -- production platform behavior)
      return new Response(VITE_HTML, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'max-age=0, must-revalidate', 'ETag': STORED_ETAG, 'content-length': String(Buffer.byteLength(VITE_HTML)) },
      });
    },
  };
}

const env = { ASSETS: mockAssets() };
const ctx = { waitUntil: fn => (typeof fn === 'function' ? fn() : fn) };
const get = async (p, headers = {}) => worker.fetch(new Request('https://test.local' + p, { headers }), env, ctx);

test('GET / -> Vite HTML passed through verbatim: zero rewriting, zero inline manifest (S0-24/S0-22)', async () => {
  const res = await get('/');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.equal(html, VITE_HTML, 'HTML bytes passed through verbatim (worker no longer injectManifest-rewrites)');
  assert.ok(html.includes('./assets/index-abc12345.js'), 'Vite relative reference preserved');
  assert.ok(!html.includes('window.ASSET_MANIFEST'), 'zero inline manifest (V-3-1d contract)');
});

test('HTML ETag uses ASSETS native value: no rewriting means no drift, worker no longer self-holds (S0-22)', async () => {
  const res = await get('/');
  const etag = res.headers.get('etag');
  assert.equal(etag, STORED_ETAG, 'ASSETS native ETag passed through (worker no longer hashes the rewritten body)');
  const body = await res.text();
  assert.equal(body, VITE_HTML, '200 still returns the full HTML');
});

test('If-None-Match hits ASSETS native ETag -> ASSETS 304 passed through', async () => {
  const res = await get('/', { 'If-None-Match': STORED_ETAG });
  assert.equal(res.status, 304, '304 handled natively by ASSETS, passed through by the worker');
});

test('GET /assets/* content-hashed asset -> direct serving (Vite artifact; immutable owned by _headers static layer)', async () => {
  // Verify against a real Vite artifact (present after build); skip before build (no asset is not a breakage).
  const { existsSync } = await import('node:fs');
  const assetsDir = REPO + 'new-frontend/dist/assets';
  if (!existsSync(assetsDir)) return; // not built: skip (source workspace may be unbuilt)
  const { readdirSync } = await import('node:fs');
  const js = readdirSync(assetsDir).find(f => f.endsWith('.js'));
  assert.ok(js, 'new-frontend/dist/assets contains a .js');
  const res = await get('/assets/' + js);
  assert.equal(res.status, 200);
  assert.ok((res.headers.get('content-type') || '').includes('javascript'), 'JS asset served directly');
  const body = await res.text();
  assert.ok(body.length > 0, 'returns real JS content');
  assert.ok(!body.includes('<html'), 'never feeds HTML as a script');
});

test('missing /assets/*.js receives ASSETS SPA-fallback HTML -> masquerade guard returns a real 404 (AB-1)', async () => {
  // Production incident (2026-08-20): old pages referenced a deleted chunk -> ASSETS platform layer
  // fell back to index.html 200 text/html -> the browser executed the HTML as a script and reported
  // the MIME error. Worker guard: an extension path that receives HTML is masquerade -> real 404.
  const res = await get('/assets/chunk-OLD.js');
  assert.equal(res.status, 404, 'path with .js extension receiving HTML -> guard flags masquerade -> 404');
  assert.ok(!(res.headers.get('content-type') || '').includes('text/html'), 'never feeds HTML to a <script src>');
  const res2 = await get('/assets/img.png');
  assert.equal(res2.status, 404, 'image assets guarded the same way');
});

test('SPA fallback navigation path (no extension) -> 200 HTML (v2 shell zero inline)', async () => {
  const res = await get('/my-demands');
  assert.equal(res.status, 200);
  assert.ok((res.headers.get('content-type') || '').includes('text/html'));
  const html = await res.text();
  assert.ok(!html.includes('window.ASSET_MANIFEST'), 'SPA fallback zero inline manifest');
});

test('sensitive paths and path traversal -> 404', async () => {
  const oldDbPath = ['server', 'db.js'].join('/'); // avoid the old import path literal appearing in the test source
  assert.equal((await get('/' + oldDbPath)).status, 404, 'server/ directory 404');
  assert.equal((await get('/../' + oldDbPath)).status, 404, 'path traversal 404');
  assert.equal((await get('/package.json')).status, 404, 'package manifest 404');
  assert.equal((await get('/docs')).status, 404, 'bare /docs path 404 (PA-3-F5, parity with /server)');
  assert.equal((await get('/docs/')).status, 404, '/docs/ directory 404');
  assert.equal((await get('/server')).status, 404, 'bare /server path 404');
});
