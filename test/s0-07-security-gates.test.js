/**
 * S0-07 security choke mutation guards (in-place reuse of v2 core/security.js).
 *
 * Locks the identity/authorization gate contract (authUser/requireUser/requireAdmin/
 * requireAdminOrError) and the security-header posture (SECURITY_HEADERS in shared/config.js).
 * Rate-limit dual-path, three-strike/ban, authRateBatch and the OTP per-IP bucket are already
 * locked by test/security-core.test.js — this file adds the role-gate matrix, the banned/expired
 * session rejection, and the header posture that were previously only covered indirectly.
 *
 * Mutations (reverting each fix makes these assertions go red):
 *   - requireUser drops the role branch -> wrong-role request returns { user } instead of 403 -> red
 *   - requireAdminOrError stops checking role === 'admin' -> non-admin passes -> red
 *   - authUser stops checking banned / token expiry -> banned/expired session accepted -> red
 *   - SECURITY_HEADERS CSP re-adds 'unsafe-inline' or loosens style-src-attr -> red
 *
 * The db stub only serves authUser's single dbGet (first()); req objects are fresh per call so the
 * module-level authMemo WeakMap cannot leak between assertions.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authUser, requireUser, requireAdmin, requireAdminOrError, applySecurityHeaders } from '../src/server/core/security.js';
import { SECURITY_HEADERS } from '../src/shared/config.js';

// db stub: first() returns a single user row (authUser issues exactly one dbGet).
function mkDb(user) {
  return {
    prepare() {
      return {
        bind() {
          return {
            first: async () => user ?? undefined,
          };
        },
      };
    },
  };
}

function reqFor(token) {
  return { headers: { get: h => (h === 'X-Auth-Token' ? token : null) } };
}

const LIVE = { id: 7, username: 'u', role: 'student', avatar: '', banned: 0, deactivated: 0, token_expires: '2099-01-01 00:00:00' };
const TEACHER = { ...LIVE, id: 2, role: 'teacher' };
const ADMIN = { ...LIVE, id: 1, role: 'admin' };

test('S0-07 authUser: no token -> null; no matching session row -> null', async () => {
  assert.equal(await authUser(mkDb(LIVE), { headers: { get: () => null } }), null, 'missing X-Auth-Token header -> null');
  assert.equal(await authUser(mkDb(undefined), reqFor('tok-ghost')), null, 'no session row -> null');
});

test('S0-07 authUser: banned or expired token rejected', async () => {
  assert.equal(await authUser(mkDb({ ...LIVE, banned: 1 }), reqFor('tok-banned')), null,
    'banned user rejected (mutation: drop banned check -> red)');
  assert.equal(await authUser(mkDb({ ...LIVE, token_expires: '2000-01-01 00:00:00' }), reqFor('tok-exp')), null,
    'expired token rejected');
  const ok = await authUser(mkDb(LIVE), reqFor('tok-ok'));
  assert.equal(ok && ok.id, 7, 'live user accepted');
});

test('S0-07 requireUser: role gate matrix (mutation: drop role branch -> red)', async () => {
  assert.equal((await requireUser(mkDb(undefined), reqFor('none'))).err.status, 401, 'no user -> 401 LOGIN_REQUIRED');
  assert.equal((await requireUser(mkDb(LIVE), reqFor('s'))).user.id, 7, 'student on student route -> allowed');
  assert.equal((await requireUser(mkDb(LIVE), reqFor('s2'), 'teacher')).err.status, 403, 'student on teacher route -> 403');
  assert.equal((await requireUser(mkDb(LIVE), reqFor('s3'), 'admin')).err.status, 403, 'student on admin route -> 403');
  assert.equal((await requireUser(mkDb(TEACHER), reqFor('t'))).user.id, 2, 'teacher on teacher route -> allowed');
  assert.equal((await requireUser(mkDb(TEACHER), reqFor('t2'), 'student')).err.status, 403, 'teacher on student route -> 403');
  assert.equal((await requireUser(mkDb(ADMIN), reqFor('a'), 'admin')).user.id, 1, 'admin on admin route -> allowed');
});

test('S0-07 requireAdmin / requireAdminOrError', async () => {
  assert.equal((await requireAdmin(mkDb(ADMIN), reqFor('a'))).admin.id, 1, 'admin -> { admin }');
  const denied = await requireAdmin(mkDb(LIVE), reqFor('stu'));
  assert.equal(denied.admin, undefined, 'non-admin -> no admin');
  assert.equal(denied.err.status, 403, 'non-admin -> 403 ADMIN_ONLY');
  assert.equal(requireAdminOrError({ role: 'admin' }), null, 'adminOrError: admin -> null (mutation: no role check -> red)');
  const e = requireAdminOrError({ role: 'student' });
  assert.equal(e.status, 403, 'adminOrError: student -> 403');
  const body = await e.json();
  assert.equal(body.code, 'COMMON_ADMIN_ONLY', 'stable code present for frontend branching');
});

test('S0-07 security-header posture: strict CSP, no unsafe-inline, defense headers', () => {
  const csp = SECURITY_HEADERS['Content-Security-Policy'];
  assert.ok(csp.includes("script-src 'self'"), 'CSP script-src self');
  assert.ok(!csp.includes("'unsafe-inline'"), 'CSP must not contain unsafe-inline (mutation: re-add -> red)');
  assert.match(csp, /style-src-attr 'none'/, "style-src-attr 'none' (CSSOM data channel only)");
  assert.match(csp, /style-src-elem 'self'/, "style-src-elem 'self' (no injected <style>)");
  assert.equal(SECURITY_HEADERS['X-Content-Type-Options'], 'nosniff');
  assert.equal(SECURITY_HEADERS['X-Frame-Options'], 'DENY');
  assert.equal(SECURITY_HEADERS['Referrer-Policy'], 'strict-origin-when-cross-origin');
});

test('S0-07 applySecurityHeaders: /api/* carries headers + no-store; static path untouched', () => {
  const api = new Response('ok', { status: 200 });
  applySecurityHeaders(api, '/api/health');
  assert.equal(api.headers.get('X-Content-Type-Options'), 'nosniff', 'api response hardened');
  assert.equal(api.headers.get('Cache-Control'), 'no-store', 'api no-store');
  const stat = new Response('css', { status: 200 });
  const out = applySecurityHeaders(stat, '/assets/app.css');
  assert.equal(out, stat, 'static path returned unchanged');
  assert.equal(stat.headers.get('Cache-Control'), null, 'static path not injected no-store (left to _headers)');
});
