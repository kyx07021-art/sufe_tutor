/**
 * 网安报告 F-04/F-06 —— 密码学回归测试：
 * tokenDigest SHA-256 固定向量（F-04 会话令牌摘要化）；
 * crypto.js AES-GCM roundtrip + 密钥轮换/无密钥语义（F-06 联系方式加密列）。
 * 注意 bindCryptoEnv 重置模块级密钥缓存，同进程内测试串行依赖，勿并行用例。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenDigest } from '../server/crypto.js';
import { bindCryptoEnv, encryptField, decryptField } from '../server/crypto.js';

const KEY_A = Buffer.from('k'.repeat(32)).toString('base64'); // 32B → AES-256
const KEY_B = Buffer.from('j'.repeat(32)).toString('base64');

test('tokenDigest：SHA-256 固定向量（空串 / abc）', async () => {
  assert.equal(await tokenDigest(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(await tokenDigest('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('tokenDigest：摘要稳定且不可逆出明文', async () => {
  const t = 'tok_abc123XYZ';
  assert.equal(await tokenDigest(t), await tokenDigest(t));
  const d = await tokenDigest(t);
  assert.ok(!d.includes('abc123'), '摘要不得包含明文片段');
});

test('字段加解密 roundtrip（密文带 enc:v1: 前缀）', async () => {
  bindCryptoEnv({ FIELD_ENC_KEY: KEY_A });
  const enc = await encryptField('13800138000');
  assert.ok(enc.startsWith('enc:v1:'), '密文带版本前缀');
  assert.notEqual(enc, '13800138000');
  assert.equal(await decryptField(enc), '13800138000');
});

test('两次加密不同 IV → 密文不可比', async () => {
  bindCryptoEnv({ FIELD_ENC_KEY: KEY_A });
  const a = await encryptField('same-value');
  const b = await encryptField('same-value');
  assert.notEqual(a, b, '随机 IV，同明文密文互异');
  assert.equal(await decryptField(a), 'same-value');
  assert.equal(await decryptField(b), 'same-value');
});

test('老明文行原样放行（不误判不炸）', async () => {
  bindCryptoEnv({ FIELD_ENC_KEY: KEY_A });
  assert.equal(await decryptField('plain-contact'), 'plain-contact');
});

test('密钥轮换后的历史密文 → [undecryptable]（绝不空串）', async () => {
  bindCryptoEnv({ FIELD_ENC_KEY: KEY_A });
  const enc = await encryptField('wechat:abc');
  bindCryptoEnv({ FIELD_ENC_KEY: KEY_B }); // 轮换密钥
  assert.equal(await decryptField(enc), '[undecryptable]');
  bindCryptoEnv({ FIELD_ENC_KEY: KEY_A }); // 换回原密钥仍可解
  assert.equal(await decryptField(enc), 'wechat:abc');
});

test('取不到密钥（非法 key 使 importKey 失败）：加密抛错拒绝明文、解历史密文标记 [encrypted]', async () => {
  // 本地 secrets.js 必有真密钥（故意保留），无法用空 env 模拟无密钥——用非法 base64 逼派生走 catch → null
  bindCryptoEnv({ FIELD_ENC_KEY: '!!not-base64!!' });
  await assert.rejects(() => encryptField('plain'), /fail-closed/, '无密钥加密抛错（v1.4.14 fail-closed，绝不落明文）');
  assert.equal(await decryptField('enc:v1:YWJj:ZGVm'), '[encrypted]');
});

test('空值加密原样空串（不产生密文占位）', async () => {
  bindCryptoEnv({ FIELD_ENC_KEY: KEY_A });
  assert.equal(await encryptField(''), '');
  assert.equal(await encryptField(null), '');
  assert.equal(await decryptField(''), '');
});
