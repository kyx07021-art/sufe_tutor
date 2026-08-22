/**
 * S0-09 danger-ops capToken choke mutation guards (new-site foundation, in-place reuse of
 * v2 core/danger-ops.js).
 *
 * Locks the capToken persistence contract (Z-1-F1 / N-02 / S0-09 acceptance): a capToken is
 * D1-persisted as a SHA-256 digest, bound to the issuing session, and consumed by an atomic
 * DELETE (hit-and-delete). The critical guard here is the Z-1-F1 fix — when the danger_caps
 * INSERT fails, issueCapToken must return '' (a dead token handed back would let re-auth report
 * success while the follow-up dangerous operation fails 403).
 *
 * Mutations (reverting each fix makes these assertions go red):
 *   - issueCapToken drops the try/catch around the INSERT -> a DB failure returns a non-empty
 *     dead token -> assert(cap === '') red
 *   - confirmDangerOtp becomes non-atomic (SELECT the row and return, no DELETE) -> the same
 *     token passes a second time -> one-time assertion red
 *   - confirmDangerOtp drops session binding (WHERE without session_id) -> another device's
 *     session can consume the cap -> red
 *   - clearDangerCaps stops deleting -> confirm after logout still passes -> red
 *
 * Uses a real node:sqlite in-memory DB (same d1Shim + initDb as session-device.test.js / s0-08).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import {
  initDangerCaps, issueCapToken, confirmDangerOtp, clearDangerCaps, clearDangerCapsForSession,
} from '../src/server/core/danger-ops.js';
import { issueAuthToken, getSessionByToken } from '../src/server/core/session.js';
import { bindCryptoEnv } from '../src/server/core/crypto.js';
import { TEST_SECRETS } from './_test-secrets.js';

// node:sqlite -> D1 shape shim (same as session-device.test.js / s0-08)
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

// db variant that makes the danger_caps INSERT fail (simulates a transient D1 write failure).
// bind() returns `this` so the run() interception survives the prepare().bind().run() chain.
function failingInsertDb(raw) {
  const base = d1Shim(raw);
  return {
    prepare(sql) {
      const st = base.prepare(sql);
      return {
        _sql: sql,
        bind(...p) { st.bind(...p); return this; },
        all(...p) { return st.all(...p); },
        first(...p) { return st.first(...p); },
        run(...p) {
          if (/INSERT INTO danger_caps/i.test(sql)) throw new Error('simulated D1 insert failure (S0-09)');
          return st.run(...p);
        },
      };
    },
    batch(stmts) { return base.batch(stmts); },
  };
}

const ENV = { ADMIN_USERNAMES: ['admin_sufe'], ADMIN_DEFAULT_PASSWORD: 'test-pw-123' };

function reqFor(token) {
  return { headers: { get: h => (h === 'X-Auth-Token' ? token : null) } };
}

async function setup() {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  const db = d1Shim(raw);
  await initDb(db, ENV);
  bindCryptoEnv(TEST_SECRETS);
  const uid = raw.prepare("SELECT id FROM users WHERE username='admin_sufe'").get().id;
  const tokenA = await issueAuthToken(db, uid, 'dev-A');
  const tokenB = await issueAuthToken(db, uid, 'dev-B'); // second device, distinct session
  return { raw, db, uid, tokenA, tokenB };
}

test('S0-09 initDangerCaps: idempotent table creation', async () => {
  const { raw, db } = await setup();
  await initDangerCaps(db); // already created by initDb; running again must not throw
  await initDangerCaps(db);
  const row = raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='danger_caps'").get();
  assert.ok(row, 'danger_caps table exists');
});

test('S0-09 issueCapToken/confirmDangerOtp: round-trip on the issuing session', async () => {
  const { db, tokenA } = await setup();
  const cap = await issueCapToken(db, reqFor(tokenA));
  assert.ok(cap && cap.length >= 20, 'issue returns a plaintext capToken');
  assert.equal(await confirmDangerOtp(db, reqFor(tokenA), { capToken: cap }), true, 'confirm on the issuing session');
});

test('S0-09 confirmDangerOtp: one-time atomic DELETE consumes the token (mutation: non-atomic SELECT -> red)', async () => {
  const { db, tokenA } = await setup();
  const cap = await issueCapToken(db, reqFor(tokenA));
  assert.equal(await confirmDangerOtp(db, reqFor(tokenA), { capToken: cap }), true, 'first confirm passes');
  assert.equal(await confirmDangerOtp(db, reqFor(tokenA), { capToken: cap }), false,
    'second confirm must fail — a SELECT-then-return (non-atomic) impl would pass again (red)');
});

test('S0-09 confirmDangerOtp: capToken is session-bound (mutation: drop session_id WHERE -> red)', async () => {
  const { db, tokenA, tokenB } = await setup();
  const cap = await issueCapToken(db, reqFor(tokenA));
  assert.equal(await confirmDangerOtp(db, reqFor(tokenB), { capToken: cap }), false,
    'a different device session must not reuse the cap (mutation: unbounded by session -> red)');
  assert.equal(await confirmDangerOtp(db, reqFor(tokenA), { capToken: cap }), true,
    'the issuing session can still consume its own cap (failed cross-session attempt is non-destructive)');
});

test('S0-09 issueCapToken: DB write failure returns "" not a dead token (Z-1-F1; mutation: drop catch -> red)', async () => {
  const { raw, db, tokenA } = await setup();
  const failing = failingInsertDb(raw); // auth/session reads work; danger_caps INSERT throws
  const cap = await issueCapToken(failing, reqFor(tokenA));
  assert.equal(cap, '',
    'INSERT failure must yield "" — a non-empty dead token would fake a re-auth success then 403 (red)');
  const rows = raw.prepare('SELECT COUNT(*) AS c FROM danger_caps').get();
  assert.equal(Number(rows.c), 0, 'no dangling danger_caps row on failed insert');
});

test('S0-09 clearDangerCaps: logout cleanup invalidates every cap of the user', async () => {
  const { db, uid, tokenA, tokenB } = await setup();
  const capA = await issueCapToken(db, reqFor(tokenA));
  const capB = await issueCapToken(db, reqFor(tokenB));
  await clearDangerCaps(db, uid);
  assert.equal(await confirmDangerOtp(db, reqFor(tokenA), { capToken: capA }), false, 'session A cap cleared');
  assert.equal(await confirmDangerOtp(db, reqFor(tokenB), { capToken: capB }), false, 'session B cap cleared');
});

test('S0-09 clearDangerCapsForSession: clears only the targeted session cap', async () => {
  const { db, uid, tokenA, tokenB } = await setup();
  const capA = await issueCapToken(db, reqFor(tokenA));
  const capB = await issueCapToken(db, reqFor(tokenB));
  const sidB = (await getSessionByToken(db, uid, tokenB)).session_id;
  await clearDangerCapsForSession(db, uid, sidB);
  assert.equal(await confirmDangerOtp(db, reqFor(tokenA), { capToken: capA }), true, 'session A cap unaffected');
  assert.equal(await confirmDangerOtp(db, reqFor(tokenB), { capToken: capB }), false, 'session B cap cleared');
});
