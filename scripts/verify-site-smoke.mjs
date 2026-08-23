/**
 * New-site staging smoke (S0-25): minimal e2e deployment verification for the new pipeline.
 * -----------------------------------------------------------------------------------------
 * - Builds the real deployable (Vite frontend + esbuild worker -> dist/) then serves dist
 *   through the real _worker.js fetch handler with a real D1-shaped local DB and a real-file
 *   ASSETS stub that faithfully simulates the Pages platform (any missing path falls back to
 *   index.html 200 text/html - which is what lets the worker's SPA-impersonation guard be
 *   exercised; the AB-1 lesson that the old v2 mock (404 for missing assets) masked a real
 *   production defect is why the stub serves HTML here).
 *
 * Hard gates (deployment surface; these are the pre-publish bar):
 *   1. /api/health                -> 200 + ready:true; logDrop counter observable (E1)
 *   2. /                          -> 200 HTML: #app mount, strict meta CSP, absolute /assets/
 *                                     hashed refs (base '/', PA-2-F14), zero inline manifest
 *   3. /assets/<hash>.js          -> 200 + Cache-Control immutable (Vite content hash + _headers)
 *   4. extension-less SPA path    -> 200 HTML (Pages fallback, worker passes through)
 *   4.5 deep link (/teacher/profile) -> SPA fallback HTML whose /assets/* resolve from the
 *                                     site root (base './' regression would 404 every script)
 *   5. /assets/<missing>.js       -> 404 (SPA-impersonation guard: never feed HTML to <script>)
 *   6. /server/secrets.js         -> 404 (sensitive-path gate)
 *   7. auth/notify route wiring   -> POST /api/auth/login bad creds -> 401 AUTH_LOGIN_FAILED;
 *                                    GET /api/notifications -> 401 AUTH_LOGIN_REQUIRED
 *                                    (routes wired, fail-closed, no 500)
 *
 * Browser gate (M1 landing render): chromium mounts the real app at /; .landing + hero render
 * with the hero title text, two A1 CTAs and the footer; zero console / PAGEERROR / CSP.
 *
 * Full chain (register -> login -> notify write/read -> ledger/log) is the S0.md note ⑤
 * aspiration; the backend domains (S1-S6) are still landing on this branch, so the stable
 * surface above is the hard gate and item 7 is the chain signal. Extend here once domains land.
 *
 * Not in the npm test glob (manual pre-deploy run): node scripts/verify-site-smoke.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';

// Build the real deployable first (Vite frontend + esbuild worker + _headers copy into dist).
execFileSync(process.execPath, ['scripts/build.mjs'], { stdio: 'inherit' });

const worker = (await import('../dist/_worker.js')).default;
const DIST = resolve('dist');

function fail(...a) { console.error('X', ...a); process.exitCode = 1; }
function ok(...a) { console.log('OK', ...a); }

// ---- real _headers rule parsing + matching (Pages semantics: prefix match, more segments win; /* fallback) ----
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
function headersFor(path) {
  const hits = [];
  for (const r of HEADERS_RULES) {
    if (r.pattern === '/*') { hits.push({ r, segs: 0 }); continue; }
    const pat = r.pattern.replace(/\/\*$/, '');
    if (path.startsWith(pat)) hits.push({ r, segs: pat.split('/').length });
  }
  // Pages semantics: when multiple rules hit, the more specific (more segments) rule overrides the
  // same header. Merge in ascending segment order so the most specific rule is assigned last and wins.
  hits.sort((a, b) => a.segs - b.segs);
  const merged = {};
  for (const { r } of hits) Object.assign(merged, r.headers);
  return merged;
}

// ---- D1-shaped shim (same contract as the v2 staging smoke / api-batch tests) ----
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

// ---- real-file ASSETS stub with faithful Pages SPA fallback (missing -> index.html) ----
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
      if (!existsSync(safe)) {
        // Pages platform SPA fallback: any missing path is served index.html (200 text/html).
        // The worker's impersonation guard converts "HTML for a real-extension path" back to 404.
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

// ---- local DB shim (real initDb bootstrap; the worker's _dbInited takes over) ----
const rawDb = new DatabaseSync(':memory:');
rawDb.exec('PRAGMA foreign_keys = ON');
const dbShim = makeShim(rawDb);
await initDb(dbShim, {});
const env = { ASSETS: mockAssets(), DB: dbShim };
const ctx = { waitUntil: fn => (typeof fn === 'function' ? fn() : fn) };

const port = 8942;
const base = `http://127.0.0.1:${port}`;
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', base);
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const request = new Request(url, {
      method: req.method,
      headers: req.headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
    });
    const response = await worker.fetch(request, env, ctx);
    const buf = await response.arrayBuffer(); // read body before writing headers (page.close race)
    if (res.writableEnded || res.destroyed) return;
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(buf));
  } catch (e) {
    if (res.writableEnded || res.destroyed) return;
    res.writeHead(500);
    res.end(String(e && e.message));
  }
});

await new Promise(r => server.listen(port, '127.0.0.1', r));

const getText = async p => {
  const r = await fetch(base + p);
  return { status: r.status, headers: r.headers, body: await r.text() };
};

try {
  // ---------- 1. /api/health -> 200 + ready + logDrop observable ----------
  {
    const r = await fetch(base + '/api/health');
    const data = await r.json();
    r.status === 200 ? ok('/api/health -> 200') : fail('/api/health -> ' + r.status);
    data.ready === true ? ok('health ready:true (local, no CF_PAGES_* gate)') : fail('health ready=' + data.ready);
    typeof data.logDrop?.dropped === 'number'
      ? ok('logDrop.dropped observable (E1): ' + data.logDrop.dropped)
      : fail('logDrop.dropped missing from health payload');
  }

  // ---------- 2. / -> 200 HTML: #app, strict meta CSP, hashed refs, zero inline manifest ----------
  {
    const { status, body } = await getText('/');
    status === 200 ? ok('/ -> 200') : fail('/ -> ' + status);
    body.includes('id="app"') ? ok('HTML has #app mount') : fail('HTML missing #app');
    body.includes('http-equiv="Content-Security-Policy"')
      ? ok('meta CSP injected (Vite injectCspMeta)') : fail('meta CSP missing');
    body.includes("script-src 'self'") && body.includes("style-src-attr 'none'")
      ? ok('meta CSP strict posture (script-src self / style-src-attr none)') : fail('meta CSP posture regressed');
    const assetRefs = [...body.matchAll(/(?:src|href)="\/assets\/([^"]+)"/g)].map(m => m[1]);
    assetRefs.length > 0 ? ok(`absolute /assets/ refs present (${assetRefs.length})`) : fail('zero absolute asset refs (not Vite SPA shape)');
    assetRefs.every(n => /^[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8}\.[A-Za-z0-9]+$/.test(n))
      ? ok('all asset refs are Vite content-hashed names') : fail('non-hashed asset ref found');
    /"(?:src|href)="\.\//.test(body)
      ? fail('relative ./asset ref present (base must be \'/\', PA-2-F14)') : ok('zero relative ./asset refs');
    body.includes('window.ASSET_MANIFEST')
      ? fail('inline manifest present (v2 pipeline remnant)') : ok('zero inline manifest (v2 hash pipeline removed)');
  }

  // ---------- 3. content-hashed asset -> 200 + immutable ----------
  {
    const { body } = await getText('/');
    const jsRef = (body.match(/src="\/assets\/([^"]+\.js)"/) || [])[1];
    if (jsRef) {
      const r = await getText('/assets/' + jsRef);
      r.status === 200 ? ok(`/assets/${jsRef} -> 200`) : fail(`/assets/${jsRef} -> ${r.status}`);
      String(r.headers.get('cache-control') || '').includes('immutable')
        ? ok('/assets/* immutable (Vite content hash + _headers)') : fail('immutable missing: ' + r.headers.get('cache-control'));
      String(r.headers.get('content-type') || '').includes('javascript')
        ? ok('asset content-type application/javascript') : fail('asset content-type: ' + r.headers.get('content-type'));
    } else {
      fail('no module script ref in index.html');
    }
  }

  // ---------- 4. extension-less SPA path -> 200 HTML ----------
  {
    const r = await getText('/some-non-api-route');
    r.status === 200 && (r.headers.get('content-type') || '').includes('html')
      ? ok('/some-non-api-route SPA fallback -> 200 HTML') : fail(`/some-non-api-route -> ${r.status}`);
  }

  // ---------- 4.5. deep-link asset resolution (PA-2-F14 regression) ----------
  // A deep-link SPA fallback (/teacher/profile -> index.html) must still reference
  // its assets with absolute /assets/* paths. base:'./' would emit ./assets/*, which
  // the browser resolves against /teacher/ -> /teacher/assets/* 404 (white page).
  {
    const { status, body } = await getText('/teacher/profile');
    status === 200 ? ok('deep link /teacher/profile -> 200 (SPA fallback)') : fail(`deep link -> ${status}`);
    const jsRef = (body.match(/src="\/assets\/([^"]+\.js)"/) || [])[1];
    if (jsRef) {
      ok('deep-link fallback HTML references assets absolutely (/assets/*)');
      const okAsset = await getText('/assets/' + jsRef);
      okAsset.status === 200 ? ok(`/assets/${jsRef} -> 200 (root asset reachable)`) : fail(`/assets/${jsRef} -> ${okAsset.status}`);
    } else {
      fail('deep-link fallback HTML missing absolute /assets/ ref');
    }
    /"(?:src|href)="\.\//.test(body)
      ? fail('deep-link fallback HTML has relative ./asset ref (base must be \'/\', PA-2-F14)')
      : ok('deep-link fallback HTML has zero relative ./asset refs');
  }

  // ---------- 5. SPA-impersonation guard: missing .js -> 404 (never HTML to <script>) ----------
  {
    const r = await getText('/assets/DOESNOTEXIST.js');
    r.status === 404
      ? ok('/assets/<missing>.js -> 404 (impersonation guard)') : fail(`/assets/DOESNOTEXIST.js -> ${r.status} (guard must 404)`);
  }

  // ---------- 6. sensitive path -> 404 ----------
  {
    const r = await getText('/server/secrets.js');
    r.status === 404 ? ok('/server/secrets.js -> 404') : fail(`/server/secrets.js -> ${r.status}`);
  }

  // ---------- 7. auth/notify route wiring (fail-closed, no 500) ----------
  {
    const r = await fetch(base + '/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier: 'nobody', password: 'wrong' }),
    });
    const data = await r.json().catch(() => ({}));
    r.status === 401 && data.code === 'AUTH_LOGIN_FAILED'
      ? ok('POST /api/auth/login bad creds -> 401 AUTH_LOGIN_FAILED (route wired, fail-closed)')
      : fail(`login -> ${r.status} ${JSON.stringify(data)}`);
    const n = await fetch(base + '/api/notifications');
    n.status === 401
      ? ok('GET /api/notifications -> 401 AUTH_LOGIN_REQUIRED (notify route wired, auth gate on)')
      : fail(`/api/notifications -> ${n.status}`);
  }

  // ---------- 8. browser: landing render + zero console/PAGEERROR/CSP ----------
  {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    const consoleMsgs = [];
    page.on('console', m => consoleMsgs.push(m.type() + ': ' + m.text()));
    page.on('pageerror', e => consoleMsgs.push('PAGEERROR: ' + e.message));
    await page.goto(base + '/', { waitUntil: 'load' });
    await page.waitForSelector('.landing', { timeout: 8000 });
    ok('.landing rendered');
    const heroTitle = await page.textContent('.landing-hero__title').catch(() => '');
    heroTitle && heroTitle.trim().length > 0
      ? ok(`hero title rendered (${heroTitle.trim()})`) : fail('hero title empty');
    const ctaCount = await page.locator('.landing-hero__btn').count();
    ctaCount === 2 ? ok('two hero A1 CTA buttons') : fail('hero CTA count = ' + ctaCount);
    const footerOk = await page.locator('.landing-footer').count();
    footerOk > 0 ? ok('footer present') : fail('footer missing');
    const errors = consoleMsgs.filter(m => /PAGEERROR|error|Content Security Policy/i.test(m));
    errors.length === 0
      ? ok('browser zero PAGEERROR / console error / CSP violation')
      : fail('browser errors:', errors.slice(0, 4).join(' | '));
    await browser.close();
  }

  console.log('\nS0-25 site smoke complete.');
} finally {
  server.close();
}
if (process.exitCode) process.exit(process.exitCode);
