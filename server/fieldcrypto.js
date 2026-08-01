/**
 * 敏感字段加密（网安报告 F-06：联系方式等敏感字段不再明文落库）
 * AES-GCM-256，密文格式 enc:v1:<iv_b64>:<ct_b64>（与 log.js detail 加密同构，可互读互换）
 * 密钥经 secrets 网关：FIELD_ENC_KEY 优先，未配置回落 LOG_ENCRYPT_KEY（公测迁独立 FIELD_ENC_KEY）
 * 语义与 log.js 对齐：无密钥环境明文写入（内测兼容；生产经 secrets 网关必有密钥）；
 * 解密失败回 '[undecryptable]' 标记——绝不含空串（防前端编辑空串覆盖密文的二次泄露）
 */
import { getSecret } from './secrets.js';

let FIELD_ENV = null;
let KEY_PROMISE = null;
const b64ToBytes = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
const bytesToB64 = bytes => btoa(String.fromCharCode(...bytes));

function fieldKey() {
  if (!KEY_PROMISE) {
    KEY_PROMISE = (async () => {
      try {
        const raw = String(getSecret(FIELD_ENV, 'FIELD_ENC_KEY') || getSecret(FIELD_ENV, 'LOG_ENCRYPT_KEY') || '');
        if (!raw) return null;
        return await crypto.subtle.importKey('raw', b64ToBytes(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);
      } catch { return null; }
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
  try {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(s));
    return `enc:v1:${bytesToB64(iv)}:${bytesToB64(new Uint8Array(ct))}`;
  } catch { return s; }
}

export async function decryptField(text) {
  if (typeof text !== 'string' || !text.startsWith('enc:v1:')) return text; // 老明文行原样放行
  const key = await fieldKey();
  if (!key) return '[encrypted]';
  try {
    const parts = text.split(':');
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(parts[2]) }, key, b64ToBytes(parts[3]));
    return new TextDecoder().decode(pt);
  } catch { return '[undecryptable]'; } // 密钥轮换后的历史密文：标记不可解，不抛错
}
