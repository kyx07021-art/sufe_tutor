/**
 * 文本审核咽喉 —— 全站自由文本字段统一审核入口（v1.5.0 起 fail-closed）
 *
 * L1 规则层（确定性主闸）：ADDRESS_GUARD 增强正则 + 数字谐音后缀表——拦模式变体（2788好）。
 * L2 语义层（外接必配）：Anthropic Messages API 判断自由文本是否含可定位住址描述
 *   （门牌/楼栋/房间/方位描述）。密钥 env.TEXT_AUDIT_API_KEY。
 *
 * fail-closed 语义：生产未配置密钥 / 超时 / 接口异常 / 解析失败 → 拒绝写入
 * （返回 layer:'error'，调用方回 MSG.TEXT_AUDIT_UNAVAILABLE），绝不静默降级为仅 L1。
 */
import { ADDRESS_GUARD, NUM_T, NUM_SEP, TEXT_AUDIT } from './constants.js';
import { getSecret } from './secrets.js';

let AUDIT_ENV = null;
/** 绑定审核环境（env 变更时调用；_worker.js initDb 时绑定） */
export function bindTextAuditEnv(env) { AUDIT_ENV = env; }

// ============================================================
// L1 规则层
// ============================================================
// 数字谐音后缀表（用户实证「2788好」——「号」写成谐音字绕过门控）：好/昊/豪/浩/耗/壕
const HOU_HARMONY = '号好昊豪浩耗壕';
const HARMONIC_GUARD = new RegExp(
  `(?:${NUM_T}${NUM_SEP}?)+${NUM_T}[${HOU_HARMONY}](?!线)`); // (?!线) 同 ADDRESS_GUARD：地铁/公交「十二号线」不误伤

// ============================================================
// L2 语义层（v1.5.0：必配，fail-closed）
// ============================================================
const AUDIT_MODEL = TEXT_AUDIT.MODEL;         // 换模型只改 server/constants
const AUDIT_TIMEOUT_MS = TEXT_AUDIT.TIMEOUT_MS; // 超时 = 拒绝写入（不再 fail-open）
const AUDIT_SYSTEM = `你是地址合规审核员。判断给定文本是否包含能定位到具体住址/门牌/房间的信息——
门牌号、楼栋号、单元号、房间号，或足以唯一确定住址的方位描述（如「对门」「上二楼」「左转第一间」）。
只输出 JSON：{"flagged": true或false, "reason": "简短原因"}。flagged=true 表示文本含可定位住址信息。`;

const UNAVAILABLE = { ok: false, layer: 'error', reason: 'TEXT_AUDIT_UNAVAILABLE' };

/** 调用语义层。任何不可用/不确定都返回 UNAVAILABLE（fail-closed），绝不返回 null 放行。 */
async function auditSemantic(text) {
  const key = String(getSecret(AUDIT_ENV, 'TEXT_AUDIT_API_KEY') || '').trim();
  if (!key) return UNAVAILABLE;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), AUDIT_TIMEOUT_MS);
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: AUDIT_MODEL,
          max_tokens: 80,
          system: AUDIT_SYSTEM,
          messages: [{ role: 'user', content: text }],
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) return UNAVAILABLE;
      const data = await res.json(); // 超时覆盖响应头 + 响应体读取全程
      clearTimeout(timer);
      const out = (data.content || []).map(b => b.text || '').join('');
      const m = out.match(/\{[\s\S]*\}/); // 模型可能夹散文，取 JSON 块
      const j = m ? JSON.parse(m[0]) : null;
      if (!j || typeof j.flagged !== 'boolean') return UNAVAILABLE;
      return j.flagged
        ? { ok: false, layer: 'ai', reason: 'ADDRESS_TOO_DETAILED' }
        : { ok: true, layer: 'ai' };
    } finally {
      clearTimeout(timer);
    }
  } catch { return UNAVAILABLE; }
}

// ============================================================
// 统一入口
// ============================================================
/**
 * 审核一段自由文本是否含可定位住址/门牌信息。
 * @returns {Promise<{ok:boolean, layer:'rule'|'ai'|'error', reason?:string}>}
 *   ok=false：layer='rule' → 调用方回 MSG.ADDRESS_TOO_DETAILED；
 *             layer='error' → 调用方回 MSG.TEXT_AUDIT_UNAVAILABLE（审核服务不可用，fail-closed）。
 */
export async function auditFreeText(text) {
  const s = String(text || '').trim();
  if (!s) return { ok: true, layer: 'rule' }; // 空值放行（调用方自有必填校验）
  if (ADDRESS_GUARD.test(s) || HARMONIC_GUARD.test(s)) {
    return { ok: false, layer: 'rule', reason: 'ADDRESS_TOO_DETAILED' };
  }
  return auditSemantic(s);
}
