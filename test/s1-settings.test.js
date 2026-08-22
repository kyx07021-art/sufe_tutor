/**
 * New-site backend S1: consolidated /api/settings surface (I-08..I-14).
 *
 * Covers:
 *   - handleGetSettings: requires a valid token; returns user + usernameStatus +
 *     blockSystemNotifications + notifyBroadcastMuted + devices (current session flagged,
 *     zero token/token_hash leak).
 *   - handleUpdateSettings: partial update by field — username (capToken-gated, admin
 *     forbidden, occupied -> 409), avatar (svg rejected / bitmap ok), bind phone (verify-code
 *     FIRST then occupied -> 409), notification prefs (strict 0/1), unknown field -> 400.
 *   - handleDeactivateSettings: capToken-gated; admin forbidden; on success clears the
 *     contact columns (AE-1) so dbPhoneTaken returns false and the username is tombstoned.
 *
 * Direct handler invocation with node:sqlite DatabaseSync + d1Shim (v2 test convention).
 */
import { test } from 'node:test';
import { TEST_SECRETS } from './_test-secrets.js';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import { requestOtp } from '../src/server/core/otp.js';
import { dbPhoneTaken } from '../src/server/core/credential.js';
import { issueCapToken } from '../src/server/core/danger-ops.js';
import { handleRegister, handleLogin, handleAuthMe } from '../src/server/domains/auth/api.js';
import { handleGetSettings, handleUpdateSettings, handleDeactivateSettings } from '../src/server/domains/auth/settings.js';
import { lastOtpCode, resetOtpStub } from './_otp-stub.js'; // stubs fetch so no real SMS/email is sent

