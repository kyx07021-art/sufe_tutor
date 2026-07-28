/**
 * 敏感配置读取网关（唯一入口）
 *
 * 优先级：Cloudflare Worker Secrets（env.*）＞ 本地 secrets.js（globalThis.APP_SECRETS）。
 * 内测阶段 env 未绑定 → 全部回落本地文件；公测把值上传 Worker Secrets 后回落链自然失效，
 * 业务代码零改动。迁移手册：docs/secrets-plan.md。
 *
 * 约定：业务模块禁止直接 import '../secrets.js' 取值，一律走本网关的 getSecret*。
 */
import '../secrets.js';

export function getSecret(env, key) {
  const fromEnv = env && env[key];
  if (fromEnv != null && fromEnv !== '') return fromEnv;
  const file = globalThis.APP_SECRETS || {};
  return file[key] != null ? file[key] : '';
}

// 列表型 secret：env 里是逗号分隔字符串（Worker Secrets 只能存字符串），本地文件可以是数组
export function getSecretList(env, key) {
  const v = getSecret(env, key);
  if (Array.isArray(v)) return v;
  return String(v || '').split(',').map(s => s.trim()).filter(Boolean);
}
