/**
 * v1.4.12 验证码真实通道回归（R1-T10）——sms 接入 push.spug.cc 短信 + 发送失败生产情景：
 *
 * 覆盖：
 *   - sms 投递请求形状：URL = /sms/<SMS_OTP_TEMPLATE_CODE>（模板编码即调用凭证）、
 *     表单字段 to=裸 11 位手机号（无 +86）、code=6 位验证码、number='5'（分钟数，单源自 TTL）；
 *   - email 投递请求形状：URL = /mail/<EMAIL_OTP_TEMPLATE_CODE>、表单 to/scene/code/minute='5'；
 *   - 响应绝不携带验证码明文（requestOtp 返回对象无 code 字段）；
 *   - 发送失败（服务商非 200 / 网络异常）：作废刚写入的验证码行（码没送达）→ 接口 500、可重试，
 *     验证码行不复存在、响应无 code（fail-closed，绝不再静默出假码）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../server/db.js';
import { requestOtp } from '../server/otp.js';
import { tokenDigest } from '../server/crypto.js';
import { lastOtpSend, resetOtpStub, setOtpStubFail, lastOtpCode } from './_otp-stub.js';
import { getSecret } from '../server/secrets.js';

const ENV = { ADMIN_USERNAMES: ['admin_sufe'], ADMIN_DEFAULT_PASSWORD: 'test-pw-123' };
// 模板编码单源：从 secrets 网关读取（与生产同一回落链，改配置无需同步测试）
const SMS_KEY = getSecret(null, 'SMS_OTP_TEMPLATE_CODE');
const EMAIL_KEY = getSecret(null, 'EMAIL_OTP_TEMPLATE_CODE');
assert.ok(SMS_KEY, 'secrets 需配置 SMS_OTP_TEMPLATE_CODE（断言请求形状的前提）');
assert.ok(EMAIL_KEY, 'secrets 需配置 EMAIL_OTP_TEMPLATE_CODE');

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
  resetOtpStub();
  setOtpStubFail(null);
  return { raw, db };
}

test('sms 投递请求形状：/sms/<编码> + 表单 to=裸号/code/number=5，响应无验证码明文', async () => {
  const { db } = await setup();
  const target = '+8613812345678';
  const r = await requestOtp(db, { channel: 'sms', target }, { headers: new Headers() });
  assert.equal(r.ok, true);
  assert.equal('code' in r, false, '响应绝不携带验证码明文');

  const send = lastOtpSend();
  assert.ok(send.url.includes(`/sms/${SMS_KEY}`), `URL 为 /sms/<编码>：${send.url}`);
  assert.equal(send.body.to, '13812345678', 'to 为裸 11 位手机号（模板口径，无 +86 前缀）');
  assert.match(String(send.body.code), /^\d{6}$/, 'code 为 6 位数字');
  assert.equal(send.body.number, '5', 'number = 有效时长分钟数（单源自 LIMITS.OTP_CODE_TTL_MS）');
  assert.equal(send.body.scene, undefined, '短信模板无 scene 占位符，不传');
});

test('email 投递请求形状：/mail/<编码> + 表单 to/scene/code/minute=5', async () => {
  const { db } = await setup();
  const r = await requestOtp(db, { channel: 'email', target: 'stu@example.com', scene: '登录验证' }, { headers: new Headers() });
  assert.equal(r.ok, true);
  const send = lastOtpSend();
  assert.ok(send.url.includes(`/mail/${EMAIL_KEY}`), `URL 为 /mail/<编码>：${send.url}`);
  assert.equal(send.body.to, 'stu@example.com', '邮箱原样传 target');
  assert.equal(send.body.scene, '登录验证');
  assert.match(String(send.body.code), /^\d{6}$/);
  assert.equal(send.body.minute, '5', 'minute = 有效时长分钟数');
  assert.equal(lastOtpCode('stu@example.com'), send.body.code, 'stub 捕获的验证码与投递 body 一致');
});

test('发送失败（服务商非 200）：作废验证码行 → 500，不留假码', async () => {
  const { raw, db } = await setup();
  const target = '+8613812345678';
  const hash = await tokenDigest(target);
  setOtpStubFail({ status: 500 });
  const r = await requestOtp(db, { channel: 'sms', target }, { headers: new Headers() });
  assert.equal(r.ok, false);
  assert.equal(r.err.status, 500, '投递失败返回 500（用户可重试）');
  assert.equal('code' in r, false, '失败响应绝无验证码');
  const cnt = raw.prepare('SELECT COUNT(*) c FROM verification_codes WHERE channel=? AND target_hash=?').get('sms', hash).c;
  assert.equal(cnt, 0, '验证码行已作废删除（码没送达，留着只会被猜到/过期）');
});

test('发送失败（网络异常）：同样作废验证码行 → 500', async () => {
  const { raw, db } = await setup();
  const target = '+8613812345678';
  const hash = await tokenDigest(target);
  setOtpStubFail('throw');
  const r = await requestOtp(db, { channel: 'sms', target }, { headers: new Headers() });
  assert.equal(r.ok, false);
  assert.equal(r.err.status, 500);
  const cnt = raw.prepare('SELECT COUNT(*) c FROM verification_codes WHERE channel=? AND target_hash=?').get('sms', hash).c;
  assert.equal(cnt, 0, '验证码行已作废删除');
});

test('发送失败后恢复：再次发码成功走真实形状', async () => {
  const { db } = await setup();
  const target = '+8613812345678';
  setOtpStubFail({ status: 500 });
  const fail = await requestOtp(db, { channel: 'sms', target }, { headers: new Headers() });
  assert.equal(fail.ok, false);
  setOtpStubFail(null);
  const ok = await requestOtp(db, { channel: 'sms', target }, { headers: new Headers() });
  assert.equal(ok.ok, true, '失败不阻断后续重试（60s 窗口已随验证码行删除而过）');
  const send = lastOtpSend();
  assert.ok(send.url.includes(`/sms/${SMS_KEY}`));
});

// v1.4.15 生产事故回归（用户实证：绑定手机号发码 500）：spug 未实名认证时返回 HTTP 200 受理 +
// 业务码非 200——deliverOtp 必须按业务码判失败（HTTP 200 ≠ 成功），且把服务商操作提示透传用户替代「服务器内部错误」
test('业务拒绝（HTTP 200 + 业务码非 200）：作废验证码 + 500 + 透传服务商提示', async () => {
  const { raw, db } = await setup();
  const target = '+8613812345678';
  const hash = await tokenDigest(target);
  setOtpStubFail({ status: 200, bodyCode: 4001, msg: '账户未通过实名认证，请前往个人设置/实名认证完成认证后再试' });
  const r = await requestOtp(db, { channel: 'sms', target }, { headers: new Headers() });
  assert.equal(r.ok, false);
  assert.equal(r.err.status, 500, 'HTTP 200 受理 ≠ 成功：业务码非 200 仍按失败处理');
  const body = await r.err.json();
  assert.equal(body.error, '验证码发送失败：账户未通过实名认证，请前往个人设置/实名认证完成认证后再试', '透传服务商操作提示（用户可自助），非笼统「服务器内部错误」');
  const cnt = raw.prepare('SELECT COUNT(*) c FROM verification_codes WHERE channel=? AND target_hash=?').get('sms', hash).c;
  assert.equal(cnt, 0, '验证码行已作废删除');
});

// 网络/超时类失败无服务商提示 → 保持 SERVER_ERROR（不透传技术细节）
test('非业务拒绝（网络异常）：保持 SERVER_ERROR 文案', async () => {
  const { db } = await setup();
  setOtpStubFail('throw');
  const r = await requestOtp(db, { channel: 'sms', target: '+8613812345678' }, { headers: new Headers() });
  assert.equal(r.ok, false);
  const body = await r.err.json();
  assert.equal(body.error, '服务器内部错误');
});
