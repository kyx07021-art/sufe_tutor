/**
 * v1.5.0 生产 Release Gate（server/startup.js）
 *   - 非生产运行时（本地/测试）恒放行；
 *   - 生产运行时缺密钥/沿用旧管理员口令/mock provider → not-ready；
 *   - notReadyResponse 不泄露任何秘密值。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { productionConfigChecks, productionReady, notReadyResponse } from '../server/startup.js';
import { LEGACY_ADMIN_PASSWORD, INVITE_GATE_ENABLED, INVITE_GATE_DORMANT } from '../src/shared/config.js'; // ZV-1: assert config terminal state

const PROD = { CF_PAGES_URL: 'https://sufe-tutor.pages.dev' };

const goodSecrets = {
  ...PROD,
  LOG_ENCRYPT_KEY: 'TExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEw=', // 32 字节合法 base64 占位（非真实密钥）
  FIELD_ENC_KEY: 'RkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkY=', // 32 字节合法 base64（Q-2a-F4 Gate 校验可导入性；非真实密钥）
  FIELD_ENC_KEY_OLD: 'OLD_FIELD_ENC_KEY_0000000000000000000000',
  LOG_ENCRYPT_KEY_OLD: 'OLD_LOG_ENCRYPT_KEY_0000000000000000000000',
  SMS_OTP_TEMPLATE_CODE: 'sms-template-code',
  EMAIL_OTP_TEMPLATE_CODE: 'email-template-code',
  TEXT_AUDIT_API_KEY: 'sk-audit-key',
  ADMIN_USERNAMES: ['admin_sufe'],
  ADMIN_DEFAULT_PASSWORD: 'rotated-strong-password-2026',
  CHSI_PROVIDER: 'manual',
};

test('本地/测试运行时不受生产门槛约束', () => {
  const g = productionConfigChecks({ ADMIN_USERNAMES: ['admin_sufe'] });
  assert.equal(g.ok, true);
  assert.deepEqual(g.checks, []);
  assert.equal(productionReady(null).ok, true);
});

test('生产运行时缺任一必需 Secret → not-ready，且逐项可定位', () => {
  const g = productionConfigChecks(PROD);
  assert.equal(g.ok, false);
  const codes = new Set(g.checks.filter(c => !c.pass).map(c => c.code));
  for (const code of ['LOG_ENCRYPT_KEY', 'FIELD_ENC_KEY', 'SMS_OTP_TEMPLATE_CODE', 'EMAIL_OTP_TEMPLATE_CODE', 'TEXT_AUDIT_API_KEY', 'ADMIN_CREDENTIAL_ROTATED', 'ADMIN_USERNAMES', 'CRYPTO_ROTATION_READY']) {
    assert.ok(codes.has(code), `缺 ${code} 应被标记`);
  }
});

test('生产沿用历史默认管理员口令 → not-ready', () => {
  const g = productionConfigChecks({ ...goodSecrets, ADMIN_DEFAULT_PASSWORD: LEGACY_ADMIN_PASSWORD });
  assert.equal(g.ok, false);
  assert.equal(g.checks.find(c => c.code === 'ADMIN_CREDENTIAL_ROTATED').pass, false);
});

test('生产仍配置 mock/thirdparty provider → not-ready', () => {
  for (const p of ['mock', 'thirdparty']) {
    const g = productionConfigChecks({ ...goodSecrets, CHSI_PROVIDER: p });
    assert.equal(g.ok, false);
    assert.equal(g.checks.find(c => c.code === 'CHSI_PROVIDER_MANUAL').pass, false);
  }
});

test('生产密钥齐全 + 管理员轮换 + manual provider → ready', () => {
  const g = productionConfigChecks(goodSecrets);
  assert.equal(g.ok, true);
  assert.ok(g.checks.length > 0);
});

test('Q-2a-F4 守护：非法 base64 / 非 32 字节 base64 密钥 → not-ready（防假绿）', () => {
  // 16 字节合法 base64（WebCrypto 不抛错但静默降级 AES-128——Gate 强制 32 字节防降级）
  const sixteenByte = 'MTIzNDU2Nzg5MDEyMzQ1Ng==';
  const g16 = productionConfigChecks({ ...goodSecrets, LOG_ENCRYPT_KEY: sixteenByte });
  assert.equal(g16.ok, false, '16 字节密钥不可用 → not-ready');
  assert.equal(g16.checks.find(c => c.code === 'LOG_ENCRYPT_KEY').pass, false);
  // 非法 base64（含下划线非 base64 字母表；atob 抛错）
  const gBad = productionConfigChecks({ ...goodSecrets, FIELD_ENC_KEY: 'not_base64!!' });
  assert.equal(gBad.ok, false, '非法 base64 → not-ready');
  assert.equal(gBad.checks.find(c => c.code === 'FIELD_ENC_KEY').pass, false);
});

test('notReadyResponse：503 + 只暴露检查码，不暴露秘密值', async () => {
  const g = productionConfigChecks(PROD);
  const res = notReadyResponse(g);
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.status, 'not-ready');
  assert.equal(body.ready, false);
  assert.ok(body.timestamp);
  assert.ok(Array.isArray(body.checks));
  assert.ok(!JSON.stringify(body).includes(LEGACY_ADMIN_PASSWORD));
  assert.ok(!JSON.stringify(body).includes(goodSecrets.SMS_OTP_TEMPLATE_CODE));
});

test('邀请码闸门一致态：当前 config 终态 (ENABLED=false, DORMANT=true) ready', () => {
  // ZV-1（2026-08-27）：config 双开关翻转至开放注册终态。闸门读 shared config import（测试内不可注入），
  // 单翻中间态由 ZV-1 变异实证拦截（还原 ENABLED=true → 本测试与 register-agreement 均红）；此处直接锁定终态值。
  const g1 = productionConfigChecks({ ...goodSecrets, CF_PAGES_URL: 'https://x' });
  assert.equal(g1.checks.find(c => c.code === 'INVITE_GATE_CONSISTENT').pass, true, '开放注册终态 = 一致（闸门不误伤 ready）');
  assert.equal(INVITE_GATE_ENABLED, false, 'config 终态 ENABLED=false（ZV-1）');
  assert.equal(INVITE_GATE_DORMANT, true, 'config 终态 DORMANT=true（ZV-1）');
});

test('CRYPTO_REENCRYPT_DONE=true 时无需旧钥也可 ready', () => {
  const { FIELD_ENC_KEY_OLD, LOG_ENCRYPT_KEY_OLD, ...rest } = goodSecrets;
  const g = productionConfigChecks({ ...rest, CRYPTO_REENCRYPT_DONE: 'true' });
  assert.equal(g.ok, true);
  assert.equal(g.checks.find(c => c.code === 'CRYPTO_ROTATION_READY').pass, true);
});
