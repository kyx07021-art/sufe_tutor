/**
 * #174（v0.25.76）：worker 静态面 + 内容哈希虚拟版本化端到端
 * 用 stub ASSETS（读真实仓库文件）驱动 _worker.js 的 fetch 默认导出，验证：
 *  - GET / → HTML 引用改写为哈希名 + 内联 manifest
 *  - GET /<base>.<hash8>.js → 回 base 内容 + Cache-Control immutable
 *  - GET /<base>.js（裸名）→ 正常服务但绝不 immutable（浏览器只应请求哈希名）
 *  - GET /<base>.<ffffffff>.js（不在 manifest 的哈希）→ 404，不给 HTML 冒充脚本
 *  - SPA 回退路径（/my-demands）→ 同样注入 manifest
 *  - 敏感路径 /server/、路径遍历 → 404
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import worker from '../_worker.js';
import { ASSET_MANIFEST } from '../manifest.js';

const REPO = fileURLToPath(new URL('../', import.meta.url));

function mockAssets() {
  return {
    async fetch(request) {
      const u = new URL(request.url);
      const p = decodeURIComponent(u.pathname);
      if (p.includes('..')) return new Response('Not Found', { status: 404 });
      const rel = p === '/' ? 'index.html' : p.replace(/^\//, '');
      const full = REPO + rel;
      if (existsSync(full)) {
        const isHtml = full.endsWith('.html');
        return new Response(readFileSync(full), {
          status: 200,
          headers: { 'content-type': isHtml ? 'text/html; charset=utf-8' : 'application/javascript', 'cache-control': 'max-age=0, must-revalidate' },
        });
      }
      // 无扩展名的导航路径 → SPA 回退 index.html；有扩展名的缺失资产 → 404
      if (!p.includes('.')) {
        return new Response(readFileSync(REPO + 'index.html'), {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'max-age=0, must-revalidate' },
        });
      }
      return new Response('Not Found', { status: 404 });
    },
  };
}

const env = { ASSETS: mockAssets() };
const ctx = { waitUntil: fn => fn() };
const get = async p => worker.fetch(new Request('https://test.local' + p), env, ctx);

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
