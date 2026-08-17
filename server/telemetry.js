/**
 * 观测指标层（v1.5.0）—— 请求量/状态码/慢请求/限流命中的轻量聚合。
 *
 * 设计：内存 Map 同步计数（每请求零 D1 往返）→ 每 isolate 至多 60s flush 一次
 * 到 request_metrics 聚合表；管理员 dashboard 只读聚合表，不扫活动日志。
 * 指标是观测数据（best-effort），多实例/重启造成分钟级少量丢失可接受。
 */
import { dbAll, dbRun } from '../src/server/core/util.js';
import { LIMITS } from './constants.js';

const buckets = new Map();
let lastFlush = 0;

export async function initMetrics(db) {
  await dbRun(db, `CREATE TABLE IF NOT EXISTS request_metrics (
    bucket TEXT NOT NULL,             -- UTC 'YYYY-MM-DDTHH:MM'（5 分钟桶）
    path_group TEXT NOT NULL,         -- '/api/student/demands/:id'（去参数化路径）
    status_group TEXT NOT NULL,       -- 2xx/3xx/4xx/5xx
    count INTEGER NOT NULL DEFAULT 0,
    duration_sum INTEGER NOT NULL DEFAULT 0,
    slow_count INTEGER NOT NULL DEFAULT 0,
    rate_limited_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (bucket, path_group, status_group))`);
  await dbRun(db, 'CREATE INDEX IF NOT EXISTS idx_request_metrics_bucket ON request_metrics(bucket)');
  await dbRun(db, `DELETE FROM request_metrics WHERE bucket < ?`, [bucketOf(Date.now() - LIMITS.METRICS_RETENTION_DAYS * 24 * 3600 * 1000)]).catch(() => {});
}

/** 5 分钟 UTC 桶标签（单点；dashboard 与清理同口径） */
export function bucketOf(ts) {
  const d = new Date(ts);
  const p = x => String(x).padStart(2, '0');
  const minutes = d.getUTCMinutes() - (d.getUTCMinutes() % LIMITS.METRICS_BUCKET_MIN);
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(minutes)}`;
}

/** 去参数化路径组：先收邀请码长随机段，再收数字 id；其余单词段保留 */
export function metricPathGroup(path) {
  return path
    .replace(/\/api\/admin\/invites\/[A-Za-z0-9]+/g, '/api/admin/invites/:key')
    .replace(/\/\d+/g, '/:id');
}

const statusGroup = status => `${Math.floor(Number(status) / 100)}xx`;

/** 每请求调用（同步零阻塞）；health 不计 */
export function recordRequestMetric({ path, status, durationMs = 0, rateLimited = false }) {
  if (!path || !path.startsWith('/api/') || path === '/api/health') return;
  const key = `${metricPathGroup(path)}|${statusGroup(status)}`;
  let e = buckets.get(key);
  if (!e) { e = { count: 0, durationSum: 0, slowCount: 0, rateLimitedCount: 0 }; buckets.set(key, e); }
  e.count++;
  e.durationSum += Number(durationMs) || 0;
  if ((Number(durationMs) || 0) > LIMITS.SLOW_GET_MS) e.slowCount++;
  if (rateLimited) e.rateLimitedCount++;
}

/** 落库（ctx.waitUntil 托管；60s 节流）。swap 后 flush，途中新请求进新 Map 不丢失。 */
export async function flushMetrics(db, force = false) {
  const now = Date.now();
  if (!force && now - lastFlush < LIMITS.METRICS_FLUSH_MS) return;
  lastFlush = now;
  if (!buckets.size) return;
  const snapshot = [...buckets.entries()];
  buckets.clear();
  const bucket = bucketOf(now);
  const target = db;
  // 逐条 upsert（指标量小；失败静默——观测不能阻断业务）
  for (const [key, e] of snapshot) {
    const [pathGroup, sg] = key.split('|');
    try {
      await dbRun(target, `INSERT INTO request_metrics
          (bucket, path_group, status_group, count, duration_sum, slow_count, rate_limited_count)
        VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(bucket, path_group, status_group) DO UPDATE SET
          count = count + excluded.count,
          duration_sum = duration_sum + excluded.duration_sum,
          slow_count = slow_count + excluded.slow_count,
          rate_limited_count = rate_limited_count + excluded.rate_limited_count`,
        [bucket, pathGroup, sg, e.count, e.durationSum, e.slowCount, e.rateLimitedCount]);
    } catch { /* 指标失败静默 */ }
  }
}

/** dashboard 聚合查询（近 N 小时） */
export async function getDashboardMetrics(db, hours = 24) {
  const from = bucketOf(Date.now() - hours * 3600 * 1000);
  const rows = await dbAll(db, `SELECT bucket, path_group, status_group, count, duration_sum, slow_count, rate_limited_count
      FROM request_metrics WHERE bucket >= ?`, [from]);
  const total = { requests: 0, errors: 0, slow: 0, limited: 0, durationSum: 0 };
  const byPath = new Map();
  const byStatus = new Map();
  const byBucket = new Map();
  for (const r of rows) {
    const count = Number(r.count) || 0;
    total.requests += count;
    total.durationSum += Number(r.duration_sum) || 0;
    total.slow += Number(r.slow_count) || 0;
    total.limited += Number(r.rate_limited_count) || 0;
    if (r.status_group === '5xx') total.errors += count;
    byPath.set(r.path_group, (byPath.get(r.path_group) || 0) + count);
    byStatus.set(r.status_group, (byStatus.get(r.status_group) || 0) + count);
    const b = byBucket.get(r.bucket) || { requests: 0, errors: 0, slow: 0, limited: 0 };
    b.requests += count;
    if (r.status_group === '5xx') b.errors += count;
    b.slow += Number(r.slow_count) || 0;
    b.limited += Number(r.rate_limited_count) || 0;
    byBucket.set(r.bucket, b);
  }
  const topPaths = [...byPath.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([path_group, count]) => ({ path_group, count }));
  const status = [...byStatus.entries()].map(([status_group, count]) => ({ status_group, count })).sort((a, b) => a.status_group.localeCompare(b.status_group));
  const trend = [...byBucket.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([bucket, v]) => ({ bucket, ...v }));
  return {
    total: {
      requests: total.requests,
      errors: total.errors,
      slow: total.slow,
      limited: total.limited,
      avgMs: total.requests ? Math.round(total.durationSum / total.requests) : null,
    },
    topPaths, status, trend,
  };
}
