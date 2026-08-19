/**
 * 测试专用密钥源（v2.0.0 fail-open 清除配套）
 *
 * 背景：server/secrets.js 已删除 globalThis.APP_SECRETS 明文回落（fail-closed：只读 env，
 * 仓库零明文密钥）。此前大量测试依赖该回落块给 initDb/bindCryptoEnv 提供 FIELD_ENC_KEY /
 * LOG_ENCRYPT_KEY 等密钥——现在必须显式注入。本文件即测试侧的显式密钥单源：
 * 测试 ENV 展开用 ...TEST_SECRETS，避免每个测试文件重复裸密钥字符串。
 *
 * 约定：这些值仅用于本地 node 测试（内存库/无真实外部依赖），与生产 Worker Secrets 无任何
 * 对应关系，不得出现在 dist 产物中（build 只打包 src/ 与 _worker.js，test/ 不部署）。
 */
export const TEST_SECRETS = {
  FIELD_ENC_KEY: 'RkZGRkZGRkZGRkZGRkZGRklJSUlJSUlJSUlJSUlJSUk=', // 32 原始字节的合法 base64（AES-GCM-256）
  LOG_ENCRYPT_KEY: 'TExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEw=',
  FIELD_ENC_KEY_OLD: '',
  LOG_ENCRYPT_KEY_OLD: '',
  SMS_OTP_TEMPLATE_CODE: 'test-sms-template-code',
  EMAIL_OTP_TEMPLATE_CODE: 'test-email-template-code',
  TEXT_AUDIT_API_KEY: 'test-audit-key',
};
