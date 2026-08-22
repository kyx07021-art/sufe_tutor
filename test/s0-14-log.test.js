/**
 * S0-14 log choke mutation guards (new-site foundation, in-place reuse of v2 core/log.js).
 *
 * Locks the audit-log write contract (E1 / Q-2b-F3 / B4 / S0-14 acceptance): every semantic
 * event lands in activity_log with its detail AES-encrypted at rest, sensitive keys stripped
 * before encryption, a request-level batch flush (1 round-trip), an observable dropped-counter
 * when a write is swallowed, and — when bound — an independent LOG_DB that keeps audit rows out
 * of the business database.
 *
 * Mutations (reverting each fix makes these assertions go red):
 *   - logEvent drops encryptDetail -> stored detail is plaintext JSON, encrypted=0 -> red
 *   - logEvent drops the sanitize pass -> phone/email round-trip in plaintext -> red
 *   - logEvent drops droppedLogs++ -> logDropStats stays flat after a swallowed failure -> red
 *   - logEvent writes immediately even with req -> a deferred row appears before logRequest -> red
 *   - getLogDb ignores LOG_DB_OVERRIDE -> a bound row lands in the business db instead -> red
 *   - queryLog stops decrypting on read -> returned detail is ciphertext -> red
 *
 * Uses a real node:sqlite in-memory DB (same d1Shim as s0-08). LOG_DB_OVERRIDE / droppedLogs /
 * crypto KEY_CACHE are module-level state — every test rebinds the env first (node:test runs
 * tests in a file sequentially).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  initLogDb, logEvent, logRequest, logDropStats, bindLogDb, queryLog, dbGetTrafficBuckets,
} from '../src/server/core/log.js';
import { decryptDetail } from '../src/server/core/crypto.js';
import { toDbTime } from '../src/server/core/util.js';
import { TEST_SECRETS } from './_test-secrets.js';

// node:sqlite -> D1 shape shim (same as s0-08 / session-device.test.js)
function d1Shim(raw) {
  return {
    prepare(sql) {
      const st = {
        _sql: sql, _params: [],
        bind(...p) { st._params = p; return st; },
        all(...p) { return { results: raw.prepare(st._sql).all(...(p.length ? p : st._params)) }; },
        first(...p) { return raw.prepare(st._sql).get(...(p.length ? p : st._params)) ?? undefined; },
        run(...p) {
          const info = raw.prepare(st._sql).run(...(p.length ? p : st._params));
          return { meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
        },
      };
      return st;
    },
    async batch(stmts) {
      raw.exec('BEGIN');
      try {
        const out = [];
        for (const s of stmts) {
          if (/^\s*(SELECT|PRAGMA|WITH|EXPLAIN)/i.test(s._sql)) out.push({ results: raw.prepare(s._sql).all(...s._params) });
          else {
            const info = raw.prepare(s._sql).run(...s._params);
            out.push({ meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } });
          }
        }
        raw.exec('COMMIT');
        return out;
      } catch (e) {
        try { raw.exec('ROLLBACK'); } catch { /* ignore */ }
        throw e;
      }
    },
  };
}

async function setup(t) {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  const db = d1Shim(raw);
  bindLogDb(TEST_SECRETS); // no LOG_DB -> writes fall back to the business db; crypto keys set
  await initLogDb(db);
  t.after(() => { try { raw.close(); } catch { /* already closed */ } });
  return { raw, db };
}

test('S0-14 logEvent: detail stored AES-encrypted, never plaintext (mutation: drop encryptDetail -> red)', async (t) => {
  const { raw, db } = await setup(t);
  await logEvent(db, {
    action: 'auth.login.success', actorUserId: 7, entity: 'users', entityId: 7,
    detail: { method: 'password' },
  });
  const row = raw.prepare("SELECT * FROM activity_log WHERE action='auth.login.success'").get();
  assert.equal(Number(row.encrypted), 1, 'encrypted flag set');
  assert.equal(Number(row.schema_v), 2, 'schema_v=2 (encrypted detail scheme)');
  assert.ok(String(row.detail).startsWith('enc:v1:'), 'stored detail is ciphertext, not plaintext JSON');
  assert.ok(!String(row.detail).includes('method'), 'plaintext must not leak into the stored cell');
  assert.deepEqual(JSON.parse(await decryptDetail(row.detail)), { method: 'password' }, 'round-trips to the original');
});

test('S0-14 logEvent: sensitive keys stripped before encryption (mutation: drop sanitize -> red)', async (t) => {
  const { raw, db } = await setup(t);
  await logEvent(db, {
    action: 'admin.ban', actorUserId: 1,
    detail: { username: 'u1', phone: '13800138000', email: 'a@b.co', note: 'ok' },
  });
  const row = raw.prepare("SELECT detail FROM activity_log WHERE action='admin.ban'").get();
  const dec = JSON.parse(await decryptDetail(row.detail));
  assert.equal(dec.phone, '[redacted]', 'phone redacted (mutation: no sanitize -> plaintext -> red)');
  assert.equal(dec.email, '[redacted]', 'email redacted');
  assert.equal(dec.username, 'u1', 'non-sensitive field preserved');
  assert.equal(dec.note, 'ok');
});

