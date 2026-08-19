/**
 * v0.26.13 D1 GET 慢请求观测盲区（#311）—— logRequest 慢 GET 分支回归：
 *
 * 背景：原「GET 成功不入留档」（log.js 208 行 `if (method === 'GET' && status < 400) return;`）
 * 是观测盲区——慢 GET 是用户可感知的性能事故信号，但慢到底慢在哪无据可查（GET 成功不留档，
 * 只有写操作与失败请求留档）。修复：成功 GET 但 durationMs > LIMITS.SLOW_GET_MS（2000ms）也留档，
 * 低频慢请求撑不爆表。慢 GET 阈值进服务端 constants（LIMITS.SLOW_GET_MS）。
 *
 * 覆盖：
 *   - 快 GET（≤ 阈值）不入留档（保留原「读流量不撑表」语义）；
 *   - 慢 GET（> 阈值）入留档且 duration_ms 正确落库；
 *   - /api/health 无论快慢永远跳过（探活减噪）；
 *   - GET 无 durationMs 保守跳过（未知耗时不入留档）；
 *   - 写操作（POST 成功）仍正常留档（防跳过过宽误伤）。
 * 全部带 req 走真实路径：logEvent 挂请求级队列 → flushPendingLogs 一次 batch 落库。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initLogDb, logRequest, bindLogDb } from '../src/server/core/log.js';
import { TEST_SECRETS } from './_test-secrets.js';

function makeShim(raw, calls) {
  return {
    prepare(sql) {
      const st = { _sql: sql, _params: [], bind(...p) { st._params = p; return st; },
        all(...p) { calls.push('all:' + st._sql.slice(0, 30)); return { results: raw.prepare(st._sql).all(...(p.length ? p : st._params)) }; },
        first(...p) { calls.push('first:' + st._sql.slice(0, 30)); return raw.prepare(st._sql).get(...(p.length ? p : st._params)) ?? undefined; },
        run(...p) { calls.push('run:' + st._sql.slice(0, 30)); const info = raw.prepare(st._sql).run(...(p.length ? p : st._params)); return { meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } }; } };
      return st;
    },
    async batch(stmts) {
      calls.push('batch:' + stmts.length + 'stmts');
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

function setup(t) {
  const raw = new DatabaseSync(':memory:');
  const calls = [];
  const db = makeShim(raw, calls);
  bindLogDb(TEST_SECRETS); // 留档 detail 加密需 LOG_ENCRYPT_KEY（fail-open 已清，显式注入）
  t.after(() => { try { raw.close(); } catch { /* 已关 */ } });
  return { raw, db, calls };
}

const countHttp = (raw, action) =>
  raw.prepare("SELECT COUNT(*) AS c FROM activity_log WHERE action LIKE ?").get(action + '%').c;

const req = () => new Request('https://test.local/api/teachers');

test('快 GET（≤SLOW_GET_MS）不入留档', async (t) => {
  const { raw, db } = setup(t);
  await initLogDb(db);
  await logRequest(db, { method: 'GET', path: '/api/teachers', body: undefined, status: 200, req: req(), durationMs: 10 });
  assert.equal(countHttp(raw, 'http.GET'), 0, '快 GET 不入留档（读流量不撑表）');
});

test('慢 GET（>SLOW_GET_MS）入留档且 duration_ms 正确', async (t) => {
  const { raw, db } = setup(t);
  await initLogDb(db);
  await logRequest(db, { method: 'GET', path: '/api/teachers', body: undefined, status: 200, req: req(), durationMs: 3000 });
  assert.equal(countHttp(raw, 'http.GET'), 1, '慢 GET 留档');
  const row = raw.prepare("SELECT * FROM activity_log WHERE action LIKE 'http.GET%'").get();
  assert.equal(row.action, 'http.GET.ok');
  assert.equal(row.duration_ms, 3000, 'duration_ms 原值落库（慢 GET 可直接 SQL 直查）');
  assert.equal(row.entity, 'teachers', '实体提取正常');
});

test('/api/health 慢 GET 也跳过（探活减噪优先）', async (t) => {
  const { raw, db } = setup(t);
  await initLogDb(db);
  await logRequest(db, { method: 'GET', path: '/api/health', body: undefined, status: 200, req: req(), durationMs: 9999 });
  assert.equal(countHttp(raw, 'http.GET'), 0, 'health 探活永不留档');
});

test('GET 无 durationMs 保守跳过（未知耗时不入留档）', async (t) => {
  const { raw, db } = setup(t);
  await initLogDb(db);
  await logRequest(db, { method: 'GET', path: '/api/teachers', body: undefined, status: 200, req: req(), durationMs: undefined });
  assert.equal(countHttp(raw, 'http.GET'), 0, '无耗时数据不入留档');
});

test('写操作（POST 成功）仍正常留档（跳过未误伤写路径）', async (t) => {
  const { raw, db } = setup(t);
  await initLogDb(db);
  await logRequest(db, { method: 'POST', path: '/api/posts', body: { title: 'x' }, status: 200, req: req(), durationMs: 150 });
  assert.equal(countHttp(raw, 'http.POST'), 1, 'POST 成功留档');
  assert.equal(raw.prepare("SELECT action FROM activity_log WHERE action LIKE 'http.POST%'").get().action, 'http.POST.ok');
});
