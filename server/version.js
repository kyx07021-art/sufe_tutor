/**
 * 数据版本戳模块 —— 独立维护「按业务域的数据版本计数」
 *
 * 设计：自持表 + bump 咽喉 + 路由 handler，外部只通过
 *   initVersionTable(db)  建表（由 db.js 的 initDb 调一次）
 *   versionDomainOf(pathname)  写路径 → 受影响数据域（纯函数，可单测）
 *   bumpVersions(db, domains)  原子自增若干域（写咽喉调用，ctx.waitUntil 包裹，失败吞错）
 *   handleGetDataVersion(db)  GET /api/data-version 路由（返回 { versions: {域: 计数} }）
 *
 * 为什么做：客户端会话数据层（app-datahub.js）8 秒探测版本变化、只重拉变化域，
 * 让「数据库有更新 → 客户端静默拉一次」成立，而不引入 WebSocket/DO（架构红线，CLAUDE.md）。
 *
 * 域划分语义（核心决策，勿轻改）：
 *   - 纯认证/个人游标路径（/api/auth/*、markRead、notifications/:id/read、avatar、deactivate、
 *     reviews、invite）一律不 bump——它们不改变任何用户可见的列表数据；
 *   - 聊天系只被「发消息/传附件」bump，且只落 chat 域——聊天是高频写，
 *     若落全局/多域会造成所有客户端重拉重列表（放大效应，按域拆的意义）；
 *   - 合同系同时 bump contracts + demands（合同状态改变需求可见性/状态）；
 *   - 计数器全局共享（非 per-user），无敏感性；客户端只对自身已缓存的域重拉，跨用户零影响。
 * 挂点：_worker.js 写咽喉（非 GET 成功响应统一分支），一个插入点覆盖全站写路径。
 */
import { dbAll, dbRun, json } from '../src/server/core/util.js';

export const DOMAINS = {
  DEMANDS: 'demands', TEACHERS: 'teachers', POSTS: 'posts',
  CONTRACTS: 'contracts', CHAT: 'chat', NOTIFICATIONS: 'notifications', ADMIN: 'admin',
};

export async function initVersionTable(db) {
  await dbRun(db, `CREATE TABLE IF NOT EXISTS data_versions (
    domain TEXT PRIMARY KEY,
    counter INTEGER NOT NULL DEFAULT 0)`);
}

/** 写咽喉调用：版本戳失败绝不影响主业务。多域写从逐域串行 1 D1/域 收敛为单次 db.batch
 * （1 往返原子自增）。单域失败整体回滚吞错——版本戳非关键路径，失败即本写丢失 bump，
 * 客户端下次探测/写自然再收敛，无正确性影响；表经 initDb 恒存在，ON CONFLICT 原子防并发空窗。 */
export async function bumpVersions(db, domains) {
  if (!domains || !domains.length) return;
  try {
    await db.batch(domains.map(d => db.prepare(
      `INSERT INTO data_versions (domain, counter) VALUES (?, 1)
       ON CONFLICT(domain) DO UPDATE SET counter = counter + 1`).bind(d)));
  } catch (e) { console.warn('bumpVersions failed:', e && e.message); }
}

/** 恒返回全部域、未 bump 的补 0——客户端基线即有键，0→1 首次写入才能正确触发重拉 */
export async function getVersions(db) {
  const versions = { demands: 0, teachers: 0, posts: 0, contracts: 0, chat: 0, notifications: 0, admin: 0 };
  const rows = await dbAll(db, 'SELECT domain, counter FROM data_versions');
  for (const r of rows) versions[r.domain] = r.counter;
  return versions;
}

// GET /api/data-version —— 廉价单表读（恒走 D1，不入读缓存；每 8s/客户端 顺便做 D1 保温）
export async function handleGetDataVersion(db) {
  return json({ versions: await getVersions(db) });
}

/**
 * 写路径 → 受影响数据域（可多域）。纯函数，路径与 _worker.js routeApi 一一对应，勿加未注册路由。
 * 管理员跨域连带 bump、意向/推送接受建会话连带 chat、合同落聊天气泡连带 chat、
 * 注销清内容连带多域；附件暂存不 bump（私有不入会话，发消息路径才 bump chat）。
 */
