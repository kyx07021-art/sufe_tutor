/**
 * v1.5.0 观测指标层（server/telemetry.js）：
 *   - 路径去参数化 / 状态分组 / 5 分钟桶；
 *   - 内存计数 → flush 聚合表 → dashboard 汇总。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { bucketOf, metricPathGroup, recordRequestMetric, flushMetrics, getDashboardMetrics, initMetrics } from '../server/telemetry.js';

function d1Shim(raw) {
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
      try { const out = [];
        for (const s of stmts) {
          if (/^\s*(SELECT|PRAGMA|WITH|EXPLAIN)/i.test(s._sql)) out.push({ results: raw.prepare(s._sql).all(...s._params) });
          else { const info = raw.prepare(s._sql).run(...s._params); out.push({ meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } }); }
        }
        raw.exec('COMMIT'); return out;
      } catch (e) { try { raw.exec('ROLLBACK'); } catch { /* ignore */ } throw e; }
    },
  };
}

test('路径去参数化与桶标签', () => {
  assert.equal(metricPathGroup('/api/student/demands/42'), '/api/student/demands/:id');
  assert.equal(metricPathGroup('/api/conversations/12/messages'), '/api/conversations/:id/messages');
  assert.equal(metricPathGroup('/api/admin/invites/ABCDEFGH'), '/api/admin/invites/:key');
  assert.match(bucketOf(Date.UTC(2026, 7, 16, 10, 37)), /2026-08-16T10:35$/);
});

test('内存计数 flush 后 dashboard 可读，health 不计', async () => {
  const raw = new DatabaseSync(':memory:');
  const db = d1Shim(raw);
  await initMetrics(db);
  recordRequestMetric({ path: '/api/health', status: 200 });
  recordRequestMetric({ path: '/api/teachers', status: 200, durationMs: 120 });
  recordRequestMetric({ path: '/api/teachers', status: 200, durationMs: 2400 });
  recordRequestMetric({ path: '/api/student/demands/7', status: 500, durationMs: 80 });
  recordRequestMetric({ path: '/api/auth/login', status: 429, rateLimited: true });
  await flushMetrics(db, true);
  const m = await getDashboardMetrics(db, 24);
  assert.equal(m.total.requests, 4, 'health 不计');
  assert.equal(m.total.errors, 1, '5xx 计入异常');
  assert.equal(m.total.slow, 1, '慢请求计数');
  assert.equal(m.total.limited, 1, '限流命中计数');
  assert.equal(m.total.avgMs, Math.round((120 + 2400 + 80 + 0) / 4));
  assert.equal(m.topPaths[0].path_group, '/api/teachers');
  assert.deepEqual(m.status.map(s => s.status_group).sort(), ['2xx', '4xx', '5xx']);
});
