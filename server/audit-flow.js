import { auditFreeText } from './text-audit.js'; // S2-1：门牌合规 L1 规则层（L2 语义可选 fail-open）
import { MSG } from './constants.js';             // 驳回文案单源（ADDRESS_TOO_DETAILED）

/**
 * 高频轻量日常审核通道（v0.26.0 E1/E2）—— 监听断点 + 统一信息队列 + 轻量审核节点
 *
 * 与 D（数据库级统一审查，重型低频）并行：本条是「每一条用户上传数据」的途中标准化监听断点，
 * 高频轻型通道。用户设想（2026-08-10）：
 *   - 为每一条用户上传的数据，在途中设置标准化监听断点；
 *   - 断点拿数据副本 + 足够上下文后堆入平台统一信息队列；
 *   - 队列过轻量审核节点（留接口：审核真假值 + 审核组件返回文本），对侧接 dummy 组件——
 *     恒放行（内测随机驳回已关闭，v0.26.3）；未来真实审核组件判假则不放行上传，
 *     走上传过程自身的 toast 接口原样弹出审核组件返回文本；
 *   - 全链路 ≤300ms，队列清栈速度远高于堆栈速度。
 *
 * 架构决策（docs/0.26-认证与审核架构.md §四）：
 *   - 统一信息队列 = 内存微队列（当前实例内同步处理，处理即清栈，天然「清栈速度远高于堆栈」）。
 *     未来接 Cloudflare Queues / Durable Object 分布式队列：只换 enqueueAudit/runAudit 的挂载点
 *     （队列生产者/消费者），断点与审核节点接口不变。
 *   - 轻量审核节点 = runAudit(item) → { ok, text }；对侧 dummy 组件：恒放行（内测随机驳回
 *     v0.26.3 关闭——生产 45 用户，0.1% 随机打回 + 内测文案不合适，用户拍板直接关）。
 *   - 300ms 预算：dummy 同步微秒级天然满足；未来接入关键词/NLP 若超时即 fail-open 放行（绝不阻塞上传）。
 *   - 未来演进（用户设想注释）：dummy → 关键词匹配（Trie/AC 自动机）+ 轻量 NLP 风险评分——
 *     打回关键词；放行但风险值较高 → 副本另堆长栈（异步队列），定期送高级 API 审核。
 */

// ============================================================
// 内容域写路径（E2 接入点：_worker 对内容域写请求统一过断点）
// 用户上传数据 = 内容域写路径（POST/PUT）；读/已读/登录等非内容写不在其列。
// 前缀覆盖 = 创建 + 编辑（带 :id 的 PUT）全口径：posts/demands/teacher profile/reviews/feedbacks/
// complaints/uploads/contracts（创建+修改）/聊天消息/签约（发起+回复）/需求意向（创建+处理）/
// 需求推送（学生推送+教师处理）/注册/头像。
// 点赞/收藏等轻量写也命中（同为内容域写路径，dummy 放行无害，宁全勿漏——审查补丁×2：原 set 只精确
// 匹配创建路径，漏 PUT 编辑与合同/签约创建；二次审查又漏签约回复（signing-requests/respond）、
// 需求意向（demands/:id/intents、intents/:id/resolve）、需求推送（demand-pushes）三类路径——
// 已与 _worker.js 路由全表对照补齐，读路径由 isContentWrite 的 POST/PUT 门控天然排除）。
// ============================================================
const CONTENT_WRITE_PREFIXES = [
  '/api/posts', '/api/student/demands', '/api/demands/', '/api/intents',
  '/api/demand-pushes', '/api/teacher/profile', '/api/reviews',
  '/api/feedbacks', '/api/complaints', '/api/uploads', '/api/contracts',
  '/api/conversations/', '/api/signing-requests',
  '/api/auth/register', '/api/user/avatar',
];

export function isContentWrite(path, method) {
  if (method !== 'POST' && method !== 'PUT') return false;
  return CONTENT_WRITE_PREFIXES.some(pr => path.startsWith(pr));
}

// ============================================================
// 门牌合规 L1 规则层挂接（v0.30.0 S2-1 补全）
// ============================================================
// 原缺口：auditFreeText（门牌合规咽喉）仅 routes-teacher（intro/school）/routes-demands
// （additional_info）直调——帖子/评价/投诉/聊天/反馈/打招呼消息/合同/签约的自由文本可写入门牌号，
// 违反合规红线「详细门牌号不收集」。现按路径映射在此统一抽取自由文本字段交 auditFreeText
// （L1 规则 + 可选 L2 语义 fail-open），audit-flow 成为名实相符的统一审核咽喉。
// 抽取用 pick 函数（body → string[]），比字段名字符串映射稳（可处理嵌套如聊天 batch[].body）；
// 新增内容路径在此加一行即可。路由层原有直调保留作纵深防御 + 直接路由单测入口。
// 依赖：auditFreeText 走 secrets 网关（L2 密钥未配置即跳过，仅规则层）。
// 白名单里有意不映射的路径（isContentWrite 通过但无地址承载自由文本，auditItem 落 'skip' 属预期）：
//   /api/uploads（附件上传，正文无自由文本）、/api/user/avatar（头像，无文本）、
//   /api/auth/register（username 有字符白名单，无门牌承载）、/api/signing-requests/（respond 仅
//   {accept,capToken}，无自由文本）——新增写路径时先确认是否有承载地址的自由文本字段，有则在此加映射。
const AUDIT_MAP = [
  { prefix: '/api/posts',           pick: b => [b.title, b.bodyMd] },
  { prefix: '/api/student/demands', pick: b => [b.demand?.additional_info] }, // 嵌套 body（创建 POST 与编辑 PUT 同构 {demand:{additional_info}}——外部审计抓出曾读扁平字段规则恒空转）
  { prefix: '/api/demands/',        pick: b => [b.message] }, // 仅 POST /api/demands/:id/intents（意向创建，body 扁平 message；需求编辑在 /api/student/demands/:id）
  { prefix: '/api/intents',         pick: b => [b.message] },
  { prefix: '/api/demand-pushes',   pick: b => [b.message] },
  { prefix: '/api/teacher/profile', pick: b => [b.profile?.intro, b.profile?.school] }, // 嵌套 body {profile:{intro,school}}（同断线修法）
  { prefix: '/api/reviews',         pick: b => [b.comment] },
  { prefix: '/api/feedbacks',       pick: b => [b.title, b.content] },
  { prefix: '/api/complaints',      pick: b => [b.reason, b.detail] },
  { prefix: '/api/contracts',       pick: b => [b.plan, b.schedule, b.location, b.payMethodOther, b.contractMd] }, // 合同线下地点可承载门牌（v0.30.0 审计补）；v0.31.2 审计补 contractMd——修改路径 body {version,contractMd}，创建路径 body 为扁平四字段（contractMd 服务端重拼，客户端不传即 undefined 不误拦）
  { prefix: '/api/conversations/',  pick: b => [
      ...(Array.isArray(b.batch) ? b.batch.map(i => i && i.body) : []), // 聊天批量正文
      b.schedule, // 发起签约（/api/conversations/:id/signing）schedule 自由文本（v0.30.0 审计补）
    ] },
];