export function versionDomainOf(pathname) {
  const p = pathname || '';

  // 不 bump：不改变任何用户可见列表数据的写（认证/个人游标/待审核评价/邀请码）
  // #151：单条通知已读取代批量全读（同为纯个人游标不 bump）
  if (p.startsWith('/api/auth/') || /^\/api\/notifications\/\d+\/read$/.test(p) ||
      p === '/api/admin/invite' || p.startsWith('/api/reviews') ||
      /^\/api\/conversations\/\d+\/read$/.test(p)) return [];

  // 附件暂存（拖入未发送，私有不入会话）——真正入会话由发消息路径 bump chat
  if (p === '/api/uploads' || /^\/api\/uploads\/\d+$/.test(p)) return [];

  // 发起签约：创建/回应签约请求——合同域 + 聊天气泡 + 需求
  // （确认后需求 contracted 并自动拒绝其余意向/推送，均属低频不构成放大）
  if (/^\/api\/conversations\/\d+\/signing$/.test(p) ||
      /^\/api\/signing-requests\/\d+\/respond$/.test(p)) return [DOMAINS.CONTRACTS, DOMAINS.CHAT, DOMAINS.DEMANDS];

  // 聊天系（高频写隔离：只 bump chat 域，不扰动其它域）
  if (/^\/api\/conversations\/\d+\/messages$/.test(p)) return [DOMAINS.CHAT];

  // 需求系（学生需求 CRUD/重开、意向创建、推送创建）
  if (p === '/api/student/demands' || p === '/api/demand-pushes' ||
      /^\/api\/student\/demands\/\d+(\/reopen)?$/.test(p) ||
      /^\/api\/demands\/\d+\/intents$/.test(p)) return [DOMAINS.DEMANDS];

  // 意向/推送处理：accept 会建会话（dbUpsertConversation）→ 连带 chat；低频，不构成高频写放大
  if (/^\/api\/intents\/\d+\/resolve$/.test(p) ||
      /^\/api\/demand-pushes\/\d+\/resolve$/.test(p)) return [DOMAINS.DEMANDS, DOMAINS.CHAT];

  // 合同系：合同状态改变需求可见性 + 聊天窗落合同气泡 → 三域
  if (p === '/api/contracts' || /^\/api\/contracts\/\d+(\/(sign|revoke))?$/.test(p))
    return [DOMAINS.CONTRACTS, DOMAINS.DEMANDS, DOMAINS.CHAT];

  // 管理员删除合同：合同+需求+管理端列表
  if (/^\/api\/admin\/contracts\/\d+$/.test(p)) return [DOMAINS.CONTRACTS, DOMAINS.DEMANDS, DOMAINS.ADMIN];

  // 教师系（档案保存 / 管理员核验 / 封禁——封禁改教师列表可见性 + 管理端用户列表）
  if (p === '/api/teacher/profile') return [DOMAINS.TEACHERS];
  if (p === '/api/privacy-settings') return [DOMAINS.TEACHERS, DOMAINS.DEMANDS]; // #163：隐私写改访客可见性，教师/需求两域都刷新
  if (/^\/api\/admin\/teachers\/\d+\/verify$/.test(p)) return [DOMAINS.TEACHERS, DOMAINS.ADMIN];
  if (/^\/api\/admin\/users\/\d+\/ban$/.test(p)) return [DOMAINS.TEACHERS, DOMAINS.ADMIN];

  // 帖子系（发布、点赞、删除）
  if (p === '/api/posts' || /^\/api\/posts\/\d+(\/like)?$/.test(p)) return [DOMAINS.POSTS];

  // 通知系（广播、删除广播批；逐用户通知由 notifyUser 咽喉统一 bump notifications）
  if (p === '/api/notifications/broadcast' || /^\/api\/admin\/notifications\/\d+$/.test(p)) return [DOMAINS.NOTIFICATIONS];

  // 管理端评价审核/删除：改教师评分（teachers）+ 管理端评价列表（admin）
  if (/^\/api\/admin\/reviews\/\d+(\/approve|\/reject)?$/.test(p)) return [DOMAINS.ADMIN, DOMAINS.TEACHERS];

  // 管理端删需求：需求广场（demands）+ 管理端列表（admin）
  if (/^\/api\/admin\/demands\/\d+$/.test(p)) return [DOMAINS.ADMIN, DOMAINS.DEMANDS];

  // 管理端删聊天消息：会话消息（chat）+ 管理端（admin）
  if (/^\/api\/admin\/messages\/\d+$/.test(p)) return [DOMAINS.ADMIN, DOMAINS.CHAT];

  // 反馈（提交/处理）：管理端反馈列表（admin；处理还会 notifyUser → notifications 由咽喉 bump）
  if (p === '/api/feedbacks' || /^\/api\/feedbacks\/\d+\/resolve$/.test(p)) return [DOMAINS.ADMIN];

  // 管理系兜底（其余 admin 写）
  if (p.startsWith('/api/admin/')) return [DOMAINS.ADMIN];

  // 用户侧：注销清空本人内容（教师列表消失/需求/帖子删除）→ 多域；头像进教师卡片
  if (p === '/api/user/deactivate') return [DOMAINS.TEACHERS, DOMAINS.DEMANDS, DOMAINS.POSTS];
  if (p === '/api/user/avatar') return [DOMAINS.TEACHERS];

  return [];
}
