/**
 * New-site backend S1: /api/auth/me enhancement (I-05) + /api/auth/verify (I-06).
 *
 * Covers:
 *   - handleAuthMe: requires a valid token; returns user + teacherName ('' when no
 *     teacher_profiles.teacher_name value, the value when present) + contactMasks
 *     {phone, email} masked ('' = unbound).
 *   - handleVerifyIdentity: requires a valid token; password branch correct/wrong; OTP
 *     branch correct/wrong against the user's bound contact (phone preferred, email
 *     fallback); success issues a one-time session-bound capToken (consumable once by
 *     confirmDangerOtp). AK-A1b: captcha is a client-side anti-abuse UX gate — the server
 *     no longer confirms it; the auth rate limit (authRateBatch, 8/10min) is the primary
 *     anti-bruteforce defense and is independently locked below.
 *
 * Direct handler invocation with node:sqlite DatabaseSync + d1Shim (v2 test convention).
 */
import { test } from 'node:test';
import { TEST_SECRETS } from './_test-secrets.js';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import { requestOtp } from '../src/server/core/otp.js';
import { confirmDangerOtp } from '../src/server/core/danger-ops.js';
import { handleAuthMe, handleRegister } from '../src/server/domains/auth/api.js';
import { handleUpdateSettings } from '../src/server/domains/auth/settings.js'; // PA-1a-F3: bind 收敛到 settings 单源
import { handleVerifyIdentity } from '../src/server/domains/auth/verify.js';
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
  // bound contact, so /api/auth/me contactMasks.phone is non-empty for a registered user.
  const target = '+86139' + String(Math.floor(Math.random() * 90000000) + 10000000);
  const otp = await requestOtp(db, { channel: 'sms', target }, authedReq(''));
  assert.ok(otp.ok, 'code send ok');
  const r = await handleRegister(db, { username, password: 'pass123456', role: 'student', agreeAgreement: true, agreePrivacy: true, phone: target, otpChannel: 'sms', code: lastOtpCode(target) }, authedReq(''));
  assert.equal(r.status, 200, `register ${username} should succeed`);
  const data = await r.json();
  const id = raw.prepare('SELECT id FROM users WHERE username=?').get(username).id;
  return { id, token: data.authToken, phone: target };
}

// ---------------- GET /api/auth/me (I-05) ----------------
test('GET /api/auth/me: no token -> 401 LOGIN_REQUIRED', async () => {
  const { db } = await setup();
  const r = await handleAuthMe(db, authedReq(''));
  assert.equal(r.status, 401);
  assert.equal((await r.json()).code, 'AUTH_LOGIN_REQUIRED');
});

test('GET /api/auth/me: user shape + teacherName "" + contactMasks for a registered student', async () => {
  const { raw, db } = await setup();
  const u = await registerUser(db, raw, 'me_stu');
  const r = await handleAuthMe(db, authedReq(u.token));
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.equal(data.user.id, u.id);
  assert.equal(data.user.username, 'me_stu');
  assert.equal(data.user.role, 'student');
  assert.equal(data.user.teacherName, '', 'no teacher_profiles row -> teacherName empty (frontend falls back to username)');
  // Register binds a phone -> contactMasks.phone is a masked non-empty value; email is unbound -> ''.
  assert.match(data.user.contactMasks.phone, /^\d{3}\*{4}\d{4}$/, 'bound phone is masked');
  assert.equal(data.user.contactMasks.email, '', 'email unbound -> empty string');
});

test('GET /api/auth/me: contactMasks.phone reflects the bound phone mask', async () => {
  const { raw, db } = await setup();
  const u = await registerUser(db, raw, 'me_mask');
  // Bind a known second phone; the mask in /api/auth/me must reflect it.
  const otp = await requestOtp(db, { channel: 'sms', target: '+8613812345678' }, authedReq(''));
  assert.ok(otp.ok, 'code send ok');
  const bind = await handleUpdateSettings(db, { channel: 'phone', target: '+8613812345678', code: lastOtpCode('+8613812345678') }, authedReq(u.token));
  assert.equal(bind.status, 200, `bind should succeed: ${JSON.stringify(await bind.json())}`);
  const r = await handleAuthMe(db, authedReq(u.token));
  const data = await r.json();
  assert.equal(data.user.contactMasks.phone, '138****5678', 'me returns the masked bound phone');
});

