/**
 * sw.js — 站内 Service Worker（v0.22.5，性能层）
 *
 * 目标：静态资产与公开读请求本地缓存，重复访问接近零网络加载。
 *
 * 策略：
 *  - 版本化缓存名（activate 时读 /constants.js 的 APP_VERSION）：部署升级 → 新缓存名
 *    → 自动清理旧缓存并预缓存新资产。已知取舍：SW 更新遵循浏览器机制，部署后首个整页
 *    加载可能仍是旧 SW 控制的旧资产（下一次导航切到新版本）；根治需内容哈希文件名（构建步骤，
 *    见 docs/backlog.md 备忘）。
 *  - 导航（整页）：network-first（HTML 恒取最新），离线回落缓存。
 *  - 静态资产（js/css/svg/图片）：cache-first + 后台刷新（stale-while-revalidate）。
 *  - 公开读 API（需求广场/教师列表/帖子，无 per-user 参数）：30s 短缓存 + 后台刷新；
 *    与 server/cache.js 同一安全边界——带 scope/viewerId 等 per-user 参数的读不缓存。
 *  - 任何非 GET /api 请求（写操作）：清空 API 缓存（防客户端读到旧数据）。
 *  - /api/admin/* 等敏感/管理端请求一律走网络，不缓存。
 */
const CACHE_PREFIX = 'sufe-v';
const API_CACHE = 'sufe-api';

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
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith(CACHE_PREFIX) && k !== name).map(k => caches.delete(k)));
    const cache = await caches.open(name);
    await cache.addAll(ASSETS).catch(() => {});
    await self.clients.claim();
  })());
});

const isStatic = u => u.origin === self.location.origin && (
  u.pathname === '/' || u.pathname === '/index.html' ||
  /\.(js|css|svg|png|jpe?g|webp|ico)$/.test(u.pathname)
);

// 公开读 API（无 per-user 参数）——与 server/cache.js 同边界
const isPublicRead = u => u.origin === self.location.origin && (
  (u.pathname === '/api/student/demands' && !u.searchParams.get('scope')) ||
  u.pathname === '/api/teachers' || u.pathname === '/api/posts'
);

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

  // 公开读 API：30s 短缓存 + 后台刷新
  if (isPublicRead(url)) {
    e.respondWith((async () => {
      const cache = await caches.open(API_CACHE);
      const cached = await cache.match(url);
      if (cached) {
        fetch(req).then(res => { if (res.ok) cache.put(url, res.clone()); }).catch(() => {});
        return cached;
      }
      const res = await fetch(req);
      if (res.ok) { try { await cache.put(url, res.clone()); } catch {} }
      return res;
    })());
  }
});