const ENV = { ...TEST_SECRETS, ADMIN_USERNAMES: ['admin_sufe'], ADMIN_DEFAULT_PASSWORD: 'test-pw-123' };
function d1Shim(raw) {
  return {
    prepare(sql) {
      const st = { _sql: sql, _params: [], bind(...p) { st._params = p; return st; },
        all(...p) { return { results: raw.prepare(st._sql).all(...(p.length ? p : st._params)) }; },
        first(...p) { return raw.prepare(st._sql).get(...(p.length ? p : st._params)) ?? undefined; },
        run(...p) { const info = raw.prepare(st._sql).run(...(p.length ? p : st._params)); return { meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } }; } };
      return st;
    },
    async batch(stmts) {
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

async function setup() {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  const db = d1Shim(raw);
  await initDb(db, ENV);
  resetOtpStub(); // test isolation: clear the captured codes from previous cases
  return { raw, db };
}

function authedReq(token) {
  return { headers: new Headers({ 'X-Auth-Token': token }) };
}

async function registerUser(db, raw, username) {
  // Register binds a phone via the SMS OTP channel (v1.0 R7) — the returned target is the
  // user's bound contact.
  const target = '+86139' + String(Math.floor(Math.random() * 90000000) + 10000000);
  const otp = await requestOtp(db, { channel: 'sms', target }, authedReq(''));
  assert.ok(otp.ok, 'code send ok');
  const r = await handleRegister(db, { username, password: 'pass123456', role: 'student', agreeAgreement: true, agreePrivacy: true, phone: target, otpChannel: 'sms', code: lastOtpCode(target) }, authedReq(''));
  assert.equal(r.status, 200, `register ${username} should succeed`);
  const data = await r.json();
  const id = raw.prepare('SELECT id FROM users WHERE username=?').get(username).id;
  return { id, token: data.authToken, phone: target };
}

// ---------------- GET /api/settings (I-08) ----------------
test('GET /api/settings: no token -> 401 LOGIN_REQUIRED', async () => {
  const { db } = await setup();
  const r = await handleGetSettings(db, authedReq(''));
  assert.equal(r.status, 401);
  assert.equal((await r.json()).code, 'AUTH_LOGIN_REQUIRED');
});

test('GET /api/settings: full shape; devices carries the current session; zero token leak', async () => {
  const { raw, db } = await setup();
  const u = await registerUser(db, raw, 'set_shape');
  const r = await handleGetSettings(db, authedReq(u.token));
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.equal(data.user.id, u.id);
  assert.equal(data.user.username, 'set_shape');
  assert.equal(typeof data.user.avatar, 'string');
  assert.equal(data.user.role, 'student');
  assert.equal(typeof data.user.contactMasks.phone, 'string', 'contactMasks present');
  assert.deepEqual(data.usernameStatus, { canChange: true, cooldownMs: 0 }, 'fresh user can change username');
  assert.equal(data.blockSystemNotifications, false);
  assert.equal(data.notifyBroadcastMuted, false);
  assert.ok(Array.isArray(data.devices));
  assert.equal(data.devices.length, 1, 'one active session from register');
  assert.equal(data.devices[0].current, true, 'the issuing session is current');
  assert.ok(data.devices[0].session_id, 'session_id exposed for device management');
  assert.ok(!('token' in data.devices[0]), 'no token field leaks in device rows');
  assert.ok(!('token_hash' in data.devices[0]), 'no token_hash leaks in device rows');
});

// ---------------- PUT /api/settings (I-09) ----------------
test('PUT /api/settings: username without capToken -> 403 REAUTH_FAILED', async () => {
  const { raw, db } = await setup();
  const u = await registerUser(db, raw, 'set_ucap');
  const r = await handleUpdateSettings(db, { username: 'renamed_user' }, authedReq(u.token));
  assert.equal(r.status, 403);
  assert.equal((await r.json()).code, 'AUTH_REAUTH_FAILED');
});

test('PUT /api/settings: username with valid capToken -> 200 {ok:true, username}; /api/auth/me reflects it', async () => {
  const { raw, db } = await setup();
  const u = await registerUser(db, raw, 'set_uren');
  const capToken = await issueCapToken(db, authedReq(u.token));
  assert.ok(capToken, 'capToken issued for the current session');
  const r = await handleUpdateSettings(db, { username: 'renamed_user', capToken }, authedReq(u.token));
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.equal(data.ok, true);
  assert.equal(data.username, 'renamed_user');
  // Persisted in the users row.
  assert.equal(raw.prepare('SELECT username FROM users WHERE id=?').get(u.id).username, 'renamed_user');
  // /api/auth/me returns the new username on subsequent reads.
  const me = await handleAuthMe(db, authedReq(u.token));
  assert.equal((await me.json()).user.username, 'renamed_user');
});

test('PUT /api/settings: username already taken -> 409 USERNAME_TAKEN', async () => {
  const { raw, db } = await setup();
  const a = await registerUser(db, raw, 'alice');
  const b = await registerUser(db, raw, 'bob');
  const capToken = await issueCapToken(db, authedReq(b.token));
  const r = await handleUpdateSettings(db, { username: 'alice', capToken }, authedReq(b.token));
  assert.equal(r.status, 409);
  assert.equal((await r.json()).code, 'AUTH_USERNAME_TAKEN');
});

test('PUT /api/settings: avatar svg rejected -> 400; bitmap dataURL accepted -> 200', async () => {
  const { raw, db } = await setup();
  const u = await registerUser(db, raw, 'set_av');
  const svg = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjwvc3ZnPg==';
  const svgRes = await handleUpdateSettings(db, { avatar: svg }, authedReq(u.token));
  assert.equal(svgRes.status, 400, 'svg is rejected (vector can embed scripts)');
  assert.equal((await svgRes.json()).code, 'TEACHER_AVATAR_INVALID');
  // Tiny 1x1 PNG data URL (well under LIMITS.AVATAR_MAX_BYTES).
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const okRes = await handleUpdateSettings(db, { avatar: png }, authedReq(u.token));
  assert.equal(okRes.status, 200, 'bitmap dataURL accepted');
  assert.equal(raw.prepare('SELECT avatar FROM users WHERE id=?').get(u.id).avatar, png, 'avatar persisted');
});

test('PUT /api/settings: bind phone with a fresh code -> 200 {ok:true, phone masked}; dbPhoneTaken true', async () => {
  const { raw, db } = await setup();
  const u = await registerUser(db, raw, 'set_bind');
  const otp = await requestOtp(db, { channel: 'sms', target: '+8613812345678' }, authedReq(''));
  assert.ok(otp.ok, 'code send ok');
  const r = await handleUpdateSettings(db, { channel: 'phone', target: '+8613812345678', code: lastOtpCode('+8613812345678') }, authedReq(u.token));
  assert.equal(r.status, 200, `bind should succeed`);
  const data = await r.json();
  assert.equal(data.ok, true);
  assert.equal(data.phone, '138****5678', 'bind returns the masked phone');
  assert.equal(await dbPhoneTaken(db, '+8613812345678'), true, 'phone now occupied by this user');
});

test('PUT /api/settings: bind phone already occupied -> 409 PHONE_ALREADY_BOUND (verify-code first)', async () => {
  const { raw, db } = await setup();
  const a = await registerUser(db, raw, 'bind_a'); // a.phone is bound to A
  const b = await registerUser(db, raw, 'bind_b');
  // A fresh code for A's phone: verify-code passes, THEN the occupied check fires -> 409.
  // This locks the I-12 验码先行 ordering (verify BEFORE the occupied probe).
  const otp = await requestOtp(db, { channel: 'sms', target: a.phone }, authedReq(''));
  assert.ok(otp.ok, 'code send ok');
  const r = await handleUpdateSettings(db, { channel: 'phone', target: a.phone, code: lastOtpCode(a.phone) }, authedReq(b.token));
  assert.equal(r.status, 409);
  assert.equal((await r.json()).code, 'AUTH_PHONE_ALREADY_BOUND');
});

test('PUT /api/settings: blockSystemNotifications true -> 200; GET reflects it', async () => {
  const { raw, db } = await setup();
  const u = await registerUser(db, raw, 'set_pref');
  const r = await handleUpdateSettings(db, { blockSystemNotifications: true }, authedReq(u.token));
  assert.equal(r.status, 200);
  const g = await handleGetSettings(db, authedReq(u.token));
  const data = await g.json();
  assert.equal(data.blockSystemNotifications, true);
  assert.equal(data.notifyBroadcastMuted, false, 'untouched pref stays false');
});

// ---------------- POST /api/settings/deactivate (I-14) ----------------
test('POST /api/settings/deactivate: no capToken -> 403; with capToken -> 200; releases phone + tombstone', async () => {
  const { raw, db } = await setup();
  const u = await registerUser(db, raw, 'deact');
  const phone = u.phone;
  assert.equal(await dbPhoneTaken(db, phone), true, 'bound before deactivate');

  // No capToken -> 403 REAUTH_FAILED.
  const noCap = await handleDeactivateSettings(db, {}, authedReq(u.token));
  assert.equal(noCap.status, 403);
  assert.equal((await noCap.json()).code, 'AUTH_REAUTH_FAILED');

  // With capToken -> 200.
  const capToken = await issueCapToken(db, authedReq(u.token));
  assert.ok(capToken, 'capToken issued for the current session');
  const ok = await handleDeactivateSettings(db, { capToken }, authedReq(u.token));
  assert.equal(ok.status, 200, `deactivate should succeed: ${JSON.stringify(await ok.json())}`);

  // AE-1: contact columns cleared -> unique index released -> dbPhoneTaken false.
  assert.equal(await dbPhoneTaken(db, phone), false, 'deactivated user releases the bound phone (AE-1)');
  // Username tombstoned + deactivated flag set (same row a dbGetUserById would expose).
  const row = raw.prepare('SELECT username, deactivated, phone_hash FROM users WHERE id=?').get(u.id);
  assert.equal(row.deactivated, 1, 'deactivated flag set');
  assert.equal(row.phone_hash, '', 'phone_hash cleared');
  assert.ok(String(row.username).startsWith('已注销用户#'), `tombstone username: ${row.username}`);
});

test('POST /api/settings/deactivate: admin -> 403 NO_PERMISSION', async () => {
  const { db } = await setup();
  // Admin account is seeded by initDb via ADMIN_USERNAMES.
  const login = await handleLogin(db, { identifier: 'admin_sufe', password: 'test-pw-123' }, authedReq(''));
  assert.equal(login.status, 200, 'admin login should succeed');
  const data = await login.json();
  const r = await handleDeactivateSettings(db, {}, authedReq(data.authToken));
  assert.equal(r.status, 403);
  assert.equal((await r.json()).code, 'COMMON_NO_PERMISSION');
});