// 预算说明（安全评审回应）：≤300ms fail-open 是**有意**的、且有文本依据的合规取舍——
// ①生产现状 TEXT_AUDIT_API_KEY 未配置，auditSemantic 立即返 null，auditItem 纯 L1 正则微秒级，
//   预算竞速在当下**不可达**（写路径永远走 L1 确定性门控）；
// ②未来挂 L2 语义层后，LLM 往返 300ms 内完成属常态，慢于 300ms 时若 fail-closed 拒绝全部写请求
//   = 把「AI 慢」变成全站写路径 DoS + 正常内容被 400「地址太详细」误伤（用户可用性灾难）；
//   L2 自身已有 4s 超时 fail-open（text-audit.js），L1 是确定性主闸、L2 是纵深防御最佳努力——
//   合规红线的兜底是 L1 正则，不依赖 L2 在预算内返回。落预算路径时 console.warn 留观测信号。
const AUDIT_BUDGET_MS = 300;

// ============================================================
// 统一信息队列（内存微队列；同步处理即清栈）
// ============================================================
let _auditQueue = [];

// ============================================================
// 轻量审核节点（接口：{ ok, text } —— 审核真假值 + 审核组件返回文本）
// v0.30.0（S2-1）：dummy 恒放行升级为「门牌合规 L1 规则层」——按 AUDIT_MAP 抽取内容域
// 自由文本字段交 auditFreeText（L1 规则 + 可选 L2 语义，均 fail-open），命中即 reject。
// 【未来演进占位】此处继续叠加关键词匹配（Trie/AC 自动机）+ 轻量 NLP 风险评分：
//   判假返回 { reject: text } 走 auditBeforeWrite 的 reject 通道；放行但风险值较高 →
//   副本另堆长栈，定期送高级 API 异步审核。接口 {ok,reject} 不变。
// ============================================================
async function auditItem(item) {
  const rule = AUDIT_MAP.find(r => item.path.startsWith(r.prefix));
  if (!rule) return { ok: true, layer: 'skip' }; // 非自由文本内容写（点赞/收藏等）直接放行
  const texts = (rule.pick(item.body) || []).filter(t => typeof t === 'string' && t.trim());
  for (const t of texts) {
    const v = await auditFreeText(t);
    if (!v.ok) return { reject: MSG.ADDRESS_TOO_DETAILED, layer: v.layer }; // 合规红线：详细门牌号不收集
  }
  return { ok: true, layer: 'rule' };
}

function runAudit(item) {
  // ≤300ms 预算 fail-open：L1 规则微秒级；未来 L2 语义/关键词若超时放行，绝不阻塞上传。
  // 预算路径只在 L2 挂接后可达——warn 留观测（未配置密钥时永不触发，见 AUDIT_MAP 上方预算说明）
  return Promise.race([
    auditItem(item),
    new Promise(res => setTimeout(() => { console.warn('[audit-flow] budget exceeded, fail-open for', item.path); res({ ok: true, layer: 'budget' }); }, AUDIT_BUDGET_MS)),
  ]);
}

// ============================================================
// 监听断点主入口（E2：_worker 内容域写请求统一调用）
// 数据副本 + 上下文 → 统一队列 → 过审核节点（≤300ms 预算 fail-open）。
// 驳回 → { reject: text }；放行 → { ok: true }。
// ============================================================
export async function auditBeforeWrite({ path, method, body, ip, userId }) {
  if (!isContentWrite(path, method)) return { ok: true };
  const item = {
    path, method, ip: ip || '', userId: userId || 0,
    body: typeof body === 'object' && body !== null ? { ...body } : body, // 数据副本
    at: Date.now(),
  };
  _auditQueue.push(item);          // 堆入统一信息队列
  const verdict = await runAudit(item); // 审核节点（300ms 预算内；队列深度恒 ≈1，处理即清栈）
  _auditQueue.shift();
  if (verdict.reject) return { reject: verdict.reject };
  return { ok: true };
}

// v0.31.3 审计（D1）：auditQueueDepth 深度观测导出已删——同步处理即清栈恒 ≈0 且无管理端端点读取，
// 测试-only 死导出（连删测试引用）。_auditQueue 本体保留（runAudit 入队→同步清栈的微队列）。

