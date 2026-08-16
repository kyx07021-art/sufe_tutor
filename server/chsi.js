/**
 * 学信网核验咽喉（v1.5.0 起 fail-closed）—— 教师《学籍在线验证报告》验证码核验 单点
 *
 * 核验方式只有一种：manual（人工核验）。教师提交验证码进入管理员核验队列，管理员在
 * 学信网官方核验页（https://www.chsi.com.cn/xlcx/bgcx.jsp 或学信网小程序扫码）查证后
 * 结构化录入并确认通过/拒绝。任何其他 provider 一律视为配置错误（fail-closed），
 * 不存在 mock / 未签约第三方直通路径。
 *
 * 调用点：教师资料页「验证学信网」提交验证码（POST /api/teacher/verify-chsi）。
 */
import { getSecret } from './secrets.js';

let CHSI_ENV = null;
export function bindChsiEnv(env) { CHSI_ENV = env; }

/** provider 只允许 manual；空值按 manual（进人工队列） */
const chsiProvider = () => {
  const p = String(getSecret(CHSI_ENV, 'CHSI_PROVIDER') || 'manual').trim();
  return p === 'manual' ? 'manual' : p;
};

/** 学信网在线验证码格式：12 或 16 位字母数字（《学籍在线验证报告》验证码口径） */
const CHSI_CODE_RE = /^[A-Za-z0-9]{12,16}$/;

/**
 * 核验验证码。返回：
 *   { ok:true, status:'pending', provider:'manual' }（进管理员核验队列）
 *   { ok:false, code:'CHSI_CODE_INVALID' }（格式非法）
 *   { ok:false, code:'CHSI_PROVIDER_INVALID' }（生产配置错误，fail-closed）
 */
export async function verifyChsiCode(code) {
  const c = String(code || '').trim();
  if (!CHSI_CODE_RE.test(c)) return { ok: false, code: 'CHSI_CODE_INVALID' };
  if (chsiProvider() !== 'manual') return { ok: false, code: 'CHSI_PROVIDER_INVALID' };
  return { ok: true, status: 'pending', provider: 'manual' };
}
