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
import { json, error, MSG } from './server/core.js';

// 统一安全响应头（网安报告 F-08）：HTTP 级 CSP（frame-ancestors 仅 HTTP 头生效，meta 无法表达）、
// HSTS、Permissions-Policy、nosniff；敏感 API 追加 no-store 防浏览器缓存。
// CSP 与页面 meta CSP 同源同策略（default-src 'self' + 内联脚本/样式为本站架构所需）。
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};
// API 响应统一加安全头（F-08）：HTTP 级 CSP（frame-ancestors 仅 HTTP 头生效）、HSTS、
// nosniff、Permissions-Policy、no-store。仅 API 走此函数——server 构造的标准 Response 头可写；
// 静态资源（ASSETS）在 wrangler 里返回非标准对象（无 headers/clone），改由 Pages `_headers`
// 文件加静态层安全头（Cloudflare 原生机制，不经 worker，见仓库根 _headers），二者互不纠缠。
const applySecurityHeaders = (res, path) => {
  if (!path.startsWith('/api/')) return res;
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v);
  res.headers.set('Cache-Control', 'no-store'); // 敏感 API 数据禁浏览器缓存
  return res;
};
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
  handleAdminDemands, handleAdminDeleteDemand, handleAdminDeleteReview, handleAdminLogs, handleAdminDecryptLog, handleAdminBroadcast,
  handleCreateFeedback, handleAdminFeedbacks, handleResolveFeedback, handleAdminDeleteMessage, handleVerifyTeacher,
} from './server/routes-admin.js';
import { handleListPosts, handleCreatePost, handleToggleLike, handleDeletePost } from './server/routes-posts.js';

