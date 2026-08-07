/**
 * 经途·伴学信息门户 - Cloudflare Pages Worker 入口（编排层）
 * 本文件只做编排：CORS 预检 → 静态回退 → 初始化 → 体积闸门 → 限流 → 路由分发 → 留档包装。
 * 限流（security.rateGate）、CORS/安全头（security.*）、请求体解析（util.parseBody）、
 * 身份守卫（security.requireUser/requireAdmin）均为咽喉层实现，本文件不承载业务策略。
 *
 * 绑定: env.DB = D1 业务库；env.LOG_DB = 可选独立留档库；env.LEDGER_DB = 可选独立合同台账库
 * 安全: server/ 与 docs/ 目录随静态资源上传但在此统一 404，防源码公开访问
 * 留档: routeApi 的应答经 logRequest 留档——仅写操作与失败请求（读/轮询流量不入留档，见 log.js）
 */
import { initDb } from './server/db.js';
import { json, error, parseBody } from './server/util.js';
import { MSG } from './server/constants.js';
import { rateGate, corsPreflight, applySecurityHeaders } from './server/security.js';
import { initLogDb, bindLogDb, logRequest } from './server/log.js';
import { handleRegister, handleLogin, handleCheckUsername, handleAuthMe, handleSaveAvatar, handleDeactivateAccount, handleGetUserPublic, handleListSessions, handleRevokeSession, handleLogout, handleReAuth } from './server/routes-auth.js';
import { handleGetProfile, handleSaveProfile, handleGetTeachers } from './server/routes-teacher.js';
import {
  handleCreateDemand, handleGetDemands, handleUpdateDemand, handleDeleteDemand, handleReopenDemand,
  handleCreateIntent, handleGetIntents, handleResolveIntent,
  handlePushDemand, handleGetTeacherPushes, handleResolvePush,
} from './server/routes-demands.js';
import { handleGetNotifications, handleMarkNotificationsRead, handleAdminDeleteNotification } from './server/notify.js';
import {
  handleCreateContract, handleGetMyContracts,
  handleSignContract, handleModifyContract, handleCancelContract,
  handleAdminListContracts, handleAdminRemoveContract, handleVerifyContract, handleRevokeContract,
  initLedgerTable, bindLedgerDb,
} from './server/contract.js';
import { handleGetConversations, handleGetMessages, handleSendMessage, handleMarkRead, handleGetAttachment, handleCreateUpload, handleDeleteUpload } from './server/routes-chat.js';
import { handleCreateReview, handleGetReviews, handleUpdateReview } from './server/routes-reviews.js';
import {
  handleGenInvite, handleAdminStats, handleAdminTraffic,
  handleAdminReviews, handleReviewAction, handleAdminUsers, handleBanUser,
  handleAdminDemands, handleAdminDeleteDemand, handleAdminDeleteReview, handleAdminLogs, handleAdminDecryptLog, handleAdminBroadcast,
  handleCreateFeedback, handleAdminFeedbacks, handleResolveFeedback, handleAdminDeleteMessage, handleVerifyTeacher,
} from './server/routes-admin.js';
import { handleListPosts, handleCreatePost, handleToggleLike, handleDeletePost } from './server/routes-posts.js';
import { handleGetDataVersion, versionDomainOf, bumpVersions } from './server/version.js';

// API 分发：纯路由，无副作用（留档在 fetch 层统一包裹）。
// :id 路径统一经 idMatch 抽取（正则只写一次，杜绝 approve/reject 双 match 旧写法）
function idMatch(p, pattern) {
  const m = p.match(pattern);
  return m ? parseInt(m[1], 10) : null;
}

