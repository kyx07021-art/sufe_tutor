/**
 * sw.js — 站内 Service Worker（v0.22.7，性能层）
 *
 * 目标：静态资产与公开读请求本地缓存，重复访问接近零网络加载。
 *
 * 策略：
 *  - 版本化缓存名（activate 时读 /constants.js 的 APP_VERSION）：部署升级 → 新缓存名
 *    → 清理旧缓存并预缓存新资产。已知取舍：SW 更新遵循浏览器机制，部署后首个整页
 *    加载可能仍是旧 SW 控制的旧资产（下一次导航切到新版本）；根治需内容哈希文件名（构建步骤，
 *    见 docs/backlog.md 备忘）。
 *  - 导航（整页）：network-first（HTML 恒取最新），离线回落缓存。
 *  - 静态资产（js/css/svg/图片）：cache-first + 后台刷新（stale-while-revalidate）。
 *  - 公开读 API（仅无 scope 需求广场）：TTL 内命中即返 + 后台刷新，过期走网络并回填。
 *    与 server/cache.js 同一安全边界——带 scope/viewerId 等 per-user 参数的读不缓存。
 *  - 任何非 GET /api 请求（写操作）：清空 API 缓存（防客户端读到旧数据）。
 *  - /api/admin/* 等敏感/管理端请求一律走网络，不缓存。
 *
 * v0.22.7 修复（v0.22.6 门控事故彻查结论）：
 *  1. activate 只清 sufe-v* 静态缓存、从不清 sufe-api——旧版本边界下缓存的条目跨版本残留。
 *     现激活即清 API 缓存（含历史遗留），从零重填，杜绝旧边界数据服务到新语义。
 *  2. 公开读缓存注释承诺 30s 短缓存，实现却命中即返、无限期服务陈旧数据（纯读会话无写操作
 *     清缓存时旧数据一直显示）。现每次命中核对 x-sw-cached-at 时间戳，过期按未命中走网络。
 *  3. 激活先预填新版本缓存再删旧缓存，避免迁移窗口内无缓存可用。
 */
const CACHE_PREFIX = 'sufe-v';
const API_CACHE = 'sufe-api';
const API_TTL_MS = 30000; // 公开读 API 缓存 TTL（浏览器侧独立口径；服务端 per-user 缓存 TTL 更短、写后全清，两者不须对齐）

let VERSION = 'unknown';
async function currentVersion() {
  try {
    const r = await fetch('/constants.js');
    const m = (await r.text()).match(/APP_VERSION:\s*'([^']+)'/);
    return m ? m[1] : 'unknown';
  } catch { return 'unknown'; }
}

// 静态资产清单（与 index.html 脚本/样式引用一致；改动须同步）
const ASSETS = [
  '/', '/index.html',
  '/style.css', '/glass.css', '/style-region.css', '/style-posts.css', '/style-chat.css',
  '/constants.js', '/region-data.js',
  '/app-display.js', '/app-state.js', '/app-api.js', '/app-anim.js', '/app-ui.js', '/app-onboard.js',
  '/app-region.js', '/app-posts.js', '/app-chat.js', '/app-contracts.js', '/app-admin.js', '/app-chart.js',
  '/app-demands.js', '/app-teachers.js', '/app-pages.js', '/app-shell.js', '/app-auth.js',
];

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    VERSION = await currentVersion();
    const name = CACHE_PREFIX + VERSION;
    // 先预填新版本缓存，再清理旧版本（含 API 缓存）——避免迁移窗口内无缓存可用，
    // 也杜绝旧版本边界下缓存的 API 条目跨版本残留服务到新语义（v0.22.7）
    const cache = await caches.open(name);
    await cache.addAll(ASSETS).catch(() => {});
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => (k.startsWith(CACHE_PREFIX) && k !== name) || k === API_CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

const isStatic = u => u.origin === self.location.origin && (
  u.pathname === '/' || u.pathname === '/index.html' ||
  /\.(js|css|svg|png|jpe?g|webp|ico)$/.test(u.pathname)
);

// 公开读 API（与令牌完全无关）——与 server/cache.js 同边界。
// /api/teachers 的 matched、/api/posts 的 liked 按令牌随用户变化，SW 缓存会服务陈旧标记，一律不缓存。
const isPublicRead = u => u.origin === self.location.origin && (
  u.pathname === '/api/student/demands' && !u.searchParams.get('scope')
);

// 条目带抓取时间戳（x-sw-cached-at）；TTL 内算新鲜。旧版本 SW 缓存的条目无此头 → 一律视为过期，
// 版本升级后第一条公开读自动走网络重拉（v0.22.7 修正：此前命中即返可无限期服务陈旧数据）
function apiEntryFresh(cached) {
  const ts = Number(cached.headers.get('x-sw-cached-at') || 0);
  return ts > 0 && Date.now() - ts < API_TTL_MS;
}

async function apiCachePut(cache, url, res) {
  if (!res || !res.ok) return;
  try {
    const clone = res.clone();
    const headers = new Headers(clone.headers);
    headers.set('x-sw-cached-at', String(Date.now()));
    await cache.put(url, new Response(clone.body, { status: clone.status, statusText: clone.statusText, headers }));
  } catch { /* 缓存写入失败不影响响应 */ }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 写操作：清 API 缓存（不拦截，走网络）
  if (req.method !== 'GET') {
    if (url.pathname.startsWith('/api/')) e.waitUntil(caches.delete(API_CACHE));
    return;
  }

  // 导航（整页）：network-first，离线回落缓存
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE_PREFIX + VERSION);
      try {
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch {
        return (await cache.match('/index.html')) || Response.error();
      }
    })());
    return;
  }

  // 静态资产：cache-first + 后台刷新
  if (isStatic(url)) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE_PREFIX + VERSION);
      const cached = await cache.match(req);
      const refresh = fetch(req).then(async res => {
        if (res.ok) { try { await cache.put(req, res.clone()); } catch {} }
        return res;
      }).catch(() => cached);
      return cached || refresh;
    })());
    return;
  }

  // 公开读 API：TTL 内命中即返 + 后台刷新；过期/未命中走网络并回填（v0.22.7 时间戳判定）
  if (isPublicRead(url)) {
    e.respondWith((async () => {
      const cache = await caches.open(API_CACHE);
      const cached = await cache.match(url);
      if (cached && apiEntryFresh(cached)) {
        fetch(req).then(res => apiCachePut(cache, url, res)).catch(() => {});
        return cached;
      }
      const res = await fetch(req);
      await apiCachePut(cache, url, res);
      return res;
    })());
  }
});
