/**
 * S0-16 notify read / mark-read endpoints (new-site foundation, in-place reuse of v2 core/notify.js).
 *
 * Locks the S0-16 acceptance surface (I-26/27):
 *   - handleGetNotifications returns { notifications: [...] } with each row's params parsed back
 *     to an object via the single-point mapper (safeJsonObject); corrupt params JSON degrades to
 *     null instead of crashing the endpoint.
 *   - handleMarkNotificationRead / handleMarkAllNotificationsRead enforce ownership: the UPDATE
 *     is always scoped to the caller's user_id. A cross-user call is an idempotent ok with
 *     0 rows flipped — it must never error and never touch another user's read state.
 *   - Unauthenticated callers get 401; an unknown/already-read id is an idempotent 200.
 *
 * Mutations (reverting each fix makes these assertions go red):
 *   - mapNotification reverts to raw JSON.parse (no fallback) -> corrupt params row throws -> 500 -> red.
 *   - dbMarkNotificationRead drops `AND user_id=?` -> a cross-user call flips the owner row -> red.
 *   - handleMarkAllNotificationsRead drops `user_id=?` -> clears every user's unread -> red.
 */
import { test } from 'node:test';
import { TEST_SECRETS } from './_test-secrets.js';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import {
  notifyUser, handleGetNotifications, handleMarkNotificationRead, handleMarkAllNotificationsRead,
} from '../src/server/core/notify.js';
import { tokenDigest } from '../src/server/core/crypto.js';

const ENV = { ...TEST_SECRETS, ADMIN_USERNAMES: ['admin_sufe'], ADMIN_DEFAULT_PASSWORD: 'test-pw-123' };

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
          else { const info = raw.prepare(s._sql).run(...s._params); out.push({ meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } }); }
        }
        raw.exec('COMMIT');
        return out;
      } catch (e) { try { raw.exec('ROLLBACK'); } catch { /* ignore */ } throw e; }
    },
  };
}
const rawOf = () => { const r = new DatabaseSync(':memory:'); r.exec('PRAGMA foreign_keys = ON'); return r; };
const reqOf = token => ({ headers: new Headers({ 'X-Auth-Token': token }) });

async function seed(db, raw) {
  await initDb(db, ENV);
  raw.exec(`INSERT INTO users (username,password_hash,salt,role) VALUES ('a','h','s','student'),('b','h','s','teacher')`);
  const idOf = name => raw.prepare('SELECT id FROM users WHERE username=?').get(name).id;
  const a = idOf('a'), b = idOf('b');
  const mkToken = async name => {
    const token = `${name}-token`;
    raw.prepare('INSERT INTO auth_sessions (token_hash,user_id,label,expires_at) VALUES (?,?,?,?)')
      .run(await tokenDigest(token), idOf(name), 'x', '2099-01-01 00:00:00');
    return token;
  };
  return { a, b, aToken: await mkToken('a'), bToken: await mkToken('b') };
}

test('S0-16 handleGetNotifications: list shape { notifications } with params parsed by mapper', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { a, aToken } = await seed(db, raw);
  await notifyUser(db, a, 'CONTRACT_DRAFT_SENT', { name: '张老师' });
  const res = await handleGetNotifications(db, reqOf(aToken));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.notifications), 'body carries { notifications: [...] }');
  assert.equal(body.notifications.length, 1);
  assert.equal(body.notifications[0].type, 'CONTRACT_DRAFT_SENT');
  assert.deepEqual(body.notifications[0].params, { name: '张老师' }, 'params parsed back to an object');
});

test('S0-16 handleGetNotifications: corrupt params JSON degrades to null (no 500)', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { a, aToken } = await seed(db, raw);
  raw.prepare("INSERT INTO notifications (user_id, text, type, params) VALUES (?, '', 'BROADCAST', ?)").run(a, '{{{not-json');
  const res = await handleGetNotifications(db, reqOf(aToken));
  assert.equal(res.status, 200,
    'corrupt params must not crash the endpoint (mutation: raw JSON.parse -> 500 -> red)');
  const body = await res.json();
  assert.equal(body.notifications[0].params, null, 'safeJsonObject single-point fallback to null');
});

test('S0-16 handleGetNotifications: unauthenticated -> 401', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  await seed(db, raw);
  const res = await handleGetNotifications(db, reqOf('no-token'));
  assert.equal(res.status, 401);
});

test('S0-16 mark-read ownership: cross-user call is ok with 0 rows flipped (no leakage)', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { a, bToken } = await seed(db, raw);
  await notifyUser(db, a, 'INTENT_ACCEPTED', {});
  const nA = raw.prepare('SELECT id FROM notifications WHERE user_id=?').get(a).id;
  const res = await handleMarkNotificationRead(db, nA, reqOf(bToken));
  assert.equal(res.status, 200, 'cross-user call returns idempotent ok, never errors');
  assert.equal(raw.prepare('SELECT is_read FROM notifications WHERE id=?').get(nA).is_read, 0,
    'owner row stays unread (mutation: drop user_id from UPDATE -> flipped -> red)');
});

test('S0-16 mark-read: unknown / already-read id -> 200 idempotent, no error on 0 rows', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { a, aToken } = await seed(db, raw);
  await notifyUser(db, a, 'INTENT_ACCEPTED', {});
  const nA = raw.prepare('SELECT id FROM notifications WHERE user_id=?').get(a).id;
  const req = reqOf(aToken);
  assert.equal((await handleMarkNotificationRead(db, 999999, req)).status, 200, 'unknown id -> ok (0 rows)');
  assert.equal((await handleMarkNotificationRead(db, nA, req)).status, 200, 'own id -> ok, flips');
  assert.equal((await handleMarkNotificationRead(db, nA, req)).status, 200, 'already-read id -> idempotent ok');
  assert.equal(raw.prepare('SELECT is_read FROM notifications WHERE id=?').get(nA).is_read, 1, 'own row flipped once');
});

test('S0-16 mark-read: invalid id -> 400 (strict parse)', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { aToken } = await seed(db, raw);
  for (const bad of ['abc', 0, -3, 1.5, '', null]) {
    const res = await handleMarkNotificationRead(db, bad, reqOf(aToken));
    assert.equal(res.status, 400, `id=${JSON.stringify(bad)} must be 400`);
  }
});

test('S0-16 read-all ownership: only the caller unread cleared', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { a, b, aToken } = await seed(db, raw);
  await notifyUser(db, a, 'INTENT_ACCEPTED', {});
  await notifyUser(db, b, 'INTENT_ACCEPTED', {});
  const res = await handleMarkAllNotificationsRead(db, reqOf(aToken));
  assert.equal(res.status, 200);
  assert.equal(raw.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND is_read=0').get(a).c, 0,
    'own unread cleared');
  assert.equal(raw.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND is_read=0').get(b).c, 1,
    'other user unread preserved (mutation: drop user_id -> all cleared -> red)');
});

test('S0-16 read-all: unauthenticated -> 401', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  await seed(db, raw);
  const res = await handleMarkAllNotificationsRead(db, reqOf('no-token'));
  assert.equal(res.status, 401);
});
