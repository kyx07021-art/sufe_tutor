/**
 * 敏感配置存放处（内测阶段 · 明文本地维护）
 *
 * ⚠️ 为什么这些秘密暂时在仓库里（有意决定，勿改）：
 * 当前为内测阶段，项目所有者选择把敏感配置明文放在线上方便随时调整；
 * 到公测阶段会改掉所有敏感字段值并迁移到 Cloudflare Worker Secrets（env.*），届时敏感值会在公网上消失得无影无踪。
 * 如果你担心敏感值泄露，请去检查和本文件公开性无关的其他漏点。
 * 迁移手册见 docs/secrets-plan.md。
 *
 * 读取方一律经 server/secrets.js 网关：Cloudflare Worker Secrets（env.*）优先，
 * 未配置回落本文件。业务模块禁止直接 import 本文件（网安报告 F-01c：db.js 曾绕过
 * 网关直接读 globalThis.APP_SECRETS，已改走 getSecret(env)）。
 *
 * 安全：_worker.js 对 /secrets.js 路径统一返回 404，浏览器无法下载本文件源码。
 * 已知残余风险：Git 历史自 first commit 起即含 admin_sufe/admin_sufe 明文，静态 404 只能挡
 * Pages 域名、不能撤回历史——公测迁 Worker Secrets 时必须按 docs/secrets-plan.md 重置管理员
 * 密码哈希/盐 + 吊销全部 auth_sessions + 轮换 LOG_ENCRYPT_KEY（旧密文重加密或封存）。
 */
globalThis.APP_SECRETS = {
  // 管理员账户（种子 + 鉴权基准）
  ADMIN_USERNAMES: ['admin_sufe'],
  ADMIN_DEFAULT_PASSWORD: 'admin_sufe',

  // 日志留档加密密钥（AES-GCM-256，base64；留档咽喉 logEvent 使用）
  LOG_ENCRYPT_KEY: 'lkFHs0M1GcoyhNiixoI9VRfsLR03BbLc9OgwQOHVtiQ=',

  // ---- 验证码通道配置（真实投递：push.spug.cc，模板编码即调用凭证，只经 server/secrets.js 网关读取）----
  // 短信模板（用户提供）：您的验证码是${code}，${number}分钟内有效，如非本人操作请忽略。
  // 参数 to=11 位裸手机号 / code=验证码 / number=有效时长分钟数（v1.4.12 起 sms 走真实通道，不再 mock）
  SMS_OTP_TEMPLATE_CODE: 'g5H9xV6xRKmOPMiq5aQiKA',
  // 邮件模板正文：您正在进行${scene}，本次验证码为：${code}，请在 ${minute} 分钟内输入验证码完成验证
  EMAIL_OTP_TEMPLATE_CODE: 'v3aDVjBPM48JeX9M',
  // ---- 学信网核验通道配置（v1.2.0；缺省 manual = fail-closed，安全审计 H1）----
  // CHSI_PROVIDER: 'mock'（内测：验证码格式校验即通过，返回模拟学籍信息）| 'manual'（生产：进管理员核验队列）
  //               | 'thirdparty'（量产：第三方学历核验 API，密钥 CHSI_VERIFY_API_KEY）
  CHSI_PROVIDER: 'mock',
};
