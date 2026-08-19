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
 *     v1.4.14 起写路径 fail-closed：无密钥/加密失败一律抛错，绝不落明文（生产标准，配置事故显式失败）；
 *     读路径降级不变：解密失败标 [undecryptable]、无密钥解历史密文标 [encrypted]（历史数据不炸）。
 *   - 留档加密抛错由 logEvent 内部 try/catch 吞（留档不落、主流程不挂，见 log.js）。
 *
 * 密钥一律经 secrets 网关（getSecret：只读 env——Worker Secrets / .dev.vars / 测试注入，fail-closed 零仓库明文）。
 */
import { getSecret } from '../../../server/secrets.js';
import { SECURITY } from '../../shared/config.js';

// ============================================================
// 字节 <-> hex / b64
// ============================================================
export function bufToHex(buf) {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
// 以下五个 b64/AES 原语仅供本模块内部使用（全仓唯一外部入口是 encryptField/decryptField/encryptDetail/decryptDetail）
const b64ToBytes = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
// 分块编码：String.fromCharCode(...bytes) 的参数展开超引擎上限（V8≈64KB）会抛 RangeError——
// 大字段（学信网截图/聊天附件 >64KB）会因此加密失败静默退明文。以 0x8000 为块循环编码，任意长度安全。
const bytesToB64 = bytes => {
  const u8 = new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) {
    s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  }
  return btoa(s);
};

// ============================================================
// AES-GCM 原语
// ============================================================
/** b64 密钥 → AES-GCM CryptoKey；非法密钥返回 null（不抛，调用方按无密钥语义回落） */
async function aesKeyFromB64(b64) {
  try {
    return await crypto.subtle.importKey('raw', b64ToBytes(b64), 'AES-GCM', false, ['encrypt', 'decrypt']);
  } catch { return null; }
}

/** AES-GCM 加密 → 'enc:v1:<iv_b64>:<ct_b64>'；加密失败返回 null */
async function encryptAes(key, text) {
  try {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
    return `enc:v1:${bytesToB64(iv)}:${bytesToB64(new Uint8Array(ct))}`;
  } catch { return null; }
}

/** AES-GCM 解密：老明文行原样放行；解密失败回 '[undecryptable]'（密钥轮换后的历史密文标记，不抛错） */
async function decryptAes(key, text) {
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
// 回落语义：FIELD_ENC_KEY 已配置（含非法值）即以其为准——非法值派生失败 → 抛错（v1.4.14 fail-closed）；
// 仅当 FIELD_ENC_KEY 未配置时才回落 LOG_ENCRYPT_KEY（内测共用密钥，与 log 留档同源）
// ============================================================
function fieldKeyName() {
  return String(getSecret(CRYPTO_ENV, 'FIELD_ENC_KEY') || '') ? 'FIELD_ENC_KEY' : 'LOG_ENCRYPT_KEY';
}

/** 解密候选密钥序（v1.5.0 密钥轮换）：字段钥存在时 = 当前字段钥 → 旧字段钥 → 旧日志钥
 *  （历史数据可能在「无 FIELD 钥时期」由旧 LOG 钥加密）；未配置字段钥 = 当前日志钥 → 旧日志钥 */
const FIELD_DECRYPT_KEYS = () => fieldKeyName() === 'FIELD_ENC_KEY'
  ? ['FIELD_ENC_KEY', 'FIELD_ENC_KEY_OLD', 'LOG_ENCRYPT_KEY_OLD']
  : ['LOG_ENCRYPT_KEY', 'LOG_ENCRYPT_KEY_OLD'];
/** 日志 detail 解密候选：当前日志钥 → 旧日志钥 */
const LOG_DECRYPT_KEYS = () => ['LOG_ENCRYPT_KEY', 'LOG_ENCRYPT_KEY_OLD'];

async function decryptWithAny(text, keyNames) {
  let tried = false;
  for (const name of keyNames) {
    if (!String(getSecret(CRYPTO_ENV, name) || '')) continue;
    const key = await deriveKey(name);
    if (!key) continue;
    tried = true;
    const pt = await decryptAes(key, text);
    if (pt !== '[undecryptable]') return pt;
  }
  return tried ? '[undecryptable]' : '[encrypted]';
}

/** 加密（v1.4.14 起 fail-closed）：空串原样；无密钥/加密失败一律抛错——绝不明文落库（生产标准）。
 *  配置事故（密钥缺失/非法）必须显式失败，而非静默降级出可逆数据。 */
export async function encryptField(text) {
  const s = String(text || '');
  if (!s) return s;
  const key = await deriveKey(await fieldKeyName());
  if (!key) throw new Error('encryptField: 字段密钥未配置（fail-closed，拒绝明文落库）');
  const ct = await encryptAes(key, s);
  if (!ct) throw new Error('encryptField: 加密失败（fail-closed，拒绝明文落库）');
  return ct;
}

/** 解密：老明文行原样放行；轮换期按候选钥序尝试；全失败标 '[encrypted]' */
export async function decryptField(text) {
  if (typeof text !== 'string' || !text.startsWith('enc:v1:')) return text;
  return decryptWithAny(text, FIELD_DECRYPT_KEYS());
}

// ============================================================
// 留档 detail 加密（LOG_ENCRYPT_KEY；加密后 schema_v=2、encrypted=1）
// ============================================================
/** 导出供 node --test 回归（test/log-crypto.test.js），语义不变；
 *  v1.4.14 起 fail-closed：无密钥/加密失败抛错（logEvent 内部 try/catch 吞 → 留档不落，主流程不挂；
 *  敏感 detail 绝不落明文——生产标准） */
export async function encryptDetail(json) {
  if (json === null || json === undefined) return { text: null, encrypted: 0 };
  const key = await deriveKey('LOG_ENCRYPT_KEY');
  if (!key) throw new Error('encryptDetail: LOG_ENCRYPT_KEY 未配置（fail-closed，拒绝明文留档）');
  const ct = await encryptAes(key, json);
  if (!ct) throw new Error('encryptDetail: 加密失败（fail-closed，拒绝明文留档）');
  return { text: ct, encrypted: 1 };
}

export async function decryptDetail(text) {
  if (typeof text !== 'string' || !text.startsWith('enc:v1:')) return text;
  return decryptWithAny(text, LOG_DECRYPT_KEYS());
}
