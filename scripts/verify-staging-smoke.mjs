/**
 * V-4-1e staging 冒烟：真实部署产物（dist/_worker.js + dist/ + _headers）经真实 worker fetch 服务，
 * Playwright 浏览器实机验证 v2 页面 / 路由 / 静态资产哈希 / CSS 加载序 / 子目录版本化 URL。
 * 不进 npm test glob，交付前手动跑。用法：node scripts/verify-staging-smoke.mjs
 *
 * 验证面：
 *   1. GET /：worker 改写资产引用为哈希名 + 零内联 manifest（V-3-1d）；CSS 分层
 *      tokens→base→features→responsive→glass 加载序保持（V-2-5b 铁律）。
 *   2. 版本化资产：/features/<hash>.css（子目录，worker versionedBase）+ /assets/app-<hash>.js
 *      （esbuild 内容哈希，_headers /assets/* 规则）→ 200 + immutable。
 *   3. SPA 回退 /my-demands → 200 HTML（v2 壳，零内联；Pages ASSETS 无扩展名回退 index.html）。
 *   4. 浏览器 /：landing 渲染 + 访客进客户端壳（路由冒烟），零 pageerror/console error；
 *      ASSETS 桩解析真实 _headers 规则（/* 安全头 + CSP 与 meta 取交集，忠实生产响应头）。
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { ASSET_MANIFEST } from '../manifest.js';
import { initDb } from '../src/server/core/db.js';

// 保证资产管线新鲜：manifest 与源码一致 → build（manifest 打入 worker 与引用改写）
execFileSync(process.execPath, ['hash-assets.mjs'], { stdio: 'inherit' });
execFileSync(process.execPath, ['scripts/build.mjs'], { stdio: 'inherit' });

const worker = (await import('../dist/_worker.js')).default;
const DIST = resolve('dist');

function fail(...a) { console.error('✖', ...a); process.exitCode = 1; }
function ok(...a) { console.log('✔', ...a); }

// ---- 真实 _headers 规则解析 + 匹配（Pages 语义：路径前缀匹配，段数多者优先；/* 兜底）----
function parseHeadersRules(src) {
  const rules = [];
  let cur = null;
  for (const line of src.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    if (/^\S/.test(line)) { cur = { pattern: t, headers: {} }; rules.push(cur); continue; }
    const idx = t.indexOf(':');
    if (idx > -1 && cur) cur.headers[t.slice(0, idx).trim().toLowerCase()] = t.slice(idx + 1).trim();
  }
  return rules;
}
const HEADERS_RULES = parseHeadersRules(readFileSync(resolve(DIST, '_headers'), 'utf8'));
// Pages _headers 语义（审计 F1）：请求命中多个规则的 URL 模式时继承全部命中规则的响应头；
// 同一 header 多规则命中时按更具体（段数多）规则覆盖。
function headersFor(path) {
  const hits = [];
  for (const r of HEADERS_RULES) {
    if (r.pattern === '/*') { hits.push({ r, segs: 0 }); continue; }
    const pat = r.pattern.replace(/\/\*$/, '');
    if (path.startsWith(pat)) hits.push({ r, segs: pat.split('/').length });
  }
  hits.sort((a, b) => b.segs - a.segs);
  const merged = {};
  for (const { r } of hits) Object.assign(merged, r.headers);
  return merged;
}

// ---- D1 形状 shim（同 test/api-batch.test.js 口径）----
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
      if (!stmts.length) throw new Error('D1 batch requires at least one statement');
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

// ---- 真实文件 ASSETS 桩（路径约束 dist/ 内 + _headers 规则 + Pages SPA 回退）+ Cache API 桩 ----
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
      let rel = p === '/' ? 'index.html' : p.replace(/^\//, '');
      let safe = resolve(DIST, '.' + '/' + rel);
      // Pages ASSETS SPA 回退：无扩展名的导航路径 → index.html（v2 壳，零内联）
      if (!existsSync(safe) && !/\.\w{1,6}$/.test(rel)) {
        rel = 'index.html';
        safe = resolve(DIST, rel);
      }
      if (!safe.startsWith(DIST + sep) || !existsSync(safe)) return new Response('Not Found', { status: 404 });
      const content = readFileSync(safe);
      const type = safe.endsWith('.html') ? 'text/html; charset=utf-8'
        : safe.endsWith('.js') ? 'application/javascript'
        : safe.endsWith('.css') ? 'text/css' : 'application/octet-stream';
      const headers = { 'content-type': type, 'cache-control': 'max-age=0, must-revalidate', 'content-length': String(content.byteLength), ...headersFor('/' + rel) };
      return new Response(content, { status: 200, headers });
    },
  };
}

// 本地 DB shim（真实 initDb 引导，worker 的 _dbInited 自行接管）
const rawDb = new DatabaseSync(':memory:');
rawDb.exec('PRAGMA foreign_keys = ON');
const dbShim = makeShim(rawDb);
await initDb(dbShim, {});
const env = { ASSETS: mockAssets(), DB: dbShim };
const ctx = { waitUntil: fn => (typeof fn === 'function' ? fn() : fn) };

const port = 8941;
const base = `http://127.0.0.1:${port}`;
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', base);
    const chunks = [];
    for await (const c of req) chunks.push(c); // POST 体必须透传（app 的 /api/batch 等端到端依赖）
    const body = Buffer.concat(chunks);
    const request = new Request(url, {
      method: req.method,
      headers: req.headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
    });
    const response = await worker.fetch(request, env, ctx);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (e) { res.writeHead(500); res.end(String(e && e.message)); }
});

await new Promise(r => server.listen(port, '127.0.0.1', r));

const getText = async p => {
  const r = await fetch(base + p);
  return { status: r.status, headers: r.headers, body: await r.text() };
};

try {
  // ---------- 1. / 引用改写 + CSS 分层序 + 零内联 manifest ----------
  {
    const { status, body } = await getText('/');
    status === 200 ? ok('/ → 200（v2 入口）') : fail('/ → ' + status);
    const links = [...body.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="\/([^"]+)"/g)].map(m => m[1]);
    const layerOrder = ['tokens.', 'base.', 'features/', 'responsive.', 'glass.'];
    let prevIdx = -1, prevName = null, orderOk = true;
    for (const prefix of layerOrder) {
      const idx = links.findIndex(l => l.startsWith(prefix));
      if (idx === -1) { fail(`CSS 层 ${prefix} 缺失（实际：${links.join(',')}）`); orderOk = false; break; }
      if (idx <= prevIdx) { fail(`CSS 层序乱：${prevName} 在 ${prefix} 之后（V-2-5b 铁律）`); orderOk = false; break; }
      prevIdx = idx; prevName = prefix;
    }
    if (orderOk) ok(`CSS 分层序 tokens→base→features→responsive→glass 保持（${links.length} 个 stylesheet）`);
    const tokensHash = links.find(l => l.startsWith('tokens.'));
    tokensHash && /^tokens\.[0-9a-f]{8}\.css$/.test(tokensHash)
      ? ok(`CSS 引用改哈希名（${tokensHash}）`) : fail(`CSS 引用未哈希化（tokens 链接：${tokensHash}）`);
    const modSrc = body.match(/<script type="module" src="\/([^"]+)"/);
    modSrc && /^assets\/app-.*\.js$/.test(modSrc[1])
      ? ok(`ESM 入口改哈希名（/${modSrc[1]}）`) : fail(`ESM 入口未哈希化（${modSrc ? modSrc[1] : '缺失'}）`);
    body.includes('window.ASSET_MANIFEST')
      ? fail('v2 页出现内联 manifest（V-3-1d 契约：零内联）') : ok('v2 页零内联 manifest（V-3-1d）');
  }

  // ---------- 2. 版本化资产（子目录 + /assets/* esbuild 哈希）→ 200 + immutable ----------
  {
    const subCss = ASSET_MANIFEST.files['features/complaints.css'];
    const r1 = await getText('/' + subCss);
    r1.status === 200 ? ok(`子目录版本化 CSS（/${subCss}）→ 200`) : fail(`/${subCss} → ${r1.status}`);
    String(r1.headers.get('cache-control') || '').includes('immutable')
      ? ok(`子目录 CSS immutable（worker versionedBase）`) : fail(`子目录 CSS 无 immutable（${r1.headers.get('cache-control')}）`);
    const { body } = await getText('/');
    const modSrc = body.match(/<script type="module" src="\/([^"]+)"/);
    if (modSrc) {
      const r2 = await getText('/' + modSrc[1]);
      r2.status === 200 ? ok(`/assets ESM 资产（/${modSrc[1]}）→ 200`) : fail(`/${modSrc[1]} → ${r2.status}`);
      String(r2.headers.get('cache-control') || '').includes('immutable')
        ? ok('/assets ESM 资产 immutable（_headers /assets/*）') : fail(`/assets ESM 资产无 immutable（${r2.headers.get('cache-control')}）`);
    }
  }

  // ---------- 3. SPA 回退 ----------
  {
    const r = await getText('/my-demands');
    r.status === 200 && (r.headers.get('content-type') || '').includes('html')
      ? ok('/my-demands SPA 回退 → 200 HTML（v2 壳零内联）') : fail(`/my-demands → ${r.status}`);
  }

  // ---------- 4. 浏览器：v2 页面渲染 + 客户端路由 + /api 存活 ----------
  {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    const consoleMsgs = [];
    page.on('console', m => consoleMsgs.push(m.type() + ': ' + m.text()));
    page.on('pageerror', e => consoleMsgs.push('PAGEERROR: ' + e.message));
    await page.addInitScript(() => { try { localStorage.setItem('sufe_returning', '1'); } catch {} });
    await page.goto(base + '/', { waitUntil: 'load' });
    await page.waitForTimeout(1500);
    const appChildren = await page.evaluate(() => {
      const app = document.getElementById('app');
      return app ? app.children.length : -1;
    });
    appChildren > 0 ? ok(`/ 浏览器渲染（#app ${appChildren} 子节点）`) : fail('landing 未渲染');
    const health = await page.evaluate(() => fetch('/api/health').then(r => r.status).catch(e => 'ERR:' + e.message));
    health === 200 ? ok('/api/health 经真实 worker → 200') : fail(`/api/health → ${health}`);
    await page.click('[data-action="auth.enterGuest"]').catch(() => {});
    await page.waitForSelector('#sidebar-nav .sidebar-item', { timeout: 5000 }).catch(() => {});
    const inShell = await page.evaluate(() => !!document.querySelector('#sidebar-nav .sidebar-item'));
    inShell ? ok('访客进客户端壳（路由冒烟）') : fail('客户端壳未渲染');
    const errors = consoleMsgs.filter(m => m.startsWith('PAGEERROR') || m.startsWith('error'));
    errors.length === 0 ? ok('浏览器零 pageerror/console error') : fail('浏览器报错：', errors.slice(0, 3).join(' | '));
    await browser.close();
  }

  console.log('\nV-4-1e staging 冒烟完成。');
} finally {
  server.close();
}
if (process.exitCode) process.exit(process.exitCode);