// ============================================================
// 频次限制 + 异常 IP 封锁（网安报告 F-09：内存 Map 单实例化 → 混合持久化）
// 高频键（全局/写/探测，每请求必查）留内存 per-isolate best-effort——实例重启即清零，误伤自愈；
// 低频危险键（登录/注册/密码重认证/三振/封禁）落 D1 rate_limits 表（initDb 建表，零新增绑定）：
// 跨实例生效、重启不清零。strike 双写（内存即时 + D1 持久），仅超限时发生，成本可忽略
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
// D1 原子计数：单条 UPSERT（窗口内 +1 / 过期重置为 1），窗口与比较全在 SQL 内同口径（localtime 串）；
// 写时顺带清过期行，低频表不膨胀。返回是否未超限
const rlBumpD1 = async (db, key, limit, windowMs) => {
  const mod = '+' + Math.round(windowMs / 1000) + ' seconds';
  await db.prepare(`INSERT INTO rate_limits (bucket, n, reset_at) VALUES (?, 1, datetime('now','localtime', ?))
    ON CONFLICT(bucket) DO UPDATE SET
      n = CASE WHEN rate_limits.reset_at > datetime('now','localtime') THEN rate_limits.n + 1 ELSE 1 END,
      reset_at = CASE WHEN rate_limits.reset_at > datetime('now','localtime') THEN rate_limits.reset_at ELSE excluded.reset_at END`)
    .bind(key, mod).run();
  await db.prepare("DELETE FROM rate_limits WHERE reset_at < datetime('now','localtime','-1 day')").run();
  const row = await db.prepare('SELECT n FROM rate_limits WHERE bucket=?').bind(key).first();
  return !row || row.n <= limit;
};
// D1 三振封禁：strike 行 10 分钟窗口计数，满 3 次写 block 行（15 分钟，SQL 内比较时间）
const rlStrikeD1 = async (db, ip) => {
  await db.prepare(`INSERT INTO rate_limits (bucket, n, reset_at) VALUES (?, 1, datetime('now','localtime','+600 seconds'))
    ON CONFLICT(bucket) DO UPDATE SET
      n = CASE WHEN rate_limits.reset_at > datetime('now','localtime') THEN rate_limits.n + 1 ELSE 1 END,
      reset_at = CASE WHEN rate_limits.reset_at > datetime('now','localtime') THEN rate_limits.reset_at ELSE excluded.reset_at END`)
    .bind(`strike:${ip}`).run();
  const st = await db.prepare('SELECT n FROM rate_limits WHERE bucket=?').bind(`strike:${ip}`).first();
  if (st && st.n >= 3) {
    await db.prepare("INSERT OR REPLACE INTO rate_limits (bucket, n, reset_at) VALUES (?, 1, datetime('now','localtime','+900 seconds'))")
      .bind(`block:${ip}`).run();
    await db.prepare('DELETE FROM rate_limits WHERE bucket=?').bind(`strike:${ip}`).run();
  }
};
// 闸门：全局 300 次/分（含静态）与写操作 60 次/分走内存（最热路径）；
// 登录 8 次/10 分（按 IP+用户名，防撞库）、注册 5 次/时（防批量建号 + PBKDF2 CPU 消耗）、
// 密码重认证 8 次/10 分（危险操作二次认证防爆破）与封禁走 D1 持久化（跨实例生效）。
// 用户名探测 30 次/分（防枚举）走内存软限制，不记三振。D1 封禁检查仅低频危险路径挂载，
// 普通请求零额外延迟
async function rateGate(ip, p, method, body, now, db) {
  rlSweep(now);
  if ((RL.blocked.get(ip) || 0) > now) return false;
  if (!rlBump(`g:${ip}`, 300, 60000, now)) { rlStrike(ip, now); await rlStrikeD1(db, ip); return false; }
  if (method !== 'GET' && p.startsWith('/api/') && !rlBump(`w:${ip}`, 60, 60000, now)) { rlStrike(ip, now); await rlStrikeD1(db, ip); return false; }
  if (p === '/api/auth/login' || p === '/api/auth/register' || p === '/api/auth/re-auth') {
    const blk = await db.prepare("SELECT 1 AS b FROM rate_limits WHERE bucket=? AND reset_at > datetime('now','localtime')").bind(`block:${ip}`).first();
    if (blk) return false;
    if (p === '/api/auth/login' && !(await rlBumpD1(db, `l:${ip}:${String((body && body.username) || '').toLowerCase()}`, 8, 600000))) { await rlStrikeD1(db, ip); return false; }
    if (p === '/api/auth/register' && !(await rlBumpD1(db, `r:${ip}`, 5, 3600000))) { await rlStrikeD1(db, ip); return false; }
    if (p === '/api/auth/re-auth' && !(await rlBumpD1(db, `ra:${ip}`, 8, 600000))) { await rlStrikeD1(db, ip); return false; }
  }
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
  if (p === '/api/auth/re-auth' && method === 'POST') return await handleReAuth(db, body, req);
  if (p === '/api/auth/logout' && method === 'POST') return await handleLogout(db, req);
  if (p === '/api/auth/sessions' && method === 'GET') return await handleListSessions(db, req);
  if (p === '/api/auth/sessions/revoke' && method === 'POST') return await handleRevokeSession(db, body, req);
  if (p === '/api/user/avatar' && method === 'POST') return await handleSaveAvatar(db, body, req);
  if (p === '/api/user/deactivate' && method === 'POST') return await handleDeactivateAccount(db, body, req);
  const userPublic = p.match(/^\/api\/users\/(\d+)$/);
  if (userPublic && method === 'GET') return await handleGetUserPublic(db, parseInt(userPublic[1]));

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
  if (p === '/api/admin/demands' && method === 'GET') return await handleAdminDemands(db, url, req);
  if (p === '/api/admin/contracts' && method === 'GET') return await handleAdminListContracts(db, url, req);
  const adminContractById = p.match(/^\/api\/admin\/contracts\/(\d+)$/);
  if (adminContractById && method === 'DELETE') return await handleAdminRemoveContract(db, parseInt(adminContractById[1]), body, req);
  if (p === '/api/feedbacks' && method === 'POST') return await handleCreateFeedback(db, body, req);
  if (p === '/api/feedbacks' && method === 'GET') return await handleAdminFeedbacks(db, url, req);
  const feedbackResolve = p.match(/^\/api\/feedbacks\/(\d+)\/resolve$/);
  if (feedbackResolve && method === 'POST') return await handleResolveFeedback(db, parseInt(feedbackResolve[1]), body, req);
  const userBan = p.match(/^\/api\/admin\/users\/(\d+)\/ban$/);
  if (userBan && method === 'POST') return await handleBanUser(db, parseInt(userBan[1]), body, req);
  const teacherVerify = p.match(/^\/api\/admin\/teachers\/(\d+)\/verify$/);
  if (teacherVerify && method === 'POST') return await handleVerifyTeacher(db, parseInt(teacherVerify[1]), body, req);
  const adminDemand = p.match(/^\/api\/admin\/demands\/(\d+)$/);
  if (adminDemand && method === 'DELETE') return await handleAdminDeleteDemand(db, parseInt(adminDemand[1]), body, req);
  const adminReviewById = p.match(/^\/api\/admin\/reviews\/(\d+)$/);
  if (adminReviewById && method === 'DELETE') return await handleAdminDeleteReview(db, parseInt(adminReviewById[1]), body, req);
  const adminMessageById = p.match(/^\/api\/admin\/messages\/(\d+)$/);
  if (adminMessageById && method === 'DELETE') return await handleAdminDeleteMessage(db, parseInt(adminMessageById[1]), body, req);

  // 教师
  if (p === '/api/teacher/profile' && method === 'GET') return await handleGetProfile(db, url, req);
  if (p === '/api/teacher/profile' && method === 'POST') return await handleSaveProfile(db, body, req);
  if (p === '/api/teachers' && method === 'GET') return await handleGetTeachers(db, req);

  // 学生需求
  if (p === '/api/student/demands' && method === 'POST') return await handleCreateDemand(db, body, req);
  if (p === '/api/student/demands' && method === 'GET') return await handleGetDemands(db, url, req);
  const demandById = p.match(/^\/api\/student\/demands\/(\d+)$/);
  if (demandById && method === 'PUT') return await handleUpdateDemand(db, parseInt(demandById[1]), body, req);
  if (demandById && method === 'DELETE') return await handleDeleteDemand(db, parseInt(demandById[1]), body, req);
  const demandReopen = p.match(/^\/api\/student\/demands\/(\d+)\/reopen$/);
  if (demandReopen && method === 'POST') return await handleReopenDemand(db, parseInt(demandReopen[1]), body, req);

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
  const notifDelete = p.match(/^\/api\/admin\/notifications\/(\d+)$/);
  if (notifDelete && method === 'DELETE') return await handleAdminDeleteNotification(db, parseInt(notifDelete[1]), req);

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
  if (p === '/api/posts' && method === 'GET') return await handleListPosts(db, url, req);
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
      return await applySecurityHeaders(new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      }), p);
    }

    // 非 API 请求 → 静态文件。敏感路径一律 404：源码目录 server/、docs/、secrets.js（敏感配置）、
    // 版本控制与构建残留（.git/、.wrangler/）、包清单（package*.json / node_modules/）、
    // 配置残留（wrangler.toml / robots.txt / sitemap.xml，网安报告 F-01d 收口）
    if (!p.startsWith('/api/')) {
      if (p.startsWith('/server/') || p.startsWith('/server') || p.startsWith('/docs/') ||
          p === '/secrets.js' ||
          p.startsWith('/.git/') || p.startsWith('/.wrangler/') || p.startsWith('/node_modules/') ||
          p === '/package.json' || p === '/package-lock.json' || p === '/gen_flow.cjs' || p.endsWith('.md') ||
          p === '/wrangler.toml' || p === '/robots.txt' || p === '/sitemap.xml') {
        return await applySecurityHeaders(new Response('Not Found', { status: 404 }), p);
      }
      return await applySecurityHeaders(env.ASSETS.fetch(request), p);
    }

    // 首次请求时初始化数据库（业务库 + 可选独立留档库 + 可选独立合同台账库）。
    // Promise 挂载防并发双跑（网安报告 F-09）：initDb 内部是多个 await 序列，布尔标志存在空窗，
    // 两个并发请求会同时重跑 RENAME/重建类迁移（messages/6 表重建），其中一个必 500；
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
    let body = {};
    if (request.method === 'POST' || request.method === 'PUT' || request.method === 'DELETE') {
      // JSON 体积炸弹防护：Content-Length 廉价短路 + 流式硬上限双保险。
      // 仅看 Content-Length 会被 chunked 传输（无 CL 头）绕过 → 改用 reader 累积到上限+1 即 413，
      // 不信任 header，避免攻击者用大 body 耗内存 / 在解析后限流之前打满
      const BODY_LIMIT = 1100000;
      const cl = parseInt(request.headers.get('Content-Length') || '0', 10);
      if (cl > BODY_LIMIT) return await applySecurityHeaders(error(MSG.PAYLOAD_TOO_LARGE, 413), p);
      try {
        const reader = request.body && request.body.getReader();
        if (!reader) { body = await request.json(); }
        else {
          const chunks = []; let n = 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            n += value.byteLength;
            if (n > BODY_LIMIT) { try { reader.cancel(); } catch { /* ignore */ } throw new Error('PAYLOAD_TOO_LARGE'); }
            chunks.push(value);
          }
          const text = new TextDecoder().decode(await new Blob(chunks).arrayBuffer());
          body = text ? JSON.parse(text) : {};
        }
      } catch (e) {
        if (String(e && e.message) === 'PAYLOAD_TOO_LARGE') return await applySecurityHeaders(error(MSG.PAYLOAD_TOO_LARGE, 413), p);
        body = {}; // 其余解析失败（含非法 JSON）兜底空对象，交由路由校验
      }
    }

    // 限流闸门（IP 取 CF-Connecting-IP；超限一律 429，细节不回显；db 供低频键 D1 持久化）
    const ip = request.headers.get('CF-Connecting-IP') || 'anon';
    if (!(await rateGate(ip, p, request.method, body, Date.now(), db))) return await applySecurityHeaders(error(MSG.RATE_LIMITED, 429), p);

    try {
      const res = await routeApi(db, p, request.method, body, url, request);
      // 留档必须 await：workerd 在响应结束后掐断未完成的悬浮 Promise（加密咽喉链路较长，
      // 不 await 会导致留档被杀在途中——本批次线上 0 留档事故根因）
      await logRequest(db, { method: request.method, path: p, body, status: res.status, req: request });
      return await applySecurityHeaders(res, p);
    } catch (err) {
      console.error('API Error:', err); // 细节只留服务端日志
      await logRequest(db, { method: request.method, path: p, body, status: 500, req: request });
      return await applySecurityHeaders(error(MSG.SERVER_ERROR, 500), p); // 回显脱敏：不回传 err.message（防泄露表名/约束等内部信息）
    }
  },
};
