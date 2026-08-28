/**
 * crypto choke mutation guards (new-site foundation, in-place reuse of v2 core/crypto.js).
 *
 * Locks the fail-closed write posture (/ ): no key, or a non-32-byte key, must reject
 * writes — plaintext is never stored. Also locks the PBKDF2 password-hash round-trip (previously
 * untested) and the bindCryptoEnv key-derivation cache reset on env change.
 *
 * Mutations (reverting each fix makes these assertions go red):
 * - aesKeyFromB64 drops the 32-byte length check -> 16-byte key silently encrypts (AES-128) -> red
 * - encryptField falls back to plaintext when key is missing -> red
 * - encryptDetail falls back to plaintext when key is missing -> red
 * - verifyPassword stops re-deriving from the stored salt -> wrong-password accepted, or
 * same-salt determinism broken -> red
 * - bindCryptoEnv stops clearing KEY_CACHE -> key-rotation decrypt returns old plaintext -> red
 *
 * Note: these tests share module-level crypto state (CRYPTO_ENV / KEY_CACHE) and must run
 * serially — every test rebinds the env first (node:test runs tests in a file sequentially).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bindCryptoEnv, encryptField, decryptField, encryptDetail, decryptDetail,
  hashPassword, verifyPassword, tokenDigest,
} from '../src/server/core/crypto.js';

const KEY_A = Buffer.from('k'.repeat(32)).toString('base64'); // 32 raw bytes -> AES-256
const KEY_B = Buffer.from('j'.repeat(32)).toString('base64');
// valid base64 of exactly 16 raw bytes — would silently downgrade to AES-128 without the 32-byte check
const KEY_16 = Buffer.from('s'.repeat(16)).toString('base64');

test('S0-06 fail-closed: missing key rejects field write (no plaintext fallback)', async () => {
  bindCryptoEnv({});
  await assert.rejects(() => encryptField('phone-13800138000'), /fail-closed/,
    'no FIELD/LOG key -> encryptField must throw, never write plaintext');
});

test('S0-06 fail-closed: missing key rejects log detail write', async () => {
  bindCryptoEnv({});
  await assert.rejects(() => encryptDetail('{"secret":1}'), /fail-closed/,
    'no LOG key -> encryptDetail must throw, never store plaintext detail');
});

test('S0-06/Q-2a-F4: 16-byte valid base64 key is rejected (no silent AES-128 downgrade)', async () => {
  bindCryptoEnv({ FIELD_ENC_KEY: KEY_16 });
  await assert.rejects(() => encryptField('secret'), /fail-closed/,
    'non-32-byte raw key -> derived key null -> fail-closed reject (AES-256 only)');
  assert.equal(await decryptField('enc:v1:YWJj:ZGVm'), '[encrypted]',
    'no usable key -> history ciphertext marked [encrypted], never empty');
});

test('S0-06 round-trip: 32-byte key encrypts/decrypts AES-GCM-256', async () => {
  bindCryptoEnv({ FIELD_ENC_KEY: KEY_A });
  const enc = await encryptField('wechat:abc-123');
  assert.match(enc, /^enc:v1:/, 'ciphertext carries version prefix');
  assert.notEqual(enc, 'wechat:abc-123', 'ciphertext differs from plaintext');
  assert.equal(await decryptField(enc), 'wechat:abc-123', 'round-trip decrypt');
});

test('S0-06 bindCryptoEnv cache reset: env change re-derives keys (old ciphertext undecryptable)', async () => {
  bindCryptoEnv({ FIELD_ENC_KEY: KEY_A });
  const enc = await encryptField('rotate-me');
  bindCryptoEnv({ FIELD_ENC_KEY: KEY_B });
  assert.equal(await decryptField(enc), '[undecryptable]',
    'KEY_CACHE must be cleared on bindCryptoEnv — a stale cached KEY_A would decrypt this to plaintext (red)');
  bindCryptoEnv({ FIELD_ENC_KEY: KEY_A });
  assert.equal(await decryptField(enc), 'rotate-me', 'restoring KEY_A still decrypts (cache re-derived)');
});

test('S0-06 passwordHash/verifyPassword: PBKDF2 round-trip', async () => {
  const { hash, salt } = await hashPassword('correct-horse-battery');
  assert.equal(hash.length, 128, '512-bit PBKDF2 output -> 128 hex chars');
  assert.equal(salt.length, 32, '16 random salt bytes -> 32 hex chars');
  assert.equal(await verifyPassword('correct-horse-battery', hash, salt), true, 'correct password verifies');
  assert.equal(await verifyPassword('wrong-password', hash, salt), false, 'wrong password rejected');
});

test('S0-06 passwordHash determinism: same password+salt -> same hash; no salt -> fresh salt each call', async () => {
  const { hash: h1 } = await hashPassword('pw', 'aabbccddeeff00112233445566778899');
  const { hash: h2 } = await hashPassword('pw', 'aabbccddeeff00112233445566778899');
  assert.equal(h1, h2, 'same salt + same password -> deterministic hash (mutation: random salt ignored -> red)');
  const a = await hashPassword('pw');
  const b = await hashPassword('pw');
  assert.notEqual(a.salt, b.salt, 'no existing salt -> fresh random salt per call');
  assert.notEqual(a.hash, b.hash, 'fresh salts -> distinct hashes');
});

test('S0-06 tokenDigest: SHA-256 64-hex digest, never reversible to plaintext', async () => {
  const t = 'tok-secret-value';
  const d = await tokenDigest(t);
  assert.equal(d.length, 64, 'SHA-256 -> 64 hex');
  assert.equal(await tokenDigest(t), d, 'stable digest');
  assert.ok(!d.includes('secret'), 'digest must not embed plaintext');
});
