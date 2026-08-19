/**
 * 内容域写路径统一审核断点（v1.5.0 起 fail-closed）
 *
 * 每条用户上传数据在写入前过本断点：按路径映射抽取自由文本字段交 text-audit 咽喉。
 * L1 门牌规则确定性拦截；L2 语义层未配置/超时/异常 → 拒绝写入（不再 300ms fail-open）。
 * 调用点：_worker fetch 对内容域写请求统一调用。新增内容域写路径先在此登记。
 */
import { auditFreeText } from './text-audit.js';
import { MSG } from '../../shared/codes.js';

// ============================================================
// 内容域写路径（创建 + 编辑全口径）
// ============================================================
const CONTENT_WRITE_PREFIXES = [
  '/api/posts', '/api/student/demands', '/api/demands/', '/api/intents',
  '/api/demand-pushes', '/api/teacher/profile', '/api/reviews',
  '/api/feedbacks', '/api/complaints', '/api/uploads', '/api/contracts',
  '/api/conversations/', '/api/signing-requests', '/api/teacher/awards',
  '/api/auth/register', '/api/user/username', '/api/user/avatar',
];

export function isContentWrite(path, method) {
  if (method !== 'POST' && method !== 'PUT') return false;
  return CONTENT_WRITE_PREFIXES.some(pr => path.startsWith(pr));
}

// 按真实请求形状抽取内容域自由文本（body → string[]）。白名单内无自由文本承载的路径落 skip。
const AUDIT_MAP = [
  { prefix: '/api/posts',           pick: b => [b.title, b.bodyMd] },
  { prefix: '/api/auth/register',  pick: b => [b.username] }, // 用户名白名单可拼出门牌文本，与改用户名同守
  { prefix: '/api/student/demands', pick: b => [b.demand?.additional_info] },
  { prefix: '/api/demands/',        pick: b => [b.message] },
  { prefix: '/api/intents',         pick: b => [b.message] },
  { prefix: '/api/demand-pushes',   pick: b => [b.message] },
  { prefix: '/api/teacher/profile', pick: b => [b.profile?.intro, b.profile?.school] },
  { prefix: '/api/reviews',         pick: b => [b.comment] },
  { prefix: '/api/feedbacks',       pick: b => [b.title, b.content] },
  { prefix: '/api/complaints',      pick: b => [b.reason, b.detail] },
  { prefix: '/api/contracts',       pick: b => [b.plan, b.schedule, b.location, b.payMethodOther, b.trialPayOther, b.contractMd] },
  { prefix: '/api/conversations/',  pick: b => [
      ...(Array.isArray(b.batch) ? b.batch.map(i => i && i.body) : []),
      b.schedule,
    ] },
  { prefix: '/api/user/username',   pick: b => [b.newUsername] },
  { prefix: '/api/teacher/awards',   pick: b => [b.title, b.issuer] },
];

/**
 * 统一断点：内容域写请求过审。
 * 返回 { ok:true } 放行；{ reject:'文案' } 拒绝（L1 门牌 / L2 语义 / 审核服务不可用）。
 */
export async function auditBeforeWrite({ path, method, body, ip, userId }) {
  if (!isContentWrite(path, method)) return { ok: true };
  // Z-2-F7：合法 JSON 文本 null（parseBody 原样返回）无自由文本可审——放行，
  // 否则 AUDIT_MAP pick(null) 解构属性 TypeError → 内容域写路径传 JSON null 即 500
  if (body == null) return { ok: true };
  const item = {
    path, method, ip: ip || '', userId: userId || 0,
    body: typeof body === 'object' && body !== null ? { ...body } : body,
  };
  const rule = AUDIT_MAP.find(r => item.path.startsWith(r.prefix));
  if (!rule) return { ok: true }; // 非自由文本内容写（点赞/头像/附件等）直接放行
  const texts = (rule.pick(item.body) || []).filter(t => typeof t === 'string' && t.trim());
  for (const t of texts) {
    const v = await auditFreeText(t);
    if (!v.ok) {
      if (v.layer === 'error') return { reject: MSG.TEXT_AUDIT_UNAVAILABLE, code: 'TEXT_AUDIT_UNAVAILABLE' };
      return { reject: MSG.ADDRESS_TOO_DETAILED, code: 'ADDRESS_TOO_DETAILED' };
    }
  }
  return { ok: true };
}
