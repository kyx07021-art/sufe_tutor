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

// 模拟 Cloudflare Cache API（版本化资产边缘缓存，v0.25.83）
const cacheStore = new Map();
globalThis.caches = {
  default: {
    async match(req) { return cacheStore.get(String(req.url)) || null; },
    async put(req, res) { cacheStore.set(String(req.url), res.clone()); },
  },
};

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
          headers: { 'content-type': isHtml ? 'text/html; charset=utf-8' : 'application/javascript', 'cache-control': 'max-age=0, must-revalidate', 'ETag': STORED_ETAG, 'Last-Modified': 'Tue, 01 Jan 2026 00:00:00 GMT', 'content-length': String(content.byteLength) },
        });
      }
      // 无扩展名的导航路径 → SPA 回退 index.html；有扩展名的缺失资产 → 404
      if (!p.includes('.')) {
        const html = readFileSync(REPO + 'index.html');
        return new Response(html, {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'max-age=0, must-revalidate', 'ETag': STORED_ETAG, 'content-length': String(html.byteLength) },
        });
      }
      return new Response('Not Found', { status: 404 });
    },
  };
}

const env = { ASSETS: mockAssets() };
const ctx = { waitUntil: fn => (typeof fn === 'function' ? fn() : fn) }; // waitUntil 接 promise（cache.put）时放行执行
const get = async (p, headers = {}) => worker.fetch(new Request('https://test.local' + p, { headers }), env, ctx);

test('GET / → HTML 资产引用改写为哈希名 + 内联 manifest（懒加载器读取）', async () => {
  const res = await get('/');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes(`src="/${ASSET_MANIFEST.files['constants.js']}"`), 'boot 脚本引用改哈希名');
  assert.ok(html.includes(`href="/${ASSET_MANIFEST.files['tokens.css']}"`), 'CSS 引用改哈希名（V-2-5b tokens.css）');
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

test('GET /features/<base>.<hash8>.css → 子目录 base 内容 + immutable（F1 回归：V-2-5b 子目录版本化）', async () => {
  const [base, hashed] = Object.entries(ASSET_MANIFEST.files).find(([b]) => b === 'features/chat.css');
  assert.ok(hashed.startsWith('features/chat.'), 'manifest 含子目录条目');
  const res = await get('/' + hashed);
  assert.equal(res.status, 200, `子目录版本化 URL 200（不得 /features/features/ 404）`);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=31536000, immutable', '回 immutable');
  const body = await res.text();
  assert.ok(body.includes('.chat-bubble'), '回 features/chat.css 真实内容');
});

test('#260 空响应毒化防护：ASSETS 回 200 空 body 不进缓存（防哈希 URL 被空缓存永久毒化）', async () => {
  cacheStore.clear();
  const [base, hashed] = Object.entries(ASSET_MANIFEST.files).find(([b]) => b === 'glass.css');
  // ASSETS 对该 base 文件回 200 空 body（模拟部署滚动窗口曾发生的空 css 响应——worker 回源请求的是 base 路径）
  const emptyEnv = { ASSETS: {
    async fetch(request) {
      const u = new URL(request.url);
      if (u.pathname === '/' + base) {
        return new Response('', { status: 200, headers: { 'content-type': 'text/css', 'content-length': '0' } });
      }
      return mockAssets().fetch(request);
    },
  }};
  const g = async (p) => worker.fetch(new Request('https://test.local' + p), emptyEnv, ctx);
  const res = await g('/' + hashed);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '', '空响应透传（不伪造内容）');
  assert.equal(cacheStore.size, 0, '空响应不写边缘缓存——否则永不失效的哈希 URL 恒返回 0 字节');
});

test('#260 空缓存命中不返回：预置空缓存条目 → 跳过回源正常内容并覆盖（自愈）', async () => {
  cacheStore.clear();
  const [base, hashed] = Object.entries(ASSET_MANIFEST.files).find(([b]) => b === 'app-shell.js');
  // 预置一个已毒化的空哈希缓存条目（历史部署滚动窗口遗留）
  cacheStore.set('https://test.local/' + hashed,
    new Response('', { status: 200, headers: { 'content-type': 'application/javascript', 'content-length': '0' } }));
  const res = await get('/' + hashed);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.ok(body.includes('loadDomainScripts'), '跳过空缓存回源真实内容');
  const cachedNow = cacheStore.get('https://test.local/' + hashed);
  assert.ok(cachedNow && (await cachedNow.text()).length > 0, '正常内容覆盖空缓存（毒化条目自愈）');
});

test('版本化资产经 Cache API 写边缘缓存：二次命中返回缓存内容', async () => {
  cacheStore.clear();
  const [base, hashed] = Object.entries(ASSET_MANIFEST.files).find(([b]) => b === 'app-shell.js');
  const first = await get('/' + hashed);
  assert.equal(first.status, 200);
  assert.equal(cacheStore.size, 1, '首取后写入边缘缓存');
  const second = await get('/' + hashed);
  assert.equal(second.status, 200);
  const body = await second.text();
  assert.ok(body.includes('loadDomainScripts'), '二次命中返回缓存内容');
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
  const oldDbPath = ['server', 'db.js'].join('/'); // 避免测试源出现旧 import 路径字面量
  assert.equal((await get('/' + oldDbPath)).status, 404, 'server/ 目录 404');
  assert.equal((await get('/../' + oldDbPath)).status, 404, '路径遍历 404');
});