test('S0-14 logDropStats: swallowed log failure increments the dropped counter (E1; mutation: drop counter -> red)', async (t) => {
  const { raw, db } = await setup(t);
  bindLogDb({ LOG_ENCRYPT_KEY: '!!not-base64!!' }); // encryptDetail throws -> logEvent swallows
  const before = logDropStats().dropped;
  await logEvent(db, { action: 'auth.login.success', detail: { x: 1 } });
  const after = logDropStats().dropped;
  assert.ok(after > before, 'dropped counter must increment when a write is swallowed (mutation: no ++ -> red)');
  assert.equal(Number(raw.prepare('SELECT COUNT(*) AS c FROM activity_log').get().c), 0,
    'nothing stored when encryption fails (fail-closed: no plaintext row)');
});

test('S0-14 bindLogDb: independent LOG_DB receives writes, business db untouched (mutation: ignore LOG_DB -> red)', async (t) => {
  const bizRaw = new DatabaseSync(':memory:');
  bizRaw.exec('PRAGMA foreign_keys = ON');
  const biz = d1Shim(bizRaw);
  const logRaw = new DatabaseSync(':memory:');
  const log = d1Shim(logRaw);
  t.after(() => { try { bizRaw.close(); } catch { /* ignore */ } try { logRaw.close(); } catch { /* ignore */ } });

  bindLogDb({ ...TEST_SECRETS, LOG_DB: log });
  await initLogDb(log); // independent log schema
  await initLogDb(biz); // business db also has the table, but writes must route to LOG_DB

  await logEvent(biz, { action: 'demand.create', actorUserId: 1, entity: 'demands', entityId: 5, detail: { title: 't' } });

  assert.equal(Number(logRaw.prepare("SELECT COUNT(*) AS c FROM activity_log WHERE action='demand.create'").get().c), 1,
    'row lands in the independent LOG_DB');
  assert.equal(Number(bizRaw.prepare("SELECT COUNT(*) AS c FROM activity_log WHERE action='demand.create'").get().c), 0,
    'business db untouched while LOG_DB is bound (mutation: getLogDb ignores override -> red)');
});

test('S0-14 logEvent with req defers write until logRequest flushes (B4 one-round-trip; mutation: eager write -> red)', async (t) => {
  const { raw, db } = await setup(t);
  const r = new Request('https://test.local/api/teachers');
  await logEvent(db, { action: 'test.deferred', req: r, detail: { n: 1 } });
  assert.equal(Number(raw.prepare('SELECT COUNT(*) AS c FROM activity_log').get().c), 0,
    'deferred — no row until the request-level flush (mutation: eager write -> red)');
  await logRequest(db, { method: 'GET', path: '/api/teachers', body: undefined, status: 200, req: r, durationMs: 3000 });
  const actions = raw.prepare('SELECT action FROM activity_log').all().map(x => x.action);
  assert.ok(actions.includes('test.deferred'), 'business log flushed together with the access log');
  assert.ok(actions.includes('http.GET.ok'), 'slow GET access log written on flush');
});

test('S0-14 queryLog: filters by action/entity and decrypts detail on read (mutation: no decrypt -> red)', async (t) => {
  const { raw, db } = await setup(t);
  await logEvent(db, { action: 'auth.login.success', actorUserId: 7, entity: 'users', entityId: 7, detail: { m: 'password' } });
  await logEvent(db, { action: 'demand.create', actorUserId: 7, entity: 'demands', entityId: 42, detail: { t: '数学' } });
  const res = await queryLog(db, { action: 'auth.login' });
  assert.equal(res.rows.length, 1, 'action prefix filter');
  assert.equal(res.rows[0].entity, 'users');
  assert.ok(!String(res.rows[0].detail).startsWith('enc:v1:'), 'detail decrypted on read (mutation: raw ciphertext -> red)');
  assert.deepEqual(JSON.parse(res.rows[0].detail), { m: 'password' });
  const byEntity = await queryLog(db, { entity: 'demands' });
  assert.equal(byEntity.rows.length, 1);
  assert.equal(byEntity.rows[0].entity_id, '42'); // column is entity_id (snake_case)
});

test('S0-14 queryLog: q searches decrypted detail text', async (t) => {
  const { raw, db } = await setup(t);
  await logEvent(db, { action: 'demand.create', entity: 'demands', detail: { title: '高等数学辅导' } });
  await logEvent(db, { action: 'demand.create', entity: 'demands', detail: { title: '英语口语' } });
  const res = await queryLog(db, { action: 'demand.create', q: '高等数学' });
  assert.equal(res.rows.length, 1, 'q matches decrypted detail');
  assert.deepEqual(JSON.parse(res.rows[0].detail), { title: '高等数学辅导' });
});

test('S0-14 dbGetTrafficBuckets: aggregates http.* access rows into buckets', async (t) => {
  const { raw, db } = await setup(t);
  const ts = new Date();
  const dbTs = ts.toISOString().slice(0, 19).replace('T', ' ');
  raw.prepare("INSERT INTO activity_log (action, duration_ms, ts) VALUES (?,?,?)").run('http.GET.ok', 10, dbTs);
  raw.prepare("INSERT INTO activity_log (action, duration_ms, ts) VALUES (?,?,?)").run('http.GET.ok', 30, dbTs);
  raw.prepare("INSERT INTO activity_log (action, duration_ms, ts) VALUES (?,?,?)").run('auth.login.ok', 5, dbTs); // non-http: excluded
  const from = toDbTime(new Date(ts.getTime() - 3600 * 1000));
  const rows = await dbGetTrafficBuckets(db, 'hour', from);
  assert.equal(rows.length, 1, 'one bucket for the http.* rows in range');
  assert.equal(Number(rows[0].requests), 2, 'counts only http.* rows (auth.login excluded)');
  assert.equal(Number(rows[0].avg_ms), 20, 'average duration of the http rows');
});
