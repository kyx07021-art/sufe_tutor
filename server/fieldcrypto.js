/**
 * 敏感字段加密（网安报告 F-06：联系方式等敏感字段不再明文落库）
 * AES-GCM-256，密文格式 enc:v1:<iv_b64>:<ct_b64>（与 log.js detail 加密同构，可互读互换）
 * 密钥经 secrets 网关：FIELD_ENC_KEY 优先，未配置回落 LOG_ENCRYPT_KEY（公测迁独立 FIELD_ENC_KEY）
 * 语义与 log.js 对齐：无密钥环境明文写入（内测兼容；生产经 secrets 网关必有密钥）；
 * 解密失败回 '[undecryptable]' 标记——绝不含空串（防前端编辑空串覆盖密文的二次泄露）
 */
import { getSecret } from './secrets.js';

// ============================================================
// AES-GCM 原语（v0.19.40 收敛：log.js detail 加密的 b64 互转/密钥派生/加解密
// 原与此处逐字重复，已统一收进本文件导出；加密/解密语义与回落策略各自持有）
// ============================================================
export const b64ToBytes = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
export const bytesToB64 = bytes => btoa(String.fromCharCode(...bytes));

/** b64 密钥 → AES-GCM CryptoKey；非法密钥返回 null（不抛，调用方按无密钥语义回落） */
export async function aesKeyFromB64(b64) {
  try {
    return await crypto.subtle.importKey('raw', b64ToBytes(b64), 'AES-GCM', false, ['encrypt', 'decrypt']);
  } catch { return null; }
}

/** AES-GCM 加密 → 'enc:v1:<iv_b64>:<ct_b64>'；加密失败返回 null（调用方决定回落明文/标记） */
export async function encryptAes(key, text) {
  try {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
    return `enc:v1:${bytesToB64(iv)}:${bytesToB64(new Uint8Array(ct))}`;
  } catch { return null; }
}

/** AES-GCM 解密：老明文行原样放行；解密失败回 '[undecryptable]'（密钥轮换后的历史密文标记不可解，不抛错） */
export async function decryptAes(key, text) {
  if (typeof text !== 'string' || !text.startsWith('enc:v1:')) return text; // 老明文行原样放行
  try {
    const parts = text.split(':');
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(parts[2]) }, key, b64ToBytes(parts[3]));
    return new TextDecoder().decode(pt);
  } catch { return '[undecryptable]'; }
}

let FIELD_ENV = null;
let KEY_PROMISE = null;

function fieldKey() {
  if (!KEY_PROMISE) {
    KEY_PROMISE = (async () => {
      const raw = String(getSecret(FIELD_ENV, 'FIELD_ENC_KEY') || getSecret(FIELD_ENV, 'LOG_ENCRYPT_KEY') || '');
      if (!raw) return null;
      return aesKeyFromB64(raw);
    })();
  }
  return KEY_PROMISE;
}

export function bindFieldEnv(env) { FIELD_ENV = env; KEY_PROMISE = null; } // env 变更 → 密钥重派生

export async function encryptField(text) {
  const s = String(text || '');
  if (!s) return s;
  const key = await fieldKey();
  if (!key) return s; // 无密钥环境：明文写（与 log.js 同款内测兼容语义）
  return (await encryptAes(key, s)) ?? s; // 加密失败退明文（与 log.js 同款）
}

export async function decryptField(text) {
  if (typeof text !== 'string' || !text.startsWith('enc:v1:')) return text; // 老明文行原样放行
  const key = await fieldKey();
  if (!key) return '[encrypted]';
  return decryptAes(key, text);
}
