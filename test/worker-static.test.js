/**
 * Worker 静态面端到端：HTML 直通 + 内容哈希资产直通 + SPA 回退冒充守卫。
 * 用 stub ASSETS（确定性 fixture + 模拟 Pages SPA 回退形状）驱动 _worker.js fetch：
 *  - GET / -> HTML 原样直通（worker 零改写）
 *  - GET /assets/* -> 内容哈希资产直通（immutable 由 _headers 静态层承担，worker 不干预）
 *  - GET 缺失 .js/.css（ASSETS 回退返回 HTML）-> 冒充守卫返回真 404（绝不给 <script src> 喂 HTML）
 *  - SPA 回退导航路径（无扩展名）-> 200 HTML
 *  - 敏感路径与路径遍历 -> 404
 *  - HTML 走 ASSETS 原生 ETag/304（worker 不自持 ETag，无改写即无漂移）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import worker from '../_worker.js';

const REPO = fileURLToPath(new URL('../', import.meta.url));

// 旧客户端 HTML fixture（绝对 /assets/ 引用 + 严格 meta CSP；独立于构建产物，测试稳定）
const SHELL_HTML = `<!DOCTYPE html>
<html lang="zh-CN"><head>
<meta http-equiv="Content-Security-Policy" content="script-src 'self'; style-src-elem 'self'; style-src-attr 'none'">
<script src="/theme-init.js"></script>
<link rel="stylesheet" href="/tokens.css">
<script type="module" src="/assets/app-abc12345.js"></script>
</head><body><div id="app"></div></body></html>`;
const STORED_ETAG = '"stored-file-etag"'; // 存储 HTML 的固定 ETag（无改写时正确透传）

// 模拟 Pages ASSETS：存在的文件返回真实字节；缺失路径回退 index.html（200 text/html，与生产
// 平台行为一致，无论扩展名）——worker 冒充守卫把"扩展名路径收到 HTML"变成真 404。
function mockAssets() {
  return {
    async fetch(request) {
      const u = new URL(request.url);
      const p = decodeURIComponent(u.pathname);
      if (p.includes('..')) return new Response('Not Found', { status: 404 });
      if (p === '/' || p === '/index.html') {
        if (request.headers.get('if-none-match') === STORED_ETAG) return new Response(null, { status: 304, headers: { ETag: STORED_ETAG } });
        return new Response(SHELL_HTML, {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'max-age=0, must-revalidate', 'ETag': STORED_ETAG, 'Last-Modified': 'Tue, 01 Jan 2026 00:00:00 GMT', 'content-length': String(Buffer.byteLength(SHELL_HTML)) },
        });
      }
      if (p.startsWith('/assets/')) {
        const base = p.replace(/^\/assets\//, '');
        const src = REPO + 'dist/assets/' + base;
        try {
          const content = readFileSync(src);
          const type = base.endsWith('.js') ? 'application/javascript' : base.endsWith('.css') ? 'text/css' : 'application/octet-stream';
          return new Response(content, { status: 200, headers: { 'content-type': type, 'cache-control': 'public, max-age=31536000, immutable', 'content-length': String(content.byteLength) } });
        } catch { /* fall through to SPA fallback below */ }
      }
      // Pages SPA 回退：任何缺失路径返回 index.html 200 text/html（含扩展名路径——生产平台行为）
      return new Response(SHELL_HTML, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'max-age=0, must-revalidate', 'ETag': STORED_ETAG, 'content-length': String(Buffer.byteLength(SHELL_HTML)) },
      });
    },
  };
}

const env = { ASSETS: mockAssets() };
const ctx = { waitUntil: fn => (typeof fn === 'function' ? fn() : fn) };
const get = async (p, headers = {}) => worker.fetch(new Request('https://test.local' + p, { headers }), env, ctx);

test('GET / -> HTML 原样直通：worker 零改写、零内联 manifest', async () => {
  const res = await get('/');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.equal(html, SHELL_HTML, 'HTML bytes passed through verbatim (no worker rewriting)');
  assert.ok(html.includes('/assets/app-abc12345.js'), '绝对 /assets/ 引用保留');
  assert.ok(!html.includes('window.ASSET_MANIFEST'), '零内联 manifest');
});

test('HTML ETag 用 ASSETS 原生值：无改写即无漂移，worker 不自持', async () => {
  const res = await get('/');
  const etag = res.headers.get('etag');
  assert.equal(etag, STORED_ETAG, 'ASSETS 原生 ETag 透传');
  const body = await res.text();
  assert.equal(body, SHELL_HTML, '200 仍返回完整 HTML');
});

test('If-None-Match 命中 ASSETS 原生 ETag -> 304 透传', async () => {
  const res = await get('/', { 'If-None-Match': STORED_ETAG });
  assert.equal(res.status, 304, '304 由 ASSETS 原生处理，worker 透传');
});

test('GET /assets/* 内容哈希资产 -> 直通（esbuild 产物；immutable 由 _headers 承担）', async () => {
  // 对真实构建产物验证；未构建时跳过（无资产不算坏）
  const assetsDir = REPO + 'dist/assets';
  if (!existsSync(assetsDir)) return;
  const js = readdirSync(assetsDir).find(f => f.endsWith('.js'));
  assert.ok(js, 'dist/assets 包含 .js');
  const res = await get('/assets/' + js);
  assert.equal(res.status, 200);
  assert.ok((res.headers.get('content-type') || '').includes('javascript'), 'JS 资产直通');
  const body = await res.text();
  assert.ok(body.length > 0, '返回真实 JS 内容');
  assert.ok(!body.includes('<html'), '绝不给脚本喂 HTML');
});

test('缺失 /assets/*.js 收到 SPA 回退 HTML -> 冒充守卫返回真 404', async () => {
  // 生产事故形态：页面引用了已删 chunk -> ASSETS 平台回退 index.html 200 text/html -> 浏览器把
  // HTML 当脚本执行报 MIME 错。守卫：扩展名路径收到 HTML = 冒充 -> 真 404。
  const res = await get('/assets/chunk-OLD.js');
  assert.equal(res.status, 404, '.js 扩展名路径收到 HTML -> 守卫判冒充 -> 404');
  assert.ok(!(res.headers.get('content-type') || '').includes('text/html'), '绝不给 <script src> 喂 HTML');
  const res2 = await get('/assets/img.png');
  assert.equal(res2.status, 404, '图片资产同样守卫');
});

test('SPA 回退导航路径（无扩展名）-> 200 HTML', async () => {
  const res = await get('/my-demands');
  assert.equal(res.status, 200);
  assert.ok((res.headers.get('content-type') || '').includes('text/html'));
  const html = await res.text();
  assert.ok(!html.includes('window.ASSET_MANIFEST'), 'SPA 回退零内联 manifest');
});

test('敏感路径与路径遍历 -> 404', async () => {
  const oldDbPath = ['server', 'db.js'].join('/');
  assert.equal((await get('/' + oldDbPath)).status, 404, 'server/ 目录 404');
  assert.equal((await get('/../' + oldDbPath)).status, 404, '路径遍历 404');
  assert.equal((await get('/package.json')).status, 404, '包清单 404');
  assert.equal((await get('/docs')).status, 404, '裸 /docs 路径 404');
  assert.equal((await get('/docs/')).status, 404, '/docs/ 目录 404');
  assert.equal((await get('/server')).status, 404, '裸 /server 路径 404');
});
