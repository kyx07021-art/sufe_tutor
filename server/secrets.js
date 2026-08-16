/**
 * 敏感配置网关（v1.5.0：生产 fail-closed，本地/测试 fail-open）
 *
 * 取值顺序：
 *   1. env（Cloudflare Worker Secrets / wrangler .dev.vars / 测试注入）
 *   2. 本文件 globalThis.APP_SECRETS —— 仅本地开发与 node 测试的便利数据。
 *
 * 生产判定：env.CF_PAGES_URL / CF_PAGES_COMMIT_SHA 存在即视为生产运行时，
 * 此时绝不回落仓库文件；缺 env 值 = 空串，由各咽喉 fail-closed 或 Release Gate 拦截。
 * 公测上线仍须按 docs/secrets-plan.md 轮换全部密钥与管理员凭据（仓库历史含旧值）。
 *
 * 约定：业务模块禁止直接读 globalThis.APP_SECRETS，一律经本网关。
 */

// 仅本地开发 / 测试使用的明文数据（生产运行时永不读取）
globalThis.APP_SECRETS = {
  // 本地管理员种子（生产用 Worker Secrets 覆盖）
  ADMIN_USERNAMES: ['admin_sufe'],
  ADMIN_DEFAULT_PASSWORD: 'admin_sufe',

  // 本地日志留档加密密钥（AES-GCM-256，base64；生产用 Worker Secrets 覆盖）
  LOG_ENCRYPT_KEY: 'lkFHs0M1GcoyhNiixoI9VRfsLR03BbLc9OgwQOHVtiQ=',

  // 本地验证码通道模板编码（生产用 Worker Secrets 覆盖）
  SMS_OTP_TEMPLATE_CODE: 'g5H9xV6xRKmOPMiq5aQiKA',
  EMAIL_OTP_TEMPLATE_CODE: 'v3aDVjBPM48JeX9M',
};

export function isProductionRuntime(env) {
  return !!(env && (env.CF_PAGES_URL || env.CF_PAGES_COMMIT_SHA));
}

export function getSecret(env, key) {
  const fromEnv = env && env[key];
  if (fromEnv != null && fromEnv !== '') return fromEnv;
  if (isProductionRuntime(env)) return ''; // 生产绝不读仓库文件
  const file = globalThis.APP_SECRETS || {};
  return file[key] != null ? file[key] : '';
}
