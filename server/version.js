/**
 * 数据版本戳模块（v0.23.0 静默数据层）—— 独立维护「按业务域的数据版本计数」
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
 *   - 纯认证/个人游标路径（/api/auth/*、markRead、notifications/read、avatar、deactivate、
 *     reviews、invite）一律不 bump——它们不改变任何用户可见的列表数据；
 *   - 聊天系只被「发消息/传附件」bump，且只落 chat 域——聊天是高频写，
 *     若落全局/多域会造成所有客户端重拉重列表（放大效应，按域拆的意义）；
 *   - 合同系同时 bump contracts + demands（合同状态改变需求可见性/状态）；
 *   - 计数器全局共享（非 per-user），无敏感性；客户端只对自身已缓存的域重拉，跨用户零影响。
 * 挂点：_worker.js 写咽喉（readCacheClearAll 旁边），一个插入点覆盖全站写路径。
 */
import { dbAll, dbRun, json } from './util.js';

export const DOMAINS = {
  DEMANDS: 'demands', TEACHERS: 'teachers', POSTS: 'posts',
  CONTRACTS: 'contracts', CHAT: 'chat', NOTIFICATIONS: 'notifications', ADMIN: 'admin',
};

export async function initVersionTable(db) {
  await dbRun(db, `CREATE TABLE IF NOT EXISTS data_versions (
    domain TEXT PRIMARY KEY,
    counter INTEGER NOT NULL DEFAULT 0)`);
}

async function bumpDomain(db, domain) {
  // 原子 upsert：首见插 1，再遇自增（SQLite ON CONFLICT 单语句，无并发空窗）
  await dbRun(db,
    `INSERT INTO data_versions (domain, counter) VALUES (?, 1)
     ON CONFLICT(domain) DO UPDATE SET counter = counter + 1`, [domain]);
}

/** 写咽喉调用：版本戳失败绝不影响主业务，静默吞错（同上限流清缓存同纪律） */
export async function bumpVersions(db, domains) {
  if (!domains || !domains.length) return;
  try { for (const d of domains) await bumpDomain(db, d); }
  catch (e) { console.warn('bumpVersion failed:', e && e.message); }
}

export async function getVersions(db) {
  const versions = {};
  const rows = await dbAll(db, 'SELECT domain, counter FROM data_versions');
  for (const r of rows) versions[r.domain] = r.counter;
  return versions;
}

// GET /api/data-version —— 廉价单表读（恒走 D1，不入读缓存；每 8s/客户端 顺便做 D1 保温）
export async function handleGetDataVersion(db) {
  return json({ versions: await getVersions(db) });
}

/** 写路径 → 受影响数据域（可多域）。纯函数，路径与 _worker.js routeApi 一一对应，勿加未注册路由 */
export function versionDomainOf(pathname) {
  const p = pathname || '';

  // 不 bump：不改变任何用户可见列表数据的写（认证/个人设置/个人游标/评价/邀请码）
  if (p.startsWith('/api/auth/') || p.startsWith('/api/user/') ||
      p === '/api/notifications/read' || p === '/api/admin/invite' ||
      p.startsWith('/api/reviews') ||
      /^\/api\/conversations\/\d+\/read$/.test(p)) return [];

  // 聊天系（高频写隔离：只 bump chat 域，不扰动其它域）
  if (/^\/api\/conversations\/\d+\/messages$/.test(p) ||
      p === '/api/uploads' || /^\/api\/uploads\/\d+$/.test(p)) return [DOMAINS.CHAT];

  // 需求系（学生需求 CRUD/重开、意向、推送）
  if (p === '/api/student/demands' || p === '/api/demand-pushes' ||
      /^\/api\/student\/demands\/\d+(\/reopen)?$/.test(p) ||
      /^\/api\/demands\/\d+\/intents$/.test(p) ||
      /^\/api\/intents\/\d+\/resolve$/.test(p) ||
      /^\/api\/demand-pushes\/\d+\/resolve$/.test(p)) return [DOMAINS.DEMANDS];

  // 合同系：双域（合同状态同时影响需求可见性/状态）
  if (p === '/api/contracts' ||
      /^\/api\/contracts\/\d+(\/(sign|revoke))?$/.test(p) ||
      /^\/api\/admin\/contracts\/\d+$/.test(p)) return [DOMAINS.CONTRACTS, DOMAINS.DEMANDS];

  // 教师系（档案保存、管理员核验、封禁——封禁影响教师列表可见性）
  if (p === '/api/teacher/profile' ||
      /^\/api\/admin\/teachers\/\d+\/verify$/.test(p) ||
      /^\/api\/admin\/users\/\d+\/ban$/.test(p)) return [DOMAINS.TEACHERS];

  // 帖子系（发布、点赞、删除）
  if (p === '/api/posts' || /^\/api\/posts\/\d+(\/like)?$/.test(p)) return [DOMAINS.POSTS];

  // 通知系（广播、删除广播批）
  if (p === '/api/notifications/broadcast' || /^\/api\/admin\/notifications\/\d+$/.test(p)) return [DOMAINS.NOTIFICATIONS];

  // 管理系兜底（反馈提交/处理 + 其余 admin 写：审核、删帖/删需求/删消息/删评价等）
  if (p === '/api/feedbacks' || /^\/api\/feedbacks\/\d+\/resolve$/.test(p) ||
      p.startsWith('/api/admin/')) return [DOMAINS.ADMIN];

  return [];
}
