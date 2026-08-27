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

// 2026-08-27 用户反馈「流量监测表单包含未来时间」：handleAdminTraffic 的 nowMs 预加 BEIJING_OFFSET_MS
// 与 fmtTrafficBucket 的 +8 双重移位 → 窗口整体前移 8h（生产 24h 桶 17:00→00:00 全未来空桶实证）。
// 修复 = 抽取 trafficWindow 纯函数，now 传真实 epoch（UTC），标签经 fmtTrafficBucket(+8h) 单次转北京。
import { trafficWindow } from '../src/server/domains/admin/api.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const adminApiSrc = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/server/domains/admin/api.js'), 'utf8');

test('流量窗口北京时区：末标签=当前北京小时，零未来标签（双重+8 修复锁定）', () => {
  const now = Date.UTC(2026, 7, 27, 8, 20, 0); // 北京 2026-08-27 16:20
  const { fromTs, labels } = trafficWindow(now, 'hour', 24);
  assert.equal(fromTs, '2026-08-26 09:00:00', 'UTC 边界 = 窗口首桶对应 UTC 时刻（北京 17:00 前一日）');
  assert.equal(labels.length, 24);
  assert.equal(labels[0], '2026-08-26 17:00', '首标签 = 北京 2026-08-26 17:00');
  assert.equal(labels[23], '2026-08-27 16:00', '末标签 = 当前北京小时 16:00（零未来）');
  assert.ok(!labels.some(l => l > '2026-08-27 16:00'), '无未来标签（还原预加偏移 → 末标签 2026-08-28 00:00 → 红）');
});

test('流量窗口日粒度：末标签=当前北京日期，零未来日期', () => {
  const now = Date.UTC(2026, 7, 27, 8, 20, 0); // 北京 2026-08-27 16:20
  const { fromTs, labels } = trafficWindow(now, 'day', 7);
  assert.equal(fromTs, '2026-08-21 00:00:00', 'UTC 边界 = 7 日前 UTC 零点');
  assert.equal(labels.length, 7);
  assert.equal(labels[6], '2026-08-27', '末标签 = 当前北京日期（零未来）');
  assert.ok(!labels.some(l => l > '2026-08-27'), '无未来日期');
});

test('流量窗口调用点零预加偏移（源级契约：now 传真实 epoch，双 +8 禁止回归）', () => {
  assert.match(adminApiSrc, /trafficWindow\(Date\.now\(\),\s*unit,\s*n\)/,
    'handler 传原始 Date.now()（变异：改回 + BEIJING_OFFSET_MS → 红）');
  assert.ok(!/Date\.now\(\)\s*\+\s*BEIJING_OFFSET_MS/.test(adminApiSrc),
    '无 nowMs 预加偏移（双 +8 回归即红）');
  assert.ok(!/const nowMs/.test(adminApiSrc), 'nowMs 局部变量已删除（重构残留即红）');
});
