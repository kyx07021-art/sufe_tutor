/**
 * 生产配置自检（v1.5.0 Release Gate）——正式上线前把「人检查」变成「启动即拒绝」。
 *
 * 判定生产运行时的唯一依据 = Cloudflare Pages 运行时注入的环境信号（CF_PAGES_URL /
 * CF_PAGES_COMMIT_SHA 仅生产部署存在；本地 wrangler pages dev / node 测试无此信号，
 * 不受生产门槛影响，测试注入 stub env 的开发流程不变）。
 *
 * 失败语义：生产缺任一必需 Secret / 配置仍在 mock → /api/* 一律 503 not-ready；
 * 静态资源照常服务（发版脚本在 push 后 curl /api/health 判 ready，不 ready 视为部署失败）。
 */
import { json } from '../src/server/core/util.js';
import { INVITE_GATE_ENABLED, INVITE_GATE_DORMANT, LEGACY_ADMIN_PASSWORD } from '../src/shared/config.js';
import { isProductionRuntime } from './secrets.js';

/** 只从 env 读（不看仓库文件回落）——Release Gate 检查的就是「Worker Secrets 是否真的配了」 */
function envSecret(env, key) {
  return env && env[key] != null && String(env[key]).trim() !== '' ? String(env[key]).trim() : '';
}

// Q-2a-F4: 密钥必须 base64 合法且解出 32 字节（AES-GCM-256），否则 encryptField 运行期抛错——
// Gate 若只查非空会假绿，生产全写路径 500。用 atob 判字节数（与 core/crypto.js 既有安全
// base64 模式一致），不依赖全局 Buffer——workerd 运行时在未启用 nodejs_compat 时无 Buffer，
// 依赖它会让 Gate 恒 not-ready → 全站 /api/* 503（Q-2a 审计实证，已回滚重做）。
const isAes256B64 = v => {
  try {
    return atob(String(v)).length === 32; // atob 输出串长度 = 原始字节数（每字节一 char）
  } catch { return false; }
};

/** 返回 { ok, checks:[{code, pass}] }。code 不携带任何秘密值。 */
export function productionConfigChecks(env) {
  if (!isProductionRuntime(env)) return { ok: true, checks: [] };
  const checks = [];
  const add = (code, pass) => checks.push({ code, pass: !!pass });

  // 必需加密/通道密钥（缺一/非法 = 生产不 ready；Q-2a-F4 补 base64 可导入校验防假绿）
  add('LOG_ENCRYPT_KEY', isAes256B64(envSecret(env, 'LOG_ENCRYPT_KEY')));
  add('FIELD_ENC_KEY', isAes256B64(envSecret(env, 'FIELD_ENC_KEY')) && envSecret(env, 'FIELD_ENC_KEY') !== envSecret(env, 'LOG_ENCRYPT_KEY'));
  add('SMS_OTP_TEMPLATE_CODE', envSecret(env, 'SMS_OTP_TEMPLATE_CODE').length > 0);
  add('EMAIL_OTP_TEMPLATE_CODE', envSecret(env, 'EMAIL_OTP_TEMPLATE_CODE').length > 0);
  add('TEXT_AUDIT_API_KEY', envSecret(env, 'TEXT_AUDIT_API_KEY').length > 0);

  // 管理员凭据已轮换（不允许沿用仓库历史明文）
  const adminPassword = envSecret(env, 'ADMIN_DEFAULT_PASSWORD');
  add('ADMIN_CREDENTIAL_ROTATED', adminPassword.length >= 12 && adminPassword !== LEGACY_ADMIN_PASSWORD);
  add('ADMIN_USERNAMES', envSecret(env, 'ADMIN_USERNAMES').length > 0);

  // 学信网核验：mock/thirdparty 占位均不允许出现在生产
  const chsi = envSecret(env, 'CHSI_PROVIDER');
  add('CHSI_PROVIDER_MANUAL', !chsi || chsi === 'manual');

  // 密钥轮换：迁移窗口内必须带旧钥；重加密完成并显式置位后允许只留新钥
  const rotationDone = envSecret(env, 'CRYPTO_REENCRYPT_DONE') === 'true';
  add('CRYPTO_ROTATION_READY', rotationDone || (envSecret(env, 'FIELD_ENC_KEY_OLD').length > 0 && envSecret(env, 'LOG_ENCRYPT_KEY_OLD').length > 0));

  // 教师注册邀请码门控：两种一致态都合法——启用（后端 true + 前端 false）或开放注册（后端 false + 前端 true）
  add('INVITE_GATE_CONSISTENT',
    (INVITE_GATE_ENABLED === true && INVITE_GATE_DORMANT === false) ||
    (INVITE_GATE_ENABLED === false && INVITE_GATE_DORMANT === true));

  return { ok: checks.every(c => c.pass), checks };
}

let gateMemo = null;
/** 每 isolate 只算一次（env 不可变；失败不自愈，部署后必须重新发布） */
export function productionReady(env) {
  if (!gateMemo) gateMemo = productionConfigChecks(env);
  return gateMemo;
}

/** 生产未就绪时的 API 统一应答 */
export function notReadyResponse(gate) {
  return json({ status: 'not-ready', ready: false, checks: (gate && gate.checks) || [], timestamp: new Date().toISOString() }, 503);
}
