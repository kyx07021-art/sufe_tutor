/**
 * 读缓存（v0.22.5，性能咽喉；v0.22.8 收紧 TTL 并改为按身份隔离）
 *
 * 只读列表的短 TTL 内存缓存。定位：把热点列表读（需求广场/教师列表/帖子）的服务器耗时
 * 从每次打 D1（~200-400ms 含聚合/排序）压到内存命中（~1ms）。
 *
 * 安全边界（v0.22.8 演进）：
 *  - 缓存键由 _worker 编排层构造为「身份:路径:查询」——带令牌请求按令牌 SHA-256 摘要分桶，
 *    无令牌归 anon 桶。per-token 数据（教师 matched、帖子 liked、需求 intent 状态）只在
 *    同一身份的桶内命中，A 的数据不可能服务给 B（替代 v0.22.6 的「干脆不缓存」，
 *    在安全前提下重新拿回速度）。
 *  - 写操作（非 GET 成功响应）在 _worker 编排层统一 readCacheClearAll() 失效——缓存极小，
 *    全清最简且不会漏。
 *
 * per-isolate 内存：多实例间短暂不一致由 TTL 自愈（小站量级可接受；跨实例强一致留给
 * Cloudflare Cache API 或 KV，当前无必要）。
 */
const CACHE_TTL_MS = 10000; // 短 TTL：按身份分桶后单用户快速往返导航命中；写后即时失效不受此限
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
