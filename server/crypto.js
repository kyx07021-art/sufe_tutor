/**
 * 加密咽喉（目标分层：加密咽喉）—— 全站密码学的唯一实现点
 *
 * 收敛自：server/fieldcrypto.js（敏感字段 AES-GCM-256）+ server/core.js 的密码学部分
 * （hashPassword/verifyPassword/tokenDigest/bufToHex）+ server/log.js 的密钥派生（logKey）。
 *
 * 职责：
 *   - 密钥派生单点：deriveKey(secretName) 带模块级缓存，env 变更经 bindCryptoEnv 清缓存。
 *   - AES-GCM-256 原语（encryptAes/decryptAes），密文格式 enc:v1:<iv_b64>:<ct_b64>。
 *   - 密码哈希 PBKDF2（参数单源自 constants.SECURITY）。
 *   - 字段级加密（encryptField/decryptField，FIELD_ENC_KEY 优先回落 LOG_ENCRYPT_KEY）
 *     与留档 detail 加密（encryptDetail/decryptDetail，LOG_ENCRYPT_KEY）——
 *     两者回落语义一致：无密钥退明文（内测兼容，已测试锁定）、解密失败标 [undecryptable]、
 *     无密钥解历史密文标 [encrypted]。明文回落路径 console.warn 显式告警（防配置失误静默降级）。
 *
 * 密钥一律经 secrets 网关（getSecret：env Worker Secrets 优先，回落本地 secrets.js）。
 */
import { getSecret } from './secrets.js';
import { SECURITY } from './constants.js';

// ============================================================
// 字节 <-> hex / b64
// ============================================================
export function bufToHex(buf) {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export const b64ToBytes = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
export const bytesToB64 = bytes => btoa(String.fromCharCode(...bytes));

// ============================================================
// AES-GCM 原语
// ============================================================
/** b64 密钥 → AES-GCM CryptoKey；非法密钥返回 null（不抛，调用方按无密钥语义回落） */
export async function aesKeyFromB64(b64) {
  try {
    return await crypto.subtle.importKey('raw', b64ToBytes(b64), 'AES-GCM', false, ['encrypt', 'decrypt']);
  } catch { return null; }
}

/** AES-GCM 加密 → 'enc:v1:<iv_b64>:<ct_b64>'；加密失败返回 null */
export async function encryptAes(key, text) {
  try {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
    return `enc:v1:${bytesToB64(iv)}:${bytesToB64(new Uint8Array(ct))}`;
  } catch { return null; }
}

/** AES-GCM 解密：老明文行原样放行；解密失败回 '[undecryptable]'（密钥轮换后的历史密文标记，不抛错） */
export async function decryptAes(key, text) {
  if (typeof text !== 'string' || !text.startsWith('enc:v1:')) return text;
  try {
    const parts = text.split(':');
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(parts[2]) }, key, b64ToBytes(parts[3]));
    return new TextDecoder().decode(pt);
  } catch { return '[undecryptable]'; }
}

// ============================================================
// 密钥派生单点（模块级缓存；env 变更清缓存重派生）
// ============================================================
let CRYPTO_ENV = null;
const KEY_CACHE = new Map(); // secretName → Promise<CryptoKey|null>

/** 绑定加密环境（env 变更 → 清全部密钥缓存）。initDb 与 log.bindLogDb 各调一次。 */
export function bindCryptoEnv(env) {
  CRYPTO_ENV = env;
  KEY_CACHE.clear();
}

function deriveKey(secretName) {
  if (!KEY_CACHE.has(secretName)) {
    KEY_CACHE.set(secretName, (async () => {
      const raw = String(getSecret(CRYPTO_ENV, secretName) || '');
      if (!raw) return null;
      return aesKeyFromB64(raw);
    })());
  }
  return KEY_CACHE.get(secretName);
}

// ============================================================
// 密码哈希（PBKDF2，参数单源自 constants.SECURITY）
// ============================================================
/** 计算口令哈希：existingSalt 缺省则生成新盐；返回 { hash, salt } */
export async function hashPassword(password, existingSalt) {
  const salt = existingSalt || bufToHex(crypto.getRandomValues(new Uint8Array(16)));
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: SECURITY.PBKDF2_ITERATIONS, hash: SECURITY.PBKDF2_HASH },
    keyMaterial, 512
  );
  return { hash: bufToHex(bits), salt };
}

/** 口令校验：同参数重算比对 */
export async function verifyPassword(password, storedHash, salt) {
  const { hash } = await hashPassword(password, salt);
  return hash === storedHash;
}

/** 令牌摘要化（网安报告 F-04）：库内只存 SHA-256(token)，令牌明文永不落库 */
export async function tokenDigest(token) {
  return bufToHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
}

// ============================================================
// 字段级加密（敏感列出门即解密；FIELD_ENC_KEY 优先回落 LOG_ENCRYPT_KEY）
// 回落语义：FIELD_ENC_KEY 已配置（含非法值）即以其为准——非法值派生失败 → fail-open；
// 仅当 FIELD_ENC_KEY 未配置时才回落 LOG_ENCRYPT_KEY（内测共用密钥，与 log 留档同源）
// ============================================================
async function fieldKeyName() {
  return String(getSecret(CRYPTO_ENV, 'FIELD_ENC_KEY') || '') ? 'FIELD_ENC_KEY' : 'LOG_ENCRYPT_KEY';
}

/** 加密：空串原样；无密钥/加密失败退明文（fail-open 内测语义，console.warn 告警） */
export async function encryptField(text) {
  const s = String(text || '');
  if (!s) return s;
  const key = await deriveKey(await fieldKeyName());
  if (!key) { console.warn('encryptField: 字段密钥未配置，明文写入（内测兼容）'); return s; }
  const ct = await encryptAes(key, s);
  if (!ct) { console.warn('encryptField: 加密失败退明文'); return s; }
  return ct;
}

/** 解密：老明文行原样放行；无密钥标 '[encrypted]'；解密失败标 '[undecryptable]' */
export async function decryptField(text) {
  if (typeof text !== 'string' || !text.startsWith('enc:v1:')) return text;
  const key = await deriveKey(await fieldKeyName());
  if (!key) return '[encrypted]';
  return decryptAes(key, text);
}

// ============================================================
// 留档 detail 加密（LOG_ENCRYPT_KEY；加密后 schema_v=2、encrypted=1）
// ============================================================
/** 导出供 node --test 回归（test/log-crypto.test.js），语义不变 */
export async function encryptDetail(json) {
  if (json === null || json === undefined) return { text: null, encrypted: 0 };
  const key = await deriveKey('LOG_ENCRYPT_KEY');
  if (!key) { console.warn('encryptDetail: LOG_ENCRYPT_KEY 未配置，明文留档（内测兼容）'); return { text: json, encrypted: 0 }; }
  const ct = await encryptAes(key, json);
  return ct ? { text: ct, encrypted: 1 } : { text: json, encrypted: 0 };
}

export async function decryptDetail(text) {
  if (typeof text !== 'string' || !text.startsWith('enc:v1:')) return text;
  const key = await deriveKey('LOG_ENCRYPT_KEY');
  if (!key) return '[encrypted]';
  return decryptAes(key, text);
}
