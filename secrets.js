/**
 * 敏感配置存放处（内测阶段 · 明文本地维护）
 *
 * 读取方一律经 server/secrets.js 网关：Cloudflare Worker Secrets（env.*）优先，
 * 未配置回落本文件。公测迁移全流程见 docs/secrets-plan.md —— 届时本文件全部值
 * 上传 Worker Secrets，仓库内本文件被占位版强推覆盖并加入 .gitignore。
 *
 * 安全：_worker.js 对 /secrets.js 路径统一返回 404，浏览器无法下载本文件源码。
 */
globalThis.APP_SECRETS = {
  // 管理员账户（种子 + 鉴权基准）
  ADMIN_USERNAMES: ['admin_sufe'],
  ADMIN_DEFAULT_PASSWORD: 'admin_sufe',

  // 日志留档加密密钥（AES-GCM-256，base64；留档咽喉 logEvent 使用）
  LOG_ENCRYPT_KEY: 'lkFHs0M1GcoyhNiixoI9VRfsLR03BbLc9OgwQOHVtiQ=',

  // ---- 未来敏感字段（公测 API 到手即填入，并按 secrets-plan.md 同步上传 Worker Secrets）----
  // 短信服务（SMS 验证码：注销账户 / 撤销合同的危险操作确认，见 docs/sms-plan.md）
  SMS_ACCESS_KEY_ID: '',
  SMS_ACCESS_KEY_SECRET: '',
  SMS_SIGN_NAME: '',
  SMS_TEMPLATE_CODE: '',
};
