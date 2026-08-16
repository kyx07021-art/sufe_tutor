/**
 * 敏感配置网关（唯一入口，v1.4.14 起数据与网关合并单文件——原根目录 secrets.js 已并入本文件并删除）
 *
 * 优先级：Cloudflare Worker Secrets（env.*）＞ 本文件内联的 globalThis.APP_SECRETS（内测明文）。
 * 内测阶段 env 未绑定 → 全部回落本文件数据；公测把值上传 Worker Secrets 后回落链自然失效，
 * 业务代码零改动。迁移手册：docs/secrets-plan.md。
 *
 * 约定：业务模块禁止直接读 globalThis.APP_SECRETS 取值（网安报告 F-01c：db.js 曾绕过网关直读，
 * 已改走 getSecret*），一律经本网关。
 * 安全：本文件位于 server/ 目录，_worker.js 对 server/ 整体返回 404，公网无法下载。
 * 已知残余风险：Git 历史自 first commit 起即含 admin_sufe/admin_sufe 明文，静态 404 只能挡
 * Pages 域名、不能撤回历史——公测迁 Worker Secrets 时必须按 docs/secrets-plan.md 重置管理员
 * 密码哈希/盐 + 吊销全部 auth_sessions + 轮换 LOG_ENCRYPT_KEY（旧密文重加密或封存）。
 */

// 内测明文数据（公测迁 Worker Secrets 后此对象键仍保留占位，值随线上 env 覆盖）
globalThis.APP_SECRETS = {
  // 管理员账户（种子 + 鉴权基准）
  ADMIN_USERNAMES: ['admin_sufe'],
  ADMIN_DEFAULT_PASSWORD: 'admin_sufe',

  // 日志留档加密密钥（AES-GCM-256，base64；留档咽喉 logEvent 使用）
  LOG_ENCRYPT_KEY: 'lkFHs0M1GcoyhNiixoI9VRfsLR03BbLc9OgwQOHVtiQ=',

  // ---- 验证码通道配置（真实投递：push.spug.cc，模板编码即调用凭证）----
  // 短信模板（用户提供）：您的验证码是${code}，${number}分钟内有效，如非本人操作请忽略。
  // 参数 to=11 位裸手机号 / code=验证码 / number=有效时长分钟数（v1.4.12 起 sms 走真实通道，不再 mock）
  SMS_OTP_TEMPLATE_CODE: 'g5H9xV6xRKmOPMiq5aQiKA', // 明文存放属内测有意决策；公测迁 Worker Secrets 时随其他密钥一并轮换
  // 邮件模板正文：您正在进行${scene}，本次验证码为：${code}，请在 ${minute} 分钟内输入验证码完成验证
  EMAIL_OTP_TEMPLATE_CODE: 'v3aDVjBPM48JeX9M',
  // ---- 学信网核验通道配置（v1.2.0；缺省 manual = fail-closed，安全审计 H1）----
  // CHSI_PROVIDER: 'mock'（内测：验证码格式校验即通过，返回模拟学籍信息）| 'manual'（生产：进管理员核验队列）
  //               | 'thirdparty'（量产：第三方学历核验 API，密钥 CHSI_VERIFY_API_KEY）
  CHSI_PROVIDER: 'mock',
};

export function getSecret(env, key) {
  const fromEnv = env && env[key];
  if (fromEnv != null && fromEnv !== '') return fromEnv;
  const file = globalThis.APP_SECRETS || {};
  return file[key] != null ? file[key] : '';
}
