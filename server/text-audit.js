/**
 * 文本审核咽喉（v0.25.113 起）——全站自由文本字段统一审核入口
 *
 * 用户需求（2026-08-10）：地址门控被谐音/语义级描述绕过——「二期爸爸号」「2期8霸昊」
 * 「2788好」「丁香国际对门学校上二楼左转第一间房」等，纯正则规则层兜不住，须语义层；
 * 同时接口留清晰独立，方便未来改接全站文本统一审核方案。
 *
 * 策略链（自低到高，fail-open）：
 *   L1 规则层（零网络零成本毫秒级）：ADDRESS_GUARD 增强正则（数字+门牌后缀含连字符变体）
 *     + 数字谐音后缀表（号→好/昊/豪 等）——拦模式变体（2788好）。
 *   L2 语义层（可选外接，可配置）：Anthropic Messages API 判断自由文本是否含可定位住址描述
 *     （门牌/楼栋/房间/方位描述）。密钥 env.TEXT_AUDIT_API_KEY（Secrets 网关，见 secrets.js）；
 *     未配置 / 超时 / 接口异常 → fail-open 回退 L1（规则层结果）。
 *
 * 调用点：routes-teacher（address/intro/school）、routes-demands（address/additional_info）等
 * 对自由文本字段调 auditFreeText，命中 { ok:false } 即回 MSG.ADDRESS_TOO_DETAILED。
 * 未来全站统一审核：策略链只在本模块演进（换模型/换厂商/加规则），调用点签名不变。
 */
import { ADDRESS_GUARD } from './constants.js';
import { getSecret } from './secrets.js';

let AUDIT_ENV = null;
/** 绑定审核环境（env 变更时调用；_worker.js initDb 时绑定） */
export function bindTextAuditEnv(env) { AUDIT_ENV = env; }

// ============================================================
// L1 规则层
// ============================================================
// 数字谐音后缀表（用户实证「2788好」——「号」写成谐音字绕过门控）：好/昊/豪/浩/耗/壕
const HOU_HARMONY = '号好昊豪浩耗壕';
const NUM_T = `[0-9０-９一二三四五六七八九十百千万亿两〇零壹贰叁肆伍陆柒捌玖拾佰仟萬億]`;
const NUM_SEP = `[-·、．.，, ]`;
const HARMONIC_GUARD = new RegExp(
  `(?:${NUM_T}${NUM_SEP}?)+${NUM_T}[${HOU_HARMONY}](?!线)`); // (?!线) 同 ADDRESS_GUARD：地铁/公交「十二号线」不误伤
// 注：规则层只拦「数字串+门牌/谐音后缀」模式变体。谐音词（二期爸爸号=2期88号）、
// 纯方位描述（对门二楼左转第一间）无数字特征，规则层拦不住 → 语义层（L2）兜底。

// ============================================================
// L2 语义层（可选外接）
// ============================================================
const AUDIT_MODEL = 'claude-sonnet-4-6';      // 轻量模型省成本；换模型只改这里
const AUDIT_TIMEOUT_MS = 4000;                // 超时 fail-open，不让提交被外接接口拖死
const AUDIT_SYSTEM = `你是地址合规审核员。判断给定文本是否包含能定位到具体住址/门牌/房间的信息——
门牌号、楼栋号、单元号、房间号，或足以唯一确定住址的方位描述（如「对门」「上二楼」「左转第一间」）。
只输出 JSON：{"flagged": true或false, "reason": "简短原因"}。flagged=true 表示文本含可定位住址信息。`;

async function auditSemantic(text) {
  const key = getSecret(AUDIT_ENV, 'TEXT_AUDIT_API_KEY');
  if (!key) return null; // 未配置语义层密钥 → fail-open 跳过（仅规则层）
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), AUDIT_TIMEOUT_MS);
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
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    const out = (data.content || []).map(b => b.text || '').join('');
    const m = out.match(/\{[\s\S]*\}/); // 模型可能夹散文，取 JSON 块
    const j = m ? JSON.parse(m[0]) : null;
    return j && typeof j.flagged === 'boolean' ? j : null;
  } catch { /* 超时/网络/解析失败 → fail-open（规则层结果） */ }
  return null;
}

// ============================================================
// 统一入口
// ============================================================
/**
 * 审核一段自由文本是否含可定位住址/门牌信息。
 * @param {string} text 自由文本（address/intro/school/additional_info 等）
 * @returns {Promise<{ok:boolean, layer:'rule'|'ai', reason?:string}>}
 *   ok=false → 调用方回 MSG.ADDRESS_TOO_DETAILED；layer 标注由哪层拦截（审计可观察）。
 */
export async function auditFreeText(text) {
  const s = String(text || '').trim();
  if (!s) return { ok: true, layer: 'rule' }; // 空值放行（调用方自有必填校验）
  if (ADDRESS_GUARD.test(s) || HARMONIC_GUARD.test(s)) {
    return { ok: false, layer: 'rule', reason: 'ADDRESS_TOO_DETAILED' };
  }
  const ai = await auditSemantic(s);
  if (ai && ai.flagged) return { ok: false, layer: 'ai', reason: 'ADDRESS_TOO_DETAILED' };
  return { ok: true, layer: ai ? 'ai' : 'rule' };
}
