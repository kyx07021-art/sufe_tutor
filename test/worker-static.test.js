/**
 * #174（v0.25.76）：worker 静态面 + 内容哈希虚拟版本化端到端
 * 用 stub ASSETS（读真实仓库文件 + 模拟条件请求）驱动 _worker.js 的 fetch 默认导出，验证：
 *  - GET / → HTML 引用改写为哈希名 + 内联 manifest；ETag 为 worker 自持（改写 body 哈希）
 *  - GET /<base>.<hash8>.js → 回 base 内容 + Cache-Control immutable
 *  - GET /<base>.js（裸名）→ 正常服务但绝不 immutable（浏览器只应请求哈希名）
 *  - GET /<base>.<ffffffff>.js（不在 manifest 的哈希）→ 404，不给 HTML 冒充脚本
 *  - SPA 回退路径（/my-demands）→ 同样注入 manifest
 *  - 敏感路径与路径遍历 → 404
 *  - 304 语义（发版正确性关键）：存储 index.html 字节不变（ETag 不变）时，浏览器重验若命中
 *    ASSETS 原 ETag 得 304，worker 必须回退无条件重取并服务改写 HTML——否则沿用旧哈希引用 → 新部署下 404
 *  - If-None-Match 命中 worker 自身 ETag → 真 304（缓存即当前）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import worker from '../_worker.js';
import { ASSET_MANIFEST } from '../manifest.js';

const REPO = fileURLToPath(new URL('../', import.meta.url));
const STORED_ETAG = '"stored-file-etag"'; // 模拟存储 index.html 的固定 ETag（发版改资产不变页面时不变）

function mockAssets() {
  return {
    async fetch(request) {
      const u = new URL(request.url);
      const p = decodeURIComponent(u.pathname);
      if (p.includes('..')) return new Response('Not Found', { status: 404 });
      const rel = p === '/' ? 'index.html' : p.replace(/^\//, '');
      const full = REPO + rel;
      if (existsSync(full)) {
        const content = readFileSync(full);
        const isHtml = full.endsWith('.html');
        if (request.headers.get('if-none-match') === STORED_ETAG) return new Response(null, { status: 304, headers: { ETag: STORED_ETAG } });
        return new Response(content, {
          status: 200,
          headers: { 'content-type': isHtml ? 'text/html; charset=utf-8' : 'application/javascript', 'cache-control': 'max-age=0, must-revalidate', 'ETag': STORED_ETAG, 'Last-Modified': 'Tue, 01 Jan 2026 00:00:00 GMT' },
        });
      }
      // 无扩展名的导航路径 → SPA 回退 index.html；有扩展名的缺失资产 → 404
      if (!p.includes('.')) {
        return new Response(readFileSync(REPO + 'index.html'), {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'max-age=0, must-revalidate', 'ETag': STORED_ETAG },
        });
      }
      return new Response('Not Found', { status: 404 });
    },
  };
}

const env = { ASSETS: mockAssets() };
const ctx = { waitUntil: fn => fn() };
const get = async (p, headers = {}) => worker.fetch(new Request('https://test.local' + p, { headers }), env, ctx);

test('GET / → HTML 资产引用改写为哈希名 + 内联 manifest（懒加载器读取）', async () => {
  const res = await get('/');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes(`src="/${ASSET_MANIFEST.files['constants.js']}"`), 'boot 脚本引用改哈希名');
  assert.ok(html.includes(`href="/${ASSET_MANIFEST.files['style.css']}"`), 'CSS 引用改哈希名');
  assert.ok(html.includes(`src="/${ASSET_MANIFEST.files['app-shell.js']}"`), 'app-shell 引用改哈希名');
  assert.ok(html.includes('window.ASSET_MANIFEST'), '内联 manifest 注入');
  assert.ok(!html.includes('src="/constants.js"'), '裸名引用已全部改写');
});

test('HTML 响应 ETag 为 worker 自持（改写 body 哈希），非 ASSETS 原 ETag', async () => {
  const res = await get('/');
  const etag = res.headers.get('etag');
  assert.ok(etag && etag !== STORED_ETAG, `worker ETag 非存储文件 ETag（实 ${etag}）`);
  assert.ok(/^"[0-9a-f]{16}"$/.test(etag), '弱 ETag 为 16 hex');
  const html = await res.text();
  const crypto = globalThis.crypto;
  const expect = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(html)).then(d => '"' + [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16) + '"');
  assert.equal(etag, expect, 'ETag = 改写 body 哈希');
});

test('发版正确性：ASSETS 命中存储文件 ETag 得 304，worker 仍服务改写 HTML（防旧哈希引用）', async () => {
  // 浏览器带存储文件 ETag 重验（模拟"只改资产、index.html 字节未变"的发版场景）
  const res = await get('/', { 'If-None-Match': STORED_ETAG });
  assert.equal(res.status, 200, 'ASSETS 304 也必须回退重取并回 200 改写 HTML');
  const html = await res.text();
  assert.ok(html.includes(`src="/${ASSET_MANIFEST.files['app-shell.js']}"`), '返回当前 manifest 的改写 HTML');
});

test('If-None-Match 命中 worker 自身 ETag → 真 304', async () => {
  const first = await get('/');
  const etag = first.headers.get('etag');
  const res = await get('/', { 'If-None-Match': etag });
  assert.equal(res.status, 304, '缓存即当前 → 304');
  assert.equal(res.headers.get('etag'), etag);
});

test('GET /<base>.<hash8>.js → base 内容 + Cache-Control immutable', async () => {
  const [base, hashed] = Object.entries(ASSET_MANIFEST.files).find(([b]) => b === 'app-shell.js');
  const res = await get('/' + hashed);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=31536000, immutable', '版本化 URL 回 immutable');
  const body = await res.text();
  assert.ok(body.includes('loadDomainScripts'), '回 base 文件真实内容（app-shell 含懒加载器）');
  assert.ok(!body.includes('<html'), '绝不给 HTML 冒充脚本');
});

test('GET /<base>.js（裸名）→ 正常服务但绝不 immutable', async () => {
  const res = await get('/app-chat.js');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'max-age=0, must-revalidate', '裸名保持 revalidate，不设 immutable');
});

test('GET 不在 manifest 的哈希 URL → 404（部署竞态旧哈希防 HTML 冒充）', async () => {
  const res = await get('/app-chat.ffffffff.js');
  assert.equal(res.status, 404);
});

test('SPA 回退路径 /my-demands → 同样注入 manifest 并改写引用', async () => {
  const res = await get('/my-demands');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes(`src="/${ASSET_MANIFEST.files['constants.js']}"`), 'SPA 回退 HTML 同样改写');
  assert.ok(html.includes('window.ASSET_MANIFEST'), 'SPA 回退同样内联 manifest');
});

test('敏感路径与路径遍历 → 404', async () => {
  assert.equal((await get('/server/db.js')).status, 404, 'server/ 目录 404');
  assert.equal((await get('/../server/db.js')).status, 404, '路径遍历 404');
});
