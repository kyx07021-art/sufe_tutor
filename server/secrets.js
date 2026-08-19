/**
 * 敏感配置网关（v2.0.0：全链路 fail-closed，本地/测试同样零明文回落）
 *
 * 取值：仅 env（Cloudflare Worker Secrets / wrangler .dev.vars / 测试显式注入）。
 * 仓库不再存放任何明文密钥；缺 env 值 = 空串，由各咽喉 fail-closed 或 Release Gate 拦截。
 *
 * 本地开发 / 测试：一律经 .dev.vars（wrangler 读取，已 gitignore）或调用方 bindXxxEnv/env 显式注入，
 * 禁止回落到仓库文件。公测上线仍须按 docs/secrets-plan.md 轮换全部密钥与管理员凭据。
 *
 * 约定：业务模块禁止自行捏造密钥来源，一律经本网关读 env。
 */

export function isProductionRuntime(env) {
  return !!(env && (env.CF_PAGES_URL || env.CF_PAGES_COMMIT_SHA));
}

export function getSecret(env, key) {
  const fromEnv = env && env[key];
  if (fromEnv != null && fromEnv !== '') return fromEnv;
  return ''; // fail-closed：无 env 即空串，绝不回落仓库明文
}
