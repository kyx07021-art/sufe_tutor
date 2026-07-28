/**
 * 上财家教信息共享平台 - Cloudflare Pages Worker 入口
 * 本文件只做三件事：CORS 预检、路由分发、静态文件回退
 * 全部业务逻辑在 server/*.js 模块中（core 工具 / db 数据层 / log 留档 / routes-* 路由）
 *
 * 绑定: env.DB = D1 业务库；env.LOG_DB = 可选独立留档库（未绑定则留档落业务库）
 * 安全: server/ 与 docs/ 目录随静态资源上传但在此统一 404，防源码公开访问
 * 留档: routeApi 的每次应答经 logRequest 通用兜底留档（模块5）
 */
import { initDb } from './server/db.js';
import { json, error, MSG, bindCoreEnv } from './server/core.js';
import { initLogDb, bindLogDb, logRequest } from './server/log.js';
import { handleRegister, handleLogin, handleCheckUsername, handleAuthMe, handleSaveAvatar, handleDeactivateAccount } from './server/routes-auth.js';
import { handleGetProfile, handleSaveProfile, handleGetTeachers } from './server/routes-teacher.js';
import {
  handleCreateDemand, handleGetDemands, handleUpdateDemand, handleDeleteDemand,
  handleCreateIntent, handleGetIntents, handleResolveIntent,
  handlePushDemand, handleGetTeacherPushes, handleResolvePush,
} from './server/routes-demands.js';
import { handleGetNotifications, handleMarkNotificationsRead } from './server/notify.js';
import {
  handleCreateContract, handleGetContractByConv, handleGetMyContracts,
  handleConfirmDraft, handleSignContract, handleModifyContract, handleCancelContract,
  handleAdminListContracts, handleAdminRemoveContract, handleVerifyContract, handleRevokeContract,
  initLedgerTable, bindLedgerDb,
} from './server/contract.js';
import { handleGetConversations, handleGetMessages, handleSendMessage, handleMarkRead, handleGetAttachment, handleCreateUpload, handleDeleteUpload } from './server/routes-chat.js';
import { handleCreateReview, handleGetReviews, handleUpdateReview } from './server/routes-reviews.js';
import {
  handleAdminCheck, handleGenInvite, handleAdminInvites, handleAdminStats,
  handleAdminReviews, handleReviewAction, handleAdminUsers, handleBanUser,
  handleAdminDeleteDemand, handleAdminDeleteReview, handleAdminLogs, handleAdminDecryptLog, handleAdminBroadcast,
  handleCreateFeedback, handleAdminFeedbacks, handleResolveFeedback, handleAdminDeleteMessage,
} from './server/routes-admin.js';
import { handleListPosts, handleCreatePost, handleToggleLike, handleDeletePost } from './server/routes-posts.js';

// ============================================================
// 频次限制 + 异常 IP 封锁（模块级内存表，per-isolate best-effort：
// workerd 实例重启即清零——误伤自愈，攻击者打满也扛不过实例轮换。
// 公测要持久化限流再上 KV / Cloudflare Rate Limiting，见 docs/secrets-plan.md 同系规划）
// ============================================================
const RL = { hits: new Map(), strikes: new Map(), blocked: new Map() };
const rlSweep = now => {
  if (RL.hits.size < 4096) return;
  for (const [k, v] of RL.hits) if (v.reset < now) RL.hits.delete(k);
  for (const [k, until] of RL.blocked) if (until < now) RL.blocked.delete(k);
};
const rlBump = (key, limit, windowMs, now) => {
  let e = RL.hits.get(key);
  if (!e || e.reset < now) { e = { n: 0, reset: now + windowMs }; RL.hits.set(key, e); }
  return ++e.n <= limit;
};
const rlStrike = (ip, now) => {
  const n = (RL.strikes.get(ip) || 0) + 1;
  RL.strikes.set(ip, n);
  if (n >= 3) { RL.blocked.set(ip, now + 15 * 60 * 1000); RL.strikes.delete(ip); } // 10 分钟内 3 次超限 → 封 15 分钟
};
// 闸门：全局 300 次/分（含静态）；写操作 60 次/分；登录 8 次/10 分（按 IP+用户名，防撞库）；
// 注册 5 次/时（防批量建号 + PBKDF2 CPU 消耗）；用户名探测 30 次/分（防枚举）
function rateGate(ip, p, method, body, now) {
  rlSweep(now);
  if ((RL.blocked.get(ip) || 0) > now) return false;
  if (!rlBump(`g:${ip}`, 300, 60000, now)) { rlStrike(ip, now); return false; }
  if (method !== 'GET' && p.startsWith('/api/') && !rlBump(`w:${ip}`, 60, 60000, now)) { rlStrike(ip, now); return false; }
  if (p === '/api/auth/login' && !rlBump(`l:${ip}:${String((body && body.username) || '').toLowerCase()}`, 8, 600000, now)) { rlStrike(ip, now); return false; }
  if (p === '/api/auth/register' && !rlBump(`r:${ip}`, 5, 3600000, now)) { rlStrike(ip, now); return false; }
  if (p === '/api/auth/check' && !rlBump(`c:${ip}`, 30, 60000, now)) return false; // 软限制不记三振
  return true;
}