test('GET /api/auth/me: teacherName from teacher_profiles.teacher_name when the column exists', async () => {
  const { raw, db } = await setup();
  const u = await registerUser(db, raw, 'me_tea');
  // teacher_name is added by the teacher domain (S4) — column exists on the new-site schema.
  raw.prepare('INSERT INTO teacher_profiles (user_id, teacher_name) VALUES (?, ?)').run(u.id, '王老师');
  const r = await handleAuthMe(db, authedReq(u.token));
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.equal(data.user.teacherName, '王老师', 'teacherName read from teacher_profiles row');
});

// ---------------- POST /api/auth/verify (I-06) ----------------
test('POST /api/auth/verify: no token -> 401', async () => {
  const { db } = await setup();
  const r = await handleVerifyIdentity(db, { credential: { type: 'password', value: 'x' } }, authedReq(''));
  assert.equal(r.status, 401);
  assert.equal((await r.json()).code, 'AUTH_LOGIN_REQUIRED');
});

test('POST /api/auth/verify: correct password -> 200 {verified:true, capToken} consumable once', async () => {
  const { raw, db } = await setup();
  const u = await registerUser(db, raw, 'verify_pw');
  // AK-A1b: the client-side captcha flags (captchaVerified/captchaId) are ignored extra fields —
  // a body with or without them reaches the credential check identically. Correct password -> 200.
  const r = await handleVerifyIdentity(db, { credential: { type: 'password', value: 'pass123456' }, captchaVerified: true, captchaId: 'any-local-id' }, authedReq(u.token));
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.equal(data.verified, true);
  assert.ok(data.capToken, 'one-time capToken issued');
  assert.equal(await confirmDangerOtp(db, authedReq(u.token), { capToken: data.capToken }), true, 'capToken consumes successfully');
  assert.equal(await confirmDangerOtp(db, authedReq(u.token), { capToken: data.capToken }), false, 'capToken is one-time: second consume fails');
  // Mutation lock: the 200 branch only happens when the real password branch verifies; if a
  // weak/removed password branch ever lets a wrong password through, the case below red-flags.
});

test('POST /api/auth/verify: wrong password -> 403 VERIFY_FAILED', async () => {
  const { raw, db } = await setup();
  const u = await registerUser(db, raw, 'verify_pwbad');
  const r = await handleVerifyIdentity(db, { credential: { type: 'password', value: 'wrong-pass' } }, authedReq(u.token));
  assert.equal(r.status, 403);
  assert.equal((await r.json()).code, 'AUTH_VERIFY_FAILED');
});

test('POST /api/auth/verify: correct OTP against the bound phone -> 200 {verified:true, capToken}', async () => {
  const { raw, db } = await setup();
  const u = await registerUser(db, raw, 'verify_otp');
  const otp = await requestOtp(db, { channel: 'sms', target: u.phone }, authedReq(''));
  assert.ok(otp.ok, 'code send ok');
  const code = lastOtpCode(u.phone);
  const r = await handleVerifyIdentity(db, { credential: { type: 'otp', value: code } }, authedReq(u.token));
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.equal(data.verified, true);
  assert.ok(data.capToken, 'OTP path also issues a capToken');
});

test('POST /api/auth/verify: wrong OTP code -> 403 VERIFY_FAILED', async () => {
  const { raw, db } = await setup();
  const u = await registerUser(db, raw, 'verify_otpbad');
  const otp = await requestOtp(db, { channel: 'sms', target: u.phone }, authedReq(''));
  assert.ok(otp.ok, 'code send ok');
  const r = await handleVerifyIdentity(db, { credential: { type: 'otp', value: '000000' } }, authedReq(u.token));
  assert.equal(r.status, 403);
  assert.equal((await r.json()).code, 'AUTH_VERIFY_FAILED');
});

// ---------------- PA-1a-F2: verify auth rate limit (AK-A1b: primary anti-bruteforce defense) ----------------
test('POST /api/auth/verify: password brute force rate-limited to 8/10min (reauth bucket; mutation: removing authRateBatch -> over-limit not rejected -> red)', async () => {
  const { raw, db } = await setup();
  const u = await registerUser(db, raw, 'verify_rl');
  for (let i = 0; i < 8; i++) {
    const r = await handleVerifyIdentity(db, { credential: { type: 'password', value: 'wrong-pass' } }, authedReq(u.token));
    assert.equal(r.status, 403, `attempt ${i + 1} inside budget -> VERIFY_FAILED`);
    assert.equal((await r.json()).code, 'AUTH_VERIFY_FAILED');
  }
  const r = await handleVerifyIdentity(db, { credential: { type: 'password', value: 'wrong-pass' } }, authedReq(u.token));
  assert.equal(r.status, 429, '9th attempt over the 8/10min budget -> RATE_LIMITED');
  assert.equal((await r.json()).code, 'COMMON_RATE_LIMITED');
});
