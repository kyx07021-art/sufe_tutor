/**
 * 公开读缓存（v0.22.5，性能咽喉）
 *
 * 只读列表的短 TTL 内存缓存，跨请求/跨用户共享。定位：把热点公开读（需求广场/教师列表/帖子）
 * 的服务器耗时从每次打 D1（~190ms）压到内存命中（~1ms）。
 *
 * 安全边界：
 *  - 只缓存「无 per-user 上下文」的公开读。带 scope=for-teacher/mine、viewerId 等
 *    per-user 参数的请求一律不缓存（否则把 A 的意向状态/匹配标记泄露给 B）。
 *  - 写操作（非 GET 成功响应）在 _worker 编排层统一 readCacheClearAll() 失效——缓存
 *    极小（3 键），全清最简且不会漏。
 *
 * per-isolate 内存：多实例间短暂不一致由 TTL 自愈（小站量级可接受；跨实例强一致留给
 * Cloudflare Cache API 或 KV，当前无必要）。
 */
const CACHE_TTL_MS = 30000; // 公开读 TTL（秒级自愈，写后即时失效不受此限）
const store = new Map(); // key → { data, expires }

/** 命中返回数据对象，未命中/过期返回 null */
export function readCacheGet(key) {
  const e = store.get(key);
  if (!e) return null;
  if (e.expires < Date.now()) { store.delete(key); return null; }
  return e.data;
}

/** 写入（带 TTL） */
export function readCachePut(key, data) {
  store.set(key, { data, expires: Date.now() + CACHE_TTL_MS });
}

/** 按前缀失效（备用；当前主路径用全清） */
export function readCacheClear(prefix) {
  for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k);
}

/** 全量失效（写操作后调用，最简不漏） */
export function readCacheClearAll() {
  store.clear();
}
