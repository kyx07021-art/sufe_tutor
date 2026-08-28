/**
 * 双端点收敛 —— 显式转发 变异守护。
 *
 * 收敛目标：deactivate / username / avatar / 绑定 / username-status / creds 的实现收敛到
 * auth/settings.js 单源；auth/api.js 旧端点保留为**显式转发**（消费
 * GET/PUT /api/settings + POST /api/settings/deactivate，旧端点兼容 audit-flow 前缀，转发即单实现）。
 *
 * 本测试从**路由层**（routeApi）验证旧 v2 端点确实转发到 settings 单源并保留全部门禁：
 * - POST /api/user/deactivate 无 capToken → 403（capToken 门禁经转发存活）
 * - POST /api/user/avatar 无 token → 401（requireUser 门禁经转发存活）
 * - GET /api/user/creds / GET /api/user/username/status → 200（读端点经 GET /api/settings 转发）
 *
 * 变异守护（）：若收敛被回退——把转发器换成裸 `json({ok:true})` / 无门禁内联实现——
 * 下列断言即红。逐一还原修复（转发到 settings）→ 绿。
 */
import { test } from 'node:test';
import { TEST_SECRETS } from './_test-secrets.js';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import { requestOtp } from '../src/server/core/otp.js';
import { issueCapToken } from '../src/server/core/danger-ops.js';
import { handleRegister } from '../src/server/domains/auth/api.js';
import { routeApi } from '../_worker.js';
import { lastOtpCode, resetOtpStub } from './_otp-stub.js';

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
  resetOtpStub(); // OTP stub 的 fetch 拦截（import 时已安装）保持原样，不覆盖
  return { raw, db };
}

function call(db, method, path, body = null, token = null) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (token) headers.set('X-Auth-Token', token);
  return routeApi(db, path, method, body, new URL(`http://x${path}`), { headers, url: `http://x${path}` }, ENV);
}

async function registerUser(db, raw, username) {
  const target = '+86139' + String(Math.floor(Math.random() * 90000000) + 10000000);
  const otp = await requestOtp(db, { channel: 'sms', target }, { headers: new Headers() });
  assert.ok(otp.ok, 'code send ok');
  const r = await handleRegister(db, { username, password: 'pass123456', role: 'student', agreeAgreement: true, agreePrivacy: true, phone: target, otpChannel: 'sms', code: lastOtpCode(target) }, { headers: new Headers() });
  assert.equal(r.status, 200, `register ${username} should succeed`);
  const data = await r.json();
  return { id: raw.prepare('SELECT id FROM users WHERE username=?').get(username).id, token: data.authToken, phone: target };
}

test('PA-1a-F3 v2 转发：POST /api/user/deactivate 无 capToken → 403（capToken 门禁经转发存活）', async () => {
  const { raw, db } = await setup();
  const u = await registerUser(db, raw, 'conv_deact');

  // 无 capToken → 403 REAUTH_FAILED。
  // 变异：转发器被回退为裸 json({ok:true})（无 capToken 门禁）→ 本断言红（应 200）→ 还原转发绿。
  const noCap = await call(db, 'POST', '/api/user/deactivate', {}, u.token);
  assert.equal(noCap.status, 403, `no capToken must be rejected by the forwarded settings gate, got ${noCap.status}`);
  assert.equal((await noCap.json()).code, 'AUTH_REAUTH_FAILED');

  // 有 capToken → 200，注销生效（AE-1：联系方式释放）。
  const capToken = await issueCapToken(db, { headers: new Headers({ 'X-Auth-Token': u.token }) });
  assert.ok(capToken, 'capToken issued');
  const ok = await call(db, 'POST', '/api/user/deactivate', { capToken }, u.token);
  assert.equal(ok.status, 200, `deactivate with capToken must succeed, got ${ok.status}`);
  const row = raw.prepare('SELECT deactivated, phone_hash FROM users WHERE id=?').get(u.id);
  assert.equal(row.deactivated, 1, 'deactivated flag set via forwarded settings handler');
  assert.equal(row.phone_hash, '', 'phone released (AE-1) via forwarded settings handler');
});

test('PA-1a-F3 v2 转发：POST /api/user/avatar 无 token → 401；带 token 位图 → 200 落库', async () => {
  const { raw, db } = await setup();
  const u = await registerUser(db, raw, 'conv_av');

  // 无 token → 401 LOGIN_REQUIRED。
  // 变异：转发器被回退为无 requireUser 的内联实现 → 本断言红（应 200）→ 还原转发绿。
  const anon = await call(db, 'POST', '/api/user/avatar', { avatar: 'data:image/png;base64,iVBORw0KGgo=' });
  assert.equal(anon.status, 401, `no token must be rejected by the forwarded settings auth gate, got ${anon.status}`);

  // 带 token + 位图 dataURL → 200 落库。
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  const ok = await call(db, 'POST', '/api/user/avatar', { avatar: png }, u.token);
  assert.equal(ok.status, 200, `valid bitmap avatar must be accepted via forwarded settings handler, got ${ok.status}`);
  assert.equal(raw.prepare('SELECT avatar FROM users WHERE id=?').get(u.id).avatar, png, 'avatar persisted via forwarded settings handler');

  // SVG 仍被拒（位图白名单经转发存活）。
  const svg = await call(db, 'POST', '/api/user/avatar', { avatar: 'data:image/svg+xml;base64,xxx' }, u.token);
  assert.equal(svg.status, 400, 'svg still rejected through the forwarded settings handler');
});

test('PA-1a-F3 v2 转发：GET /api/user/creds 与 GET /api/user/username/status 经 GET /api/settings 转发', async () => {
  const { raw, db } = await setup();
  const u = await registerUser(db, raw, 'conv_read');

  // creds：无 token → 401；带 token → {phone 脱敏, email 空串}（注册必绑手机号）。
  const anon = await call(db, 'GET', '/api/user/creds');
  assert.equal(anon.status, 401, 'creds read without token → 401');
  const creds = await call(db, 'GET', '/api/user/creds', null, u.token);
  assert.equal(creds.status, 200, `creds read must succeed via forwarded GET /api/settings, got ${creds.status}`);
  const d = await creds.json();
  assert.match(d.phone, /^\d{3}\*{4}\d{4}$/, 'phone masked');
  assert.equal(d.email, '', 'email unbound → empty string');

  // username-status：带 token → {canChange:true, cooldownMs:0}（新用户无冷却）。
  const status = await call(db, 'GET', '/api/user/username/status', null, u.token);
  assert.equal(status.status, 200, `username-status read must succeed via forwarded GET /api/settings, got ${status.status}`);
  assert.deepEqual(await status.json(), { canChange: true, cooldownMs: 0 }, 'fresh user can change username');

  // bind 写路径经转发也走 settings 单源（验码先行 → 占用 409 语义一致）。
  const otp = await requestOtp(db, { channel: 'sms', target: '+8613812345678' }, { headers: new Headers() });
  assert.ok(otp.ok, 'code send ok');
  const bind = await call(db, 'POST', '/api/auth/phone/bind', { phone: '+8613812345678', code: lastOtpCode('+8613812345678') }, u.token);
  assert.equal(bind.status, 200, `phone bind must succeed via forwarded settings handler, got ${bind.status}`);
  const bindData = await bind.json();
  assert.equal(bindData.phone, '138****5678', 'bind returns the masked phone');
});
