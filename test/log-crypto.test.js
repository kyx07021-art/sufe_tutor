/**
 * B1 收敛回归 —— detail 加密语义（encrypted 标记 / 无密钥回落 / 密钥轮换）：
 * 原语实现已在 server/crypto.js 由 crypto.test.js 全量覆盖，此处只验 log 薄壳语义。
 * 注意 bindLogDb 经 bindCryptoEnv 重置模块级密钥缓存，同进程内测试串行依赖，勿并行用例。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { bindLogDb } from '../server/log.js';
import { encryptDetail, decryptDetail } from '../server/crypto.js';

const KEY_A = Buffer.from('k'.repeat(32)).toString('base64'); // 32B → AES-256
const KEY_B = Buffer.from('j'.repeat(32)).toString('base64');

test('log detail roundtrip：encrypted=1 + 可解回明文', async () => {
  bindLogDb({ LOG_ENCRYPT_KEY: KEY_A });
  const d = await encryptDetail('{"action":"test"}');
  assert.equal(d.encrypted, 1);
  assert.ok(d.text.startsWith('enc:v1:'), '密文带版本前缀');
  assert.equal(await decryptDetail(d.text), '{"action":"test"}');
});

test('null 不入密文：encrypted=0 原样 null', async () => {
  bindLogDb({ LOG_ENCRYPT_KEY: KEY_A });
  assert.deepEqual(await encryptDetail(null), { text: null, encrypted: 0 });
});

test('无密钥（非法 key 逼 logKey 走 null）：留档加密抛错拒绝明文 + 历史密文标 [encrypted]', async () => {
  // 本地 secrets.js 必有真密钥，无法用空 env 模拟无密钥——用非法 base64 逼 logKey() 走 catch → null
  bindLogDb({ LOG_ENCRYPT_KEY: '!!not-base64!!' });
  await assert.rejects(() => encryptDetail('plain'), /fail-closed/, '无密钥留档加密抛错（v1.4.14 fail-closed，敏感 detail 绝不落明文）');
  assert.equal(await decryptDetail('enc:v1:YWJj:ZGVm'), '[encrypted]');
});

test('密钥轮换：历史密文 [undecryptable]（绝不空串）', async () => {
  bindLogDb({ LOG_ENCRYPT_KEY: KEY_A });
  const d = await encryptDetail('secret');
  bindLogDb({ LOG_ENCRYPT_KEY: KEY_B }); // 轮换密钥
  assert.equal(await decryptDetail(d.text), '[undecryptable]');
});

test('老明文行原样放行（不误判不炸）', async () => {
  bindLogDb({ LOG_ENCRYPT_KEY: KEY_A });
  assert.equal(await decryptDetail('plain-row'), 'plain-row');
});