// API 分发：纯路由，无副作用（留档在 fetch 层统一包裹）
async function routeApi(db, p, method, body, url, req) {
  // 认证
  if (p === '/api/auth/register' && method === 'POST') return await handleRegister(db, body, req);
  if (p === '/api/auth/login' && method === 'POST') return await handleLogin(db, body, req);
  if (p === '/api/auth/check' && method === 'GET') return await handleCheckUsername(db, url);
  if (p === '/api/auth/me' && method === 'GET') return await handleAuthMe(db, req);
  if (p === '/api/user/avatar' && method === 'POST') return await handleSaveAvatar(db, body, req);
  if (p === '/api/user/deactivate' && method === 'POST') return await handleDeactivateAccount(db, body, req);

  // 管理员
  if (p === '/api/admin/check' && method === 'GET') return await handleAdminCheck(db, req);
  if (p === '/api/admin/invite' && method === 'POST') return await handleGenInvite(db, body, req);
  if (p === '/api/admin/invites' && method === 'GET') return await handleAdminInvites(db, url, req);
  if (p === '/api/admin/stats' && method === 'GET') return await handleAdminStats(db, url, req);
  if (p === '/api/admin/reviews' && method === 'GET') return await handleAdminReviews(db, url, req);
  if (p === '/api/admin/logs' && method === 'GET') return await handleAdminLogs(db, url, req);
  const logDecrypt = p.match(/^\/api\/admin\/logs\/(\d+)\/decrypt$/);
  if (logDecrypt && method === 'GET') return await handleAdminDecryptLog(db, parseInt(logDecrypt[1]), req);
  if (p.match(/^\/api\/admin\/reviews\/(\d+)\/approve$/) && method === 'POST') {
    const id = parseInt(p.match(/\/(\d+)\//)[1]);
    return await handleReviewAction(db, id, 'approve', body, req);
  }
  if (p.match(/^\/api\/admin\/reviews\/(\d+)\/reject$/) && method === 'POST') {
    const id = parseInt(p.match(/\/(\d+)\//)[1]);
    return await handleReviewAction(db, id, 'reject', body, req);
  }
  if (p === '/api/admin/users' && method === 'GET') return await handleAdminUsers(db, url, req);
  if (p === '/api/admin/contracts' && method === 'GET') return await handleAdminListContracts(db, url, req);
  const adminContractById = p.match(/^\/api\/admin\/contracts\/(\d+)$/);
  if (adminContractById && method === 'DELETE') return await handleAdminRemoveContract(db, parseInt(adminContractById[1]), body, req);
  if (p === '/api/feedbacks' && method === 'POST') return await handleCreateFeedback(db, body, req);
  if (p === '/api/feedbacks' && method === 'GET') return await handleAdminFeedbacks(db, url, req);
  const feedbackResolve = p.match(/^\/api\/feedbacks\/(\d+)\/resolve$/);
  if (feedbackResolve && method === 'POST') return await handleResolveFeedback(db, parseInt(feedbackResolve[1]), body, req);
  const userBan = p.match(/^\/api\/admin\/users\/(\d+)\/ban$/);
  if (userBan && method === 'POST') return await handleBanUser(db, parseInt(userBan[1]), body, req);
  const adminDemand = p.match(/^\/api\/admin\/demands\/(\d+)$/);
  if (adminDemand && method === 'DELETE') return await handleAdminDeleteDemand(db, parseInt(adminDemand[1]), body, req);
  const adminReviewById = p.match(/^\/api\/admin\/reviews\/(\d+)$/);
  if (adminReviewById && method === 'DELETE') return await handleAdminDeleteReview(db, parseInt(adminReviewById[1]), body, req);
  const adminMessageById = p.match(/^\/api\/admin\/messages\/(\d+)$/);
  if (adminMessageById && method === 'DELETE') return await handleAdminDeleteMessage(db, parseInt(adminMessageById[1]), body, req);

  // 教师
  if (p === '/api/teacher/profile' && method === 'GET') return await handleGetProfile(db, url, req);
  if (p === '/api/teacher/profile' && method === 'POST') return await handleSaveProfile(db, body, req);
  if (p === '/api/teachers' && method === 'GET') return await handleGetTeachers(db);

  // 学生需求
  if (p === '/api/student/demands' && method === 'POST') return await handleCreateDemand(db, body, req);
  if (p === '/api/student/demands' && method === 'GET') return await handleGetDemands(db, url, req);
  const demandById = p.match(/^\/api\/student\/demands\/(\d+)$/);
  if (demandById && method === 'PUT') return await handleUpdateDemand(db, parseInt(demandById[1]), body, req);
  if (demandById && method === 'DELETE') return await handleDeleteDemand(db, parseInt(demandById[1]), body, req);

  // 需求意向
  const intentMatch = p.match(/^\/api\/demands\/(\d+)\/intents$/);
  if (intentMatch && method === 'POST') return await handleCreateIntent(db, parseInt(intentMatch[1]), body, req);
  if (intentMatch && method === 'GET') return await handleGetIntents(db, parseInt(intentMatch[1]), req);
  const intentResolve = p.match(/^\/api\/intents\/(\d+)\/resolve$/);
  if (intentResolve && method === 'POST') return await handleResolveIntent(db, parseInt(intentResolve[1]), body, req);

  // 需求主动推送（学生 → 教师）+ 教师处理推送
  if (p === '/api/demand-pushes' && method === 'POST') return await handlePushDemand(db, body, req);
  if (p === '/api/demand-pushes' && method === 'GET') return await handleGetTeacherPushes(db, url, req);
  const pushResolve = p.match(/^\/api\/demand-pushes\/(\d+)\/resolve$/);
  if (pushResolve && method === 'POST') return await handleResolvePush(db, parseInt(pushResolve[1]), body, req);

  // 通知信息（全角色侧边栏模块）
  if (p === '/api/notifications' && method === 'GET') return await handleGetNotifications(db, url, req);
  if (p === '/api/notifications/read' && method === 'POST') return await handleMarkNotificationsRead(db, body, req);
  if (p === '/api/notifications/broadcast' && method === 'POST') return await handleAdminBroadcast(db, body, req);

  // 合同（起草 → 确认草案 → 确认签约 → signed；测试版短信验证预留）
  if (p === '/api/contracts' && method === 'POST') return await handleCreateContract(db, body, req);
  if (p === '/api/contracts' && method === 'GET') return await handleGetContractByConv(db, url, req);
  if (p === '/api/contracts/my' && method === 'GET') return await handleGetMyContracts(db, url, req);
  const contractAction = p.match(/^\/api\/contracts\/(\d+)\/(confirm-draft|sign)$/);
  if (contractAction && method === 'POST') {
    const cid = parseInt(contractAction[1]);
    return contractAction[2] === 'sign'
      ? await handleSignContract(db, cid, body, req)
      : await handleConfirmDraft(db, cid, body, req);
  }
  const contractVerify = p.match(/^\/api\/contracts\/(\d+)\/verify$/);
  if (contractVerify && method === 'GET') return await handleVerifyContract(db, parseInt(contractVerify[1]), req);
  const contractRevoke = p.match(/^\/api\/contracts\/(\d+)\/revoke$/);
  if (contractRevoke && method === 'POST') return await handleRevokeContract(db, parseInt(contractRevoke[1]), body, req);
  const contractById = p.match(/^\/api\/contracts\/(\d+)$/);
  if (contractById && method === 'PUT') return await handleModifyContract(db, parseInt(contractById[1]), body, req);
  if (contractById && method === 'DELETE') return await handleCancelContract(db, parseInt(contractById[1]), body, req);

  // 站内沟通
  if (p === '/api/conversations' && method === 'GET') return await handleGetConversations(db, url, req);
  const convRead = p.match(/^\/api\/conversations\/(\d+)\/read$/);
  if (convRead && method === 'POST') return await handleMarkRead(db, parseInt(convRead[1]), body, req);
  const convMsgs = p.match(/^\/api\/conversations\/(\d+)\/messages$/);
  if (convMsgs && method === 'GET') return await handleGetMessages(db, parseInt(convMsgs[1]), url, req);
  if (convMsgs && method === 'POST') return await handleSendMessage(db, parseInt(convMsgs[1]), body, req);
  const msgAttach = p.match(/^\/api\/conversations\/(\d+)\/messages\/(\d+)\/attachment$/);
  if (msgAttach && method === 'GET') return await handleGetAttachment(db, parseInt(msgAttach[1]), parseInt(msgAttach[2]), url, req);
  if (p === '/api/uploads' && method === 'POST') return await handleCreateUpload(db, body, req);
  const uploadById = p.match(/^\/api\/uploads\/(\d+)$/);
  if (uploadById && method === 'DELETE') return await handleDeleteUpload(db, parseInt(uploadById[1]), body, req);

  // 评价
  if (p === '/api/reviews' && method === 'POST') return await handleCreateReview(db, body, req);
  if (p === '/api/reviews' && method === 'GET') return await handleGetReviews(db, url, req);
  const reviewById = p.match(/^\/api\/reviews\/(\d+)$/);
  if (reviewById && method === 'PUT') return await handleUpdateReview(db, parseInt(reviewById[1]), body, req);

  // 资料共享（模块2：section 字段预留分区，当前全在广场）
  if (p === '/api/posts' && method === 'GET') return await handleListPosts(db, url);
  if (p === '/api/posts' && method === 'POST') return await handleCreatePost(db, body, req);
  const postLike = p.match(/^\/api\/posts\/(\d+)\/like$/);
  if (postLike && method === 'POST') return await handleToggleLike(db, parseInt(postLike[1]), body, req);
  const postById = p.match(/^\/api\/posts\/(\d+)$/);
  if (postById && method === 'DELETE') return await handleDeletePost(db, parseInt(postById[1]), body, req);

  // 健康检查
  if (p === '/api/health') return json({ status: 'ok', timestamp: new Date().toISOString() });

  return error('Not Found', 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let p = url.pathname;
    try { p = decodeURIComponent(p); } catch { /* 非法编码保持原样 */ } // 防 %73erver 式编码绕过路径前缀检查

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    // 非 API 请求 → 静态文件。敏感路径一律 404：源码目录 server/、docs/、secrets.js（敏感配置）、
    // 版本控制与构建残留（.git/、.wrangler/）、包清单（package*.json / node_modules/）
    if (!p.startsWith('/api/')) {
      if (p.startsWith('/server/') || p.startsWith('/docs/') || p === '/secrets.js' ||
          p.startsWith('/.git/') || p.startsWith('/.wrangler/') || p.startsWith('/node_modules/') ||
          p === '/package.json' || p === '/package-lock.json' || p === '/gen_flow.js' || p.endsWith('.md')) {
        return new Response('Not Found', { status: 404 });
      }
      return env.ASSETS.fetch(request);
    }

    // 首次请求时初始化数据库（业务库 + 可选独立留档库 + 可选独立合同台账库）
    if (!env._dbInited) {
      await initDb(env.DB);
      if (env.LOG_DB) await initLogDb(env.LOG_DB);
      bindLogDb(env);
      await initLedgerTable(env.LEDGER_DB || env.DB);
      bindLedgerDb(env);
      bindCoreEnv(env);
      env._dbInited = true;
    }

    const db = env.DB;
    let body = {};
    if (request.method === 'POST' || request.method === 'PUT' || request.method === 'DELETE') {
      try { body = await request.json(); } catch { body = {}; }
    }

    // 限流闸门（IP 取 CF-Connecting-IP；超限一律 429，细节不回显）
    const ip = request.headers.get('CF-Connecting-IP') || 'anon';
    if (!rateGate(ip, p, request.method, body, Date.now())) return error(MSG.RATE_LIMITED, 429);

    try {
      const res = await routeApi(db, p, request.method, body, url, request);
      // 留档必须 await：workerd 在响应结束后掐断未完成的悬浮 Promise（加密咽喉链路较长，
      // 不 await 会导致留档被杀在途中——本批次线上 0 留档事故根因）
      await logRequest(db, { method: request.method, path: p, body, status: res.status, req: request });
      return res;
    } catch (err) {
      console.error('API Error:', err); // 细节只留服务端日志
      await logRequest(db, { method: request.method, path: p, body, status: 500, req: request });
      return error(MSG.SERVER_ERROR, 500); // 回显脱敏：不回传 err.message（防泄露表名/约束等内部信息）
    }
  },
};
