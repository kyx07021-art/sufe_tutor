/**
 * S0-11 tool layer (util.js/json.js) single-point locks.
 *
 * Covers the util.js/json.js acceptance surface with mutation guards:
 *   - ensureColumns: PRAGMA-probe-then-ALTER idempotency (mutation: unconditional
 *     ALTER TABLE ADD COLUMN on an existing column throws duplicate-column error → red)
 *   - parseBody: streaming 413 hard limit — a chunked body (no usable Content-Length)
 *     larger than LIMITS.BODY_LIMIT must be rejected with status 413 before JSON.parse
 *     (mutation: drop the streaming accumulator check → the over-limit chunked body
 *     resolves instead of throwing 413 → red)
 *   - toDbTime: UTC single-point (mutation: local-time formatting shifts the epoch →
 *     red on any non-UTC host)
 * parseIdParam strictness is already locked by test/parse-id-param.test.js (Q-2a-L2);
 * safeJsonArray/safeJsonObject by test/json-safe.test.js (Z-13-F3).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { ensureColumns, parseBody, toDbTime } from '../src/server/core/util.js';
import { LIMITS } from '../src/shared/config.js';

function d1Shim(raw) {
  return {
    prepare(sql) {
      const st = { _sql: sql, _params: [],
        bind(...p) { st._params = p; return st; },
        all(...p) { return { results: raw.prepare(st._sql).all(...(p.length ? p : st._params)) }; },
        first(...p) { return raw.prepare(st._sql).get(...(p.length ? p : st._params)) ?? undefined; },
        run(...p) { const info = raw.prepare(st._sql).run(...(p.length ? p : st._params)); return { meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } }; } };
      return st;
    },
    async batch(stmts) {
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

test('ensureColumns：PRAGMA 探测后仅对缺列 ALTER——重复加列幂等不炸', async () => {
  const raw = new DatabaseSync(':memory:');
  try {
    raw.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, a TEXT)');
    const db = d1Shim(raw);
    await ensureColumns(db, 't', [['b', 'TEXT'], ['c', 'INTEGER NOT NULL DEFAULT 0']]);
    let cols = raw.prepare('PRAGMA table_info(t)').all().map(c => c.name);
    assert.deepEqual(cols, ['id', 'a', 'b', 'c'], '新列补齐');
    // 幂等：再次以同一组列调用，已存在列绝不重复 ALTER（变异：无条件 ALTER → duplicate column name 抛错 → 红）
    await ensureColumns(db, 't', [['b', 'TEXT'], ['c', 'INTEGER NOT NULL DEFAULT 0']]);
    await ensureColumns(db, 't', [['b', 'TEXT']]);
    cols = raw.prepare('PRAGMA table_info(t)').all().map(c => c.name);
    assert.deepEqual(cols, ['id', 'a', 'b', 'c'], '重复调用后列集不变（无重复列）');
  } finally { raw.close(); }
});

test('ensureColumns：缺列时才补列——混合已存在/缺失列各就各位', async () => {
  const raw = new DatabaseSync(':memory:');
  try {
    raw.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, a TEXT)');
    const db = d1Shim(raw);
    await ensureColumns(db, 't', [['a', 'TEXT'], ['b', 'TEXT']]);
    const cols = raw.prepare('PRAGMA table_info(t)').all().map(c => c.name);
    assert.deepEqual(cols, ['id', 'a', 'b'], 'a 已存在跳过、b 补上');
  } finally { raw.close(); }
});

test('parseBody：chunked 超限 body（无 Content-Length）被流式硬上限 413 拦截', async () => {
  // No Content-Length header → the cheap CL shortcut cannot fire; only the streaming
  // accumulator can stop it. Mutation: remove the streaming check → resolves → red.
  const over = new Uint8Array(LIMITS.BODY_LIMIT + 2000);
  const req = new Request('https://test.local/api/posts', {
    method: 'POST',
    duplex: 'half',
    body: new ReadableStream({ start(c) { c.enqueue(over); c.close(); } }),
  });
  assert.equal(req.headers.get('Content-Length'), null, 'chunked request carries no Content-Length');
  await assert.rejects(parseBody(req), e => e && e.status === 413, 'chunked over-limit body must throw {status:413}');
});

test('parseBody：Content-Length 超限快路径同样 413', async () => {
  const req = new Request('https://test.local/api/posts', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Content-Length': String(LIMITS.BODY_LIMIT + 100) },
    body: JSON.stringify({ text: 'x'.repeat(LIMITS.BODY_LIMIT) }),
  });
  await assert.rejects(parseBody(req), e => e && e.status === 413, 'CL over-limit must throw {status:413}');
});

test('parseBody：合法小 body 正常解析为对象；GET 无体返回空对象', async () => {
  const req = new Request('https://test.local/api/posts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'hello', n: 3 }),
  });
  assert.deepEqual(await parseBody(req), { text: 'hello', n: 3 });
  const get = new Request('https://test.local/api/posts', { method: 'GET' });
  assert.deepEqual(await parseBody(get), {}, '非写方法无体');
});

test('toDbTime：UTC 单点——epoch 与固定时刻的 UTC 输出', () => {
  // Mutation: formatting via local-time (toLocaleString / Date local getters) shifts the
  // epoch by the host offset (UTC+8 → 1970-01-01 08:00:00) → red on any non-UTC host.
  assert.equal(toDbTime(new Date(0)), '1970-01-01 00:00:00', 'epoch 输出 UTC 而非本地时');
  assert.equal(toDbTime(new Date('2026-08-22T12:34:56.789Z')), '2026-08-22 12:34:56', '固定 UTC 时刻逐位一致');
  assert.match(toDbTime(new Date()), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, '格式恒为 YYYY-MM-DD HH:MM:SS');
});
