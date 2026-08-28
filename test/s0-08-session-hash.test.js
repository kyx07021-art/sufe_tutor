/**
 * session choke mutation guards (in-place reuse of v2 core/session.js).
 *
 * Locks the token storage contract (F-04): auth_sessions stores only the SHA-256 digest of the
 * bearer token — never the plaintext and never a reversible form — plus the revoke/list lifecycle.
 * Device-dedup / multi-device behavior is already locked by test/session-device.test.js.
 *
 * Mutations (reverting each fix makes these assertions go red):
 * - issueAuthToken stores the raw token instead of tokenDigest(token) -> token_hash === token -> red
 * - revokeToken drops the WHERE user_id=? (cross-user revoke) -> another user's row is deleted -> red
 * - revokeToken stops returning whether a row changed -> idempotent second call reports true -> red
 * - listSessions adds token_hash/token to the SELECT -> digest/plaintext leaks into device list -> red
 *
 * Uses a real node:sqlite in-memory DB (same d1Shim as session-device.test.js).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import { issueAuthToken, revokeToken, getSessionByToken, listSessions, revokeSession } from '../src/server/core/session.js';
import { tokenDigest } from '../src/server/core/crypto.js';

// node:sqlite -> D1 shape shim (same as session-device.test.js)
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

const ENV = { ADMIN_USERNAMES: ['admin_sufe'], ADMIN_DEFAULT_PASSWORD: 'test-pw-123' };

async function setup() {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  await initDb(d1Shim(raw), ENV);
  const uid = raw.prepare("SELECT id FROM users WHERE username='admin_sufe'").get().id;
  return { raw, uid };
}

test('S0-08: token stored as SHA-256 digest, plaintext never persisted', async () => {
  const { raw, uid } = await setup();
  const db = d1Shim(raw);
  const token = await issueAuthToken(db, uid, 'Windows · Edge');
  const row = raw.prepare('SELECT token_hash FROM auth_sessions WHERE user_id=?').get(uid);
  assert.equal(row.token_hash, await tokenDigest(token), 'DB stores SHA-256(token) digest');
  assert.equal(row.token_hash.length, 64, 'digest is 64 hex chars');
  assert.notEqual(row.token_hash, token, 'plaintext token must never be stored (mutation: store raw token -> red)');
  assert.ok(!row.token_hash.includes(token), 'digest does not embed the plaintext');
});

test('S0-08 revokeToken: logout deletes own row, second revoke is a no-op', async () => {
  const { raw, uid } = await setup();
  const db = d1Shim(raw);
  const token = await issueAuthToken(db, uid, 'Windows · Edge');
  assert.ok(await getSessionByToken(db, uid, token), 'token resolves to a session');
  assert.equal(await revokeToken(db, uid, token), true, 'revoke hits the row');
  assert.equal(await revokeToken(db, uid, token), false, 'second revoke is a no-op -> false');
  assert.equal(await getSessionByToken(db, uid, token), undefined, 'token no longer resolves');
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM auth_sessions WHERE user_id=?').get(uid).n, 0, 'session row gone');
});

test('S0-08 revokeToken: cannot revoke another user token (mutation: drop user_id WHERE -> red)', async () => {
  const { raw, uid } = await setup();
  const db = d1Shim(raw);
  await db.prepare(`INSERT INTO users (username, password_hash, salt, role) VALUES ('other_user', 'x', 'salt', 'teacher')`).run();
  const oid = raw.prepare('SELECT id FROM users WHERE username=?').get('other_user').id;
  const otherToken = await issueAuthToken(db, oid, 'Android');
  await issueAuthToken(db, uid, 'Windows');
  assert.equal(await revokeToken(db, uid, otherToken), false, 'foreign token not revocable');
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM auth_sessions WHERE user_id=?').get(oid).n, 1, 'other user row intact');
});

test('S0-08 revokeToken: falsy token is a safe no-op (no db touch)', async () => {
  assert.equal(await revokeToken(null, 1, undefined), false, 'undefined token -> false, no throw');
  assert.equal(await revokeToken(null, 1, ''), false, 'empty token -> false');
});

test('S0-08 listSessions: never exposes token or token_hash', async () => {
  const { raw, uid } = await setup();
  const db = d1Shim(raw);
  await issueAuthToken(db, uid, 'Windows · Edge', 'a'.repeat(32));
  const sessions = await listSessions(db, uid);
  assert.equal(sessions.length, 1, 'one session listed');
  const s = sessions[0];
  assert.ok('session_id' in s, 'session_id present for device management');
  assert.ok(!('token' in s), 'raw token must not appear in list');
  assert.ok(!('token_hash' in s), 'token digest must not appear in list (mutation: add token_hash to SELECT -> red)');
});

test('S0-08 revokeSession: deletes by session_id (device-managed logout)', async () => {
  const { raw, uid } = await setup();
  const db = d1Shim(raw);
  await issueAuthToken(db, uid, 'Windows · Edge', 'a'.repeat(32));
  const s = (await listSessions(db, uid))[0];
  assert.equal(await revokeSession(db, uid, s.session_id), true, 'revoke by session_id');
  assert.equal(await revokeSession(db, uid, s.session_id), false, 'second revoke no-op');
});
