/**
 * 流量监测北京时区对齐（用户 2026-08-27）：activity_log ts 为库内 UTC（规则 42），
 * dbGetTrafficBuckets 经 strftime '+8 hours' 落北京小时/日期桶标签，与 handleAdminTraffic 的
 * from 边界 / fmtTrafficBucket 三处协同。UTC ts → 北京标签：05:00 UTC = 13:00 北京。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { dbGetTrafficBuckets } from '../src/server/core/log.js';

// D1 兼容 shim（同仓 admin-search-contract 同款）：dbAll 经 db.prepare().bind().all() 走
function d1Shim(raw) {
  return {
    prepare(sql) {
      const st = {
        _sql: sql, _params: [],
        bind(...p) { st._params = p; return st; },
        all(...p) { return { results: raw.prepare(st._sql).all(...(p.length ? p : st._params)) }; },
      };
      return st;
    },
  };
}

function setup() {
  const raw = new DatabaseSync(':memory:');
  raw.exec(`CREATE TABLE activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    ts TEXT NOT NULL,
    duration_ms INTEGER,
    detail TEXT,
    actor_username TEXT, actor_user_id INTEGER, entity TEXT, entity_id TEXT
  )`);
  const ins = raw.prepare('INSERT INTO activity_log (action, ts, duration_ms, detail) VALUES (?, ?, ?, ?)');
  // 北京 2026-08-27 13:00 = UTC 05:00；北京 14:00 = UTC 06:00；北京 2026-08-27 02:00 = UTC 2026-08-26 18:00
  ins.run('http.get', '2026-08-27 05:00:00', 120, 'a');
  ins.run('http.get', '2026-08-27 05:30:00', 180, 'b');
  ins.run('http.get', '2026-08-27 06:00:00', 200, 'c');
  ins.run('http.get', '2026-08-26 18:00:00', 100, 'd');
  ins.run('other.action', '2026-08-27 05:00:00', 50, 'x'); // 非 http.* 不计入
  return { db: d1Shim(raw), raw };
}

test('流量桶北京时区：UTC ts 经 +8 落北京小时标签，非 http 动作排除', async () => {
  const { db, raw } = setup();
  const rows = await dbGetTrafficBuckets(db, 'hour', '2026-08-26 18:00:00');
  const map = new Map(rows.map(r => [r.bucket, r]));
  assert.equal(map.get('2026-08-27 13:00').requests, 2, 'UTC 05:00/05:30 → 北京 13:00 桶（2 请求）');
  assert.equal(map.get('2026-08-27 13:00').avg_ms, 150, 'AVG(120,180) = 150');
  assert.equal(map.get('2026-08-27 14:00').requests, 1, 'UTC 06:00 → 北京 14:00 桶');
  assert.equal(map.get('2026-08-27 02:00').requests, 1, 'UTC 2026-08-26 18:00 → 北京 2026-08-27 02:00 桶（跨日）');
  assert.ok(!map.has('2026-08-27 05:00'), '桶标签为北京时刻非 UTC 时刻');
  assert.equal([...rows].reduce((s, r) => s + r.requests, 0), 4, '非 http.* 不计入');
  raw.close();
});

test('流量桶日粒度：UTC 跨日 ts 落北京日期标签', async () => {
  const { db, raw } = setup();
  const rows = await dbGetTrafficBuckets(db, 'day', '2026-08-25 00:00:00');
  const labels = rows.map(r => r.bucket);
  assert.ok(labels.includes('2026-08-27'), '北京日期 2026-08-27 出现（UTC 05:00 属当日）');
  assert.ok(!labels.includes('2026-08-26'), 'UTC 2026-08-26 18:00 → 北京 2026-08-27 02:00，属 27 日桶，26 日桶不应出现');
  raw.close();
});