async function routeApi(db, p, method, body, url, req) {
  // 认证
  if (p === '/api/auth/register' && method === 'POST') return await handleRegister(db, body, req);
  if (p === '/api/auth/login' && method === 'POST') return await handleLogin(db, body, req);
  if (p === '/api/auth/check' && method === 'GET') return await handleCheckUsername(db, url);
  if (p === '/api/auth/me' && method === 'GET') return await handleAuthMe(db, req);
  if (p === '/api/auth/re-auth' && method === 'POST') return await handleReAuth(db, body, req);
  if (p === '/api/auth/logout' && method === 'POST') return await handleLogout(db, req);
  if (p === '/api/auth/sessions' && method === 'GET') return await handleListSessions(db, req);
  if (p === '/api/auth/sessions/revoke' && method === 'POST') return await handleRevokeSession(db, body, req);
  if (p === '/api/user/avatar' && method === 'POST') return await handleSaveAvatar(db, body, req);
  if (p === '/api/user/deactivate' && method === 'POST') return await handleDeactivateAccount(db, body, req);
  const userPublic = idMatch(p, /^\/api\/users\/(\d+)$/);
  if (userPublic && method === 'GET') return await handleGetUserPublic(db, userPublic);

  // 管理员
  if (p === '/api/admin/invite' && method === 'POST') return await handleGenInvite(db, body, req);
  if (p === '/api/admin/stats' && method === 'GET') return await handleAdminStats(db, url, req);
  if (p === '/api/admin/traffic' && method === 'GET') return await handleAdminTraffic(db, url, req);
  if (p === '/api/admin/reviews' && method === 'GET') return await handleAdminReviews(db, url, req);
  if (p === '/api/admin/logs' && method === 'GET') return await handleAdminLogs(db, url, req);
  const logDecrypt = idMatch(p, /^\/api\/admin\/logs\/(\d+)\/decrypt$/);
  if (logDecrypt && method === 'GET') return await handleAdminDecryptLog(db, logDecrypt, req);
  const reviewApprove = idMatch(p, /^\/api\/admin\/reviews\/(\d+)\/approve$/);
  if (reviewApprove && method === 'POST') return await handleReviewAction(db, reviewApprove, 'approve', body, req);
  const reviewReject = idMatch(p, /^\/api\/admin\/reviews\/(\d+)\/reject$/);
  if (reviewReject && method === 'POST') return await handleReviewAction(db, reviewReject, 'reject', body, req);
  if (p === '/api/admin/users' && method === 'GET') return await handleAdminUsers(db, url, req);
  if (p === '/api/admin/demands' && method === 'GET') return await handleAdminDemands(db, url, req);
  if (p === '/api/admin/contracts' && method === 'GET') return await handleAdminListContracts(db, url, req);
  const adminContractById = idMatch(p, /^\/api\/admin\/contracts\/(\d+)$/);
  if (adminContractById && method === 'DELETE') return await handleAdminRemoveContract(db, adminContractById, body, req);
  if (p === '/api/feedbacks' && method === 'POST') return await handleCreateFeedback(db, body, req);
  if (p === '/api/feedbacks' && method === 'GET') return await handleAdminFeedbacks(db, url, req);
  const feedbackResolve = idMatch(p, /^\/api\/feedbacks\/(\d+)\/resolve$/);
  if (feedbackResolve && method === 'POST') return await handleResolveFeedback(db, feedbackResolve, body, req);
  const userBan = idMatch(p, /^\/api\/admin\/users\/(\d+)\/ban$/);
  if (userBan && method === 'POST') return await handleBanUser(db, userBan, body, req);
  const teacherVerify = idMatch(p, /^\/api\/admin\/teachers\/(\d+)\/verify$/);
  if (teacherVerify && method === 'POST') return await handleVerifyTeacher(db, teacherVerify, body, req);
  const adminDemand = idMatch(p, /^\/api\/admin\/demands\/(\d+)$/);
  if (adminDemand && method === 'DELETE') return await handleAdminDeleteDemand(db, adminDemand, body, req);
  const adminReviewById = idMatch(p, /^\/api\/admin\/reviews\/(\d+)$/);
  if (adminReviewById && method === 'DELETE') return await handleAdminDeleteReview(db, adminReviewById, body, req);
  const adminMessageById = idMatch(p, /^\/api\/admin\/messages\/(\d+)$/);
  if (adminMessageById && method === 'DELETE') return await handleAdminDeleteMessage(db, adminMessageById, body, req);

  // 教师
  if (p === '/api/teacher/profile' && method === 'GET') return await handleGetProfile(db, url, req);
  if (p === '/api/teacher/profile' && method === 'POST') return await handleSaveProfile(db, body, req);
  if (p === '/api/teachers' && method === 'GET') return await handleGetTeachers(db, req);

  // 学生需求
  if (p === '/api/student/demands' && method === 'POST') return await handleCreateDemand(db, body, req);
  if (p === '/api/student/demands' && method === 'GET') return await handleGetDemands(db, url, req);
  const demandById = idMatch(p, /^\/api\/student\/demands\/(\d+)$/);
  if (demandById && method === 'PUT') return await handleUpdateDemand(db, demandById, body, req);
  if (demandById && method === 'DELETE') return await handleDeleteDemand(db, demandById, body, req);
  const demandReopen = idMatch(p, /^\/api\/student\/demands\/(\d+)\/reopen$/);
  if (demandReopen && method === 'POST') return await handleReopenDemand(db, demandReopen, body, req);

  // 需求意向
  const intentMatch = idMatch(p, /^\/api\/demands\/(\d+)\/intents$/);
  if (intentMatch && method === 'POST') return await handleCreateIntent(db, intentMatch, body, req);
  if (intentMatch && method === 'GET') return await handleGetIntents(db, intentMatch, req);
  const intentResolve = idMatch(p, /^\/api\/intents\/(\d+)\/resolve$/);
  if (intentResolve && method === 'POST') return await handleResolveIntent(db, intentResolve, body, req);

  // 需求主动推送（学生 → 教师）+ 教师处理推送
  if (p === '/api/demand-pushes' && method === 'POST') return await handlePushDemand(db, body, req);
  if (p === '/api/demand-pushes' && method === 'GET') return await handleGetTeacherPushes(db, url, req);
  const pushResolve = idMatch(p, /^\/api\/demand-pushes\/(\d+)\/resolve$/);
  if (pushResolve && method === 'POST') return await handleResolvePush(db, pushResolve, body, req);

  // 通知信息（全角色侧边栏模块）
  if (p === '/api/notifications' && method === 'GET') return await handleGetNotifications(db, req);
  if (p === '/api/notifications/read' && method === 'POST') return await handleMarkNotificationsRead(db, body, req);
  if (p === '/api/notifications/broadcast' && method === 'POST') return await handleAdminBroadcast(db, body, req);
  const notifDelete = idMatch(p, /^\/api\/admin\/notifications\/(\d+)$/);
  if (notifDelete && method === 'DELETE') return await handleAdminDeleteNotification(db, notifDelete, req);

  // 合同（起草 → 确认签约 → signed）
  if (p === '/api/contracts' && method === 'POST') return await handleCreateContract(db, body, req);
  if (p === '/api/contracts/my' && method === 'GET') return await handleGetMyContracts(db, url, req);
  const contractSign = idMatch(p, /^\/api\/contracts\/(\d+)\/sign$/);
  if (contractSign && method === 'POST') return await handleSignContract(db, contractSign, body, req);
  const contractVerify = idMatch(p, /^\/api\/contracts\/(\d+)\/verify$/);
  if (contractVerify && method === 'GET') return await handleVerifyContract(db, contractVerify, req);
  const contractRevoke = idMatch(p, /^\/api\/contracts\/(\d+)\/revoke$/);
  if (contractRevoke && method === 'POST') return await handleRevokeContract(db, contractRevoke, body, req);
  const contractById = idMatch(p, /^\/api\/contracts\/(\d+)$/);
  if (contractById && method === 'PUT') return await handleModifyContract(db, contractById, body, req);
  if (contractById && method === 'DELETE') return await handleCancelContract(db, contractById, body, req);

  // 站内沟通
  if (p === '/api/conversations' && method === 'GET') return await handleGetConversations(db, url, req);
  const convRead = idMatch(p, /^\/api\/conversations\/(\d+)\/read$/);
  if (convRead && method === 'POST') return await handleMarkRead(db, convRead, body, req);
  const convMsgs = idMatch(p, /^\/api\/conversations\/(\d+)\/messages$/);
  if (convMsgs && method === 'GET') return await handleGetMessages(db, convMsgs, url, req);
  if (convMsgs && method === 'POST') return await handleSendMessage(db, convMsgs, body, req);
  const msgAttach = p.match(/^\/api\/conversations\/(\d+)\/messages\/(\d+)\/attachment$/);
  if (msgAttach && method === 'GET') return await handleGetAttachment(db, parseInt(msgAttach[1], 10), parseInt(msgAttach[2], 10), url, req);
  if (p === '/api/uploads' && method === 'POST') return await handleCreateUpload(db, body, req);
  const uploadById = idMatch(p, /^\/api\/uploads\/(\d+)$/);
  if (uploadById && method === 'DELETE') return await handleDeleteUpload(db, uploadById, body, req);

  // 评价
  if (p === '/api/reviews' && method === 'POST') return await handleCreateReview(db, body, req);
  if (p === '/api/reviews' && method === 'GET') return await handleGetReviews(db, url, req);
  const reviewById = idMatch(p, /^\/api\/reviews\/(\d+)$/);
  if (reviewById && method === 'PUT') return await handleUpdateReview(db, reviewById, body, req);

  // 资料共享（section 字段预留分区，当前全在广场）
  if (p === '/api/posts' && method === 'GET') return await handleListPosts(db, url, req);
  if (p === '/api/posts' && method === 'POST') return await handleCreatePost(db, body, req);
  const postLike = idMatch(p, /^\/api\/posts\/(\d+)\/like$/);
  if (postLike && method === 'POST') return await handleToggleLike(db, postLike, body, req);
  const postById = idMatch(p, /^\/api\/posts\/(\d+)$/);
  if (postById && method === 'DELETE') return await handleDeletePost(db, postById, body, req);

  // 健康检查
  if (p === '/api/health') return json({ status: 'ok', timestamp: new Date().toISOString() });

  // 数据版本戳（v0.23.0 静默数据层）：客户端 8s 轮询探测；廉价单表读，无需鉴权（计数器无敏感性）
  if (p === '/api/data-version' && method === 'GET') return await handleGetDataVersion(db);

  return error('Not Found', 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    let p = url.pathname;
    try { p = decodeURIComponent(p); } catch { /* 非法编码保持原样 */ } // 防 %73erver 式编码绕过路径前缀检查

    // CORS preflight（网安咽喉单点）：仅对 /api/ 路径应答——非 API 敏感路径的 OPTIONS 一律 404（网安审计：曾绕过敏感路径黑名单）
    if (request.method === 'OPTIONS') {
      if (!p.startsWith('/api/')) return new Response('Not Found', { status: 404 });
      return applySecurityHeaders(corsPreflight(), p);
    }

    // 非 API 请求 → 静态文件。敏感路径一律 404：源码目录 server/、docs/、secrets.js（敏感配置）、
    // 版本控制与构建残留（.git/、.wrangler/）、包清单（package*.json / node_modules/）、
    // 配置残留（wrangler.toml / robots.txt / sitemap.xml，网安报告 F-01d 收口）
    if (!p.startsWith('/api/')) {
      if (p.startsWith('/server/') || p.startsWith('/server') || p.startsWith('/docs/') ||
          p === '/secrets.js' ||
          p.startsWith('/.git/') || p.startsWith('/.wrangler/') || p.startsWith('/node_modules/') ||
          p === '/package.json' || p === '/package-lock.json' || p.endsWith('.md') ||
          p === '/wrangler.toml' || p === '/robots.txt' || p === '/sitemap.xml' ||
          p.startsWith('/.claude/') || p.startsWith('/.github/') || p === '/.claude' || p === '/.github') { // 本地配置/CI 目录不入静态面（网安审计）
        return applySecurityHeaders(new Response('Not Found', { status: 404 }), p);
      }
      return applySecurityHeaders(env.ASSETS.fetch(request), p);
    }

    // 首次请求时初始化数据库（业务库 + 可选独立留档库 + 可选独立合同台账库）。
    // Promise 挂载防并发双跑（网安报告 F-09）：initDb 内部是多个 await 序列，布尔标志存在空窗，
    // Promise 化后同一 isolate 内所有请求共享同一初始化。失败置空允许下次请求重试
    if (!env._dbInited) {
      env._dbInited = initDb(env.DB, env)
        .then(() => (env.LOG_DB ? initLogDb(env.LOG_DB) : undefined))
        .then(() => initLedgerTable(env.LEDGER_DB || env.DB))
        .catch(e => { env._dbInited = null; throw e; });
      bindLogDb(env); // 管理员配置经 secrets 网关读取（env.Worker Secrets 优先，回落本地文件）
      bindLedgerDb(env);
    }
    await env._dbInited;

    const db = env.DB;
    // 体积炸弹防护在 util.parseBody（Content-Length 短路 + 流式硬上限），失败 413 在此转响应
    let body = {};
    try { body = await parseBody(request); }
    catch (e) {
      if (e && e.status === 413) return applySecurityHeaders(error(MSG.PAYLOAD_TOO_LARGE, 413), p);
      body = {};
    }

    // 限流闸门（网安咽喉；IP 取 CF-Connecting-IP；超限一律 429，细节不回显）
    const ip = request.headers.get('CF-Connecting-IP') || 'anon';
    if (!(await rateGate(ip, p, request.method, body, Date.now(), db))) {
      return applySecurityHeaders(error(MSG.RATE_LIMITED, 429), p);
    }

    const t0 = Date.now(); // D：请求耗时（留档 duration_ms，可观测性）
    try {
      const res = await routeApi(db, p, request.method, body, url, request);
      // 数据版本戳（v0.23.0 静默数据层）：写操作成功在写咽喉 bump 受影响域。
      // waitUntil 包裹——workerd 会掐断未完成的悬浮 Promise；版本戳失败静默
      // （bumpVersions 内吞错），不影响主业务。
      // 会话缓存已整体迁至客户端（app-datahub.js）：服务端读缓存（v0.22.5/8 按身份分桶）
      // 随 v0.23.0 删除——同身份重复读由客户端缓存覆盖（60s TTL + 8s 版本探测刷新），
      // per-user 数据在浏览器侧天然按会话隔离，跨用户零泄露面更小。
      if (request.method !== 'GET' && res.status < 400) {
        const domains = versionDomainOf(p);
        if (domains.length) ctx.waitUntil(bumpVersions(env.DB, domains));
      }
      // 留档必须 await：workerd 在响应结束后掐断未完成的悬浮 Promise（加密咽喉链路较长，
      // 不 await 会导致留档被杀在途中——本批次线上 0 留档事故根因）。
      // logRequest 兼作本请求全部留档的统一落库点（B4：业务 logEvent 队列 + 本条访问留档一次 batch）
      await logRequest(db, { method: request.method, path: p, body, status: res.status, req: request, durationMs: Date.now() - t0 });
      return applySecurityHeaders(res, p);
    } catch (err) {
      console.error('API Error:', err); // 细节只留服务端日志
      await logRequest(db, { method: request.method, path: p, body, status: 500, req: request, durationMs: Date.now() - t0 });
      return applySecurityHeaders(error(MSG.SERVER_ERROR, 500), p); // 回显脱敏：不回传 err.message
    }
  },
  // D1 保活（v0.22.8，性能杠杆）：wrangler.toml [triggers] 每 5 分钟触发本 handler，
  // 对业务/留档/台账三库轻查询 SELECT 1，避免 D1 空闲冷启动（首击 4-6s 唤醒）。
  // 冷启动伤害最重的是 per-token 列表页（无读缓存覆盖），保活后恢复百毫秒级。
  async scheduled(event, env, ctx) {
    const ping = db => (db ? db.prepare('SELECT 1').run().catch(() => {}) : Promise.resolve());
    try {
      await Promise.all([ping(env.DB), ping(env.LOG_DB), ping(env.LEDGER_DB)]);
    } catch { /* 保活失败静默，不影响主流程 */ }
  },
};
