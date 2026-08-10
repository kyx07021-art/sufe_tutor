/**
 * 高频轻量日常审核通道（v0.26.0 E1/E2）—— 监听断点 + 统一信息队列 + 轻量审核节点（dummy 组件）
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
// 统一信息队列（内存微队列；同步处理即清栈）
// ============================================================
let _auditQueue = [];

// ============================================================
// 轻量审核节点（接口：{ ok, text } —— 审核真假值 + 审核组件返回文本）
// 对侧 dummy 组件：恒放行（v0.26.3 起；内测 0.1% 随机驳回已按用户拍板关闭——
// 全链路验证目标已达成，生产 45 用户不该被随机打回 + 弹内测文案）。
// 【未来演进占位】dummy → 关键词匹配（Trie/AC 自动机）+ 轻量 NLP 风险评分：
//   在此实现判定，判假返回 { ok:false, text } 即走 auditBeforeWrite 的 reject 通道；
//   放行但风险值较高 → 副本另堆长栈，定期送高级 API 异步审核。接口 {ok,text} 不变。
// ============================================================
function runAudit(item) {
  // dummy 恒放行（随机驳回已关；未来真实审核组件在此实现判定，接口不变）
  return { ok: true, layer: 'dummy' };
}

// ============================================================
// 监听断点主入口（E2：_worker 内容域写请求统一调用）
// 数据副本 + 上下文 → 统一队列 → 同步过审核节点（≤300ms 预算）。
// 驳回 → { reject: text }；放行 → { ok: true }。
// ============================================================
export function auditBeforeWrite({ path, method, body, ip, userId }) {
  if (!isContentWrite(path, method)) return { ok: true };
  const item = {
    path, method, ip: ip || '', userId: userId || 0,
    body: typeof body === 'object' && body !== null ? { ...body } : body, // 数据副本
    at: Date.now(),
  };
  _auditQueue.push(item);          // 堆入统一信息队列
  const verdict = runAudit(item); // 轻量审核节点（同步，微秒级，300ms 预算内）
  _auditQueue.shift();            // 处理即清栈（清栈速度远高于堆栈——同步路径天然满足）
  if (!verdict.ok) return { reject: verdict.text };
  return { ok: true };
}

/** 队列深度观测（管理端诊断；当前同步路径恒 ≈0） */
export function auditQueueDepth() { return _auditQueue.length; }
