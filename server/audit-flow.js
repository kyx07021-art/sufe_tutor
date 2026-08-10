/**
 * 高频轻量日常审核通道（v0.26.0 E1/E2）—— 监听断点 + 统一信息队列 + 轻量审核节点（dummy 组件）
 *
 * 与 D（数据库级统一审查，重型低频）并行：本条是「每一条用户上传数据」的途中标准化监听断点，
 * 高频轻型通道。用户设想（2026-08-10）：
 *   - 为每一条用户上传的数据，在途中设置标准化监听断点；
 *   - 断点拿数据副本 + 足够上下文后堆入平台统一信息队列；
 *   - 队列过轻量审核节点（留接口：审核真假值 + 审核组件返回文本），对侧接 dummy 组件——
 *     默认真、极小概率随机驳回，假则不放行上传，走上传过程自身的 toast 接口原样弹出 dummy 文本；
 *   - 全链路 ≤300ms，队列清栈速度远高于堆栈速度。
 *
 * 架构决策（docs/0.26-认证与审核架构.md §四）：
 *   - 统一信息队列 = 内存微队列（当前实例内同步处理，处理即清栈，天然「清栈速度远高于堆栈」）。
 *     未来接 Cloudflare Queues / Durable Object 分布式队列：只换 enqueueAudit/runAudit 的挂载点
 *     （队列生产者/消费者），断点与审核节点接口不变。
 *   - 轻量审核节点 = runAudit(item) → { ok, text }；对侧 dummy 组件（内测）：随机极小概率驳回。
 *   - 300ms 预算：dummy 同步微秒级天然满足；未来接入关键词/NLP 若超时即 fail-open 放行（绝不阻塞上传）。
 *   - 未来演进（用户设想注释）：dummy → 关键词匹配（Trie/AC 自动机）+ 轻量 NLP 风险评分——
 *     打回关键词；放行但风险值较高 → 副本另堆长栈（异步队列），定期送高级 API 审核。
 */

// ============================================================
// 内容域写路径白名单（E2 接入点：_worker 对内容域写请求统一过断点）
// 用户上传数据 = 写路径（POST/PUT）；读/已读/登录等非内容写不在其列。
// ============================================================
const CONTENT_WRITE_PATHS = new Set([
  '/api/posts',          // 资料共享帖子
  '/api/student/demands',// 学生需求
  '/api/teacher/profile',// 教师档案
  '/api/reviews',        // 评价
  '/api/feedbacks',      // 反馈
  '/api/complaints',     // 投诉
  '/api/uploads',        // 附件暂存
  '/api/auth/register',  // 注册（用户名）
]);
const CONTENT_WRITE_PREFIXES = [
  '/api/conversations/', // 聊天消息（POST /api/conversations/:id/messages）
];

export function isContentWrite(path, method) {
  if (method !== 'POST' && method !== 'PUT') return false;
  if (CONTENT_WRITE_PATHS.has(path)) return true;
  return CONTENT_WRITE_PREFIXES.some(pr => path.startsWith(pr));
}

// ============================================================
// 统一信息队列（内存微队列；同步处理即清栈）
// ============================================================
let _auditQueue = [];

// ============================================================
// 轻量审核节点（接口：{ ok, text } —— 审核真假值 + 审核组件返回文本）
// 对侧 dummy 组件（内测）：默认真，极小概率随机驳回（0.1%）。
// 【未来演进占位】dummy → 关键词匹配（Trie/AC 自动机）+ 轻量 NLP 风险评分：
//   打回关键词；放行但风险值较高 → 副本另堆长栈，定期送高级 API 异步审核。
// ============================================================
const DUMMY_REJECT_RATE = 0.001;
const DUMMY_REJECT_TEXT = 'dummy审核组件随机驳回一些请求，以测试网站内容审核功能，请再试一次';

function runAudit(item) {
  // 内测 dummy：随机极小概率驳回（验证全链路；未来被真实审核组件替换，接口不变）
  if (Math.random() < DUMMY_REJECT_RATE) return { ok: false, text: DUMMY_REJECT_TEXT, layer: 'dummy' };
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
