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
import { bindTextAuditEnv } from './server/text-audit.js';
import { handleRegister, handleLogin, handleCheckUsername, handleAuthMe, handleSaveAvatar, handleDeactivateAccount, handleGetUserPublic, handleListSessions, handleRevokeSession, handleLogout, handleReAuth, handleOtpRequest, handleBindPhone, handleBindEmail, handleUsernameStatus, handleChangeUsername, handleLoginWithCode, handleGetMyCreds, handleCheckInvite } from './server/routes-auth.js';
import { handleGetProfile, handleSaveProfile, handleGetTeachers, handleVerifyChsi, handleChsiStatus } from './server/routes-teacher.js';
import { handleGetPrivacySettings, handleSetPrivacySettings } from './server/routes-settings.js';
import {
  handleCreateDemand, handleGetDemands, handleUpdateDemand, handleDeleteDemand, handleReopenDemand,
  handleCreateIntent, handleGetIntents, handleResolveIntent,
  handlePushDemand, handleGetTeacherPushes, handleResolvePush,
} from './server/routes-demands.js';
import { handleGetNotifications, handleMarkNotificationRead, handleMarkAllNotificationsRead, handleAdminDeleteNotification } from './server/notify.js';
import {
  handleCreateContract, handleGetMyContracts,
  handleSignContract, handleModifyContract, handleCancelContract,
  handleAdminListContracts, handleAdminRemoveContract, handleVerifyContract, handleRevokeContract,
  initLedgerTable, bindLedgerDb,
} from './server/contract.js';
import { handleGetConversations, handleGetMessages, handleSendMessage, handleMarkRead, handleGetAttachment, handleGetConversationBindableDemands, handleCreateUpload, handleDeleteUpload } from './server/routes-chat.js';
import { handleCreateReview, handleGetReviews, handleUpdateReview } from './server/routes-reviews.js';
import {
  handleGenInvite, handleListInvites, handleRevokeInvite, handleAdminStats, handleAdminTraffic,
  handleListVerifications, handleVerificationAction,
  handleAdminReviews, handleReviewAction, handleAdminUsers, handleBanUser,
  handleAdminDemands, handleAdminDeleteDemand, handleAdminDeleteReview, handleAdminLogs, handleAdminDecryptLog, handleAdminBroadcast,
  handleCreateFeedback, handleAdminFeedbacks, handleMyFeedbacks, handleResolveFeedback, handleAdminDeleteMessage, handleVerifyTeacher,
} from './server/routes-admin.js';
import { handleListPosts, handleCreatePost, handleToggleLike, handleDeletePost, handleMyFavorites, handleToggleFavorite } from './server/routes-posts.js';
import {
  handleCreateComplaint, handleMyComplaints, handleComplaintCandidates, handleComplaintRecent,
  handleAdminComplaints, handleResolveComplaint, handleComplaintAttachment,
} from './server/routes-complaints.js';
import { handleGetDataVersion, versionDomainOf, bumpVersions } from './server/version.js';
import { handleCreateSigning, handleRespondSigning } from './server/signing.js';
import { handleCreateAward, handleGetAwards, handleDeleteAward, handleAdminAwards, handleAdminAwardAction, handleAdminAwardProof } from './server/awards.js'; // v1.0 R2：教师荣誉奖项（奖状上传+管理员人工审核）
import { handleAdminContent, handleContentAction } from './server/routes-audit.js'; // v0.26.0 D：统一内容审核/管理
import { auditBeforeWrite } from './server/audit-flow.js'; // v0.26.0 E：高频轻量日常审核断点
import { ASSET_MANIFEST } from './manifest.js'; // #169A 内容哈希资产清单（push 前 node hash-assets.mjs 重新生成）

// ============ 内容哈希虚拟版本化（v0.25.76 #169A）============
// 设计：不提交哈希副本、不改写 index.html 源码——由 worker 服务时把资产引用改写成哈希名
// （浏览器只请求哈希 URL），版本化 URL 经 manifest 校验后路由回 base 文件并回 immutable 缓存头。
// 内容变 → 哈希变 → 新 URL；index.html no-cache 每次导航重验 → 零陈旧；base 名永不 immutable
// （不是 manifest 放行的版本化 URL 一律拿不到 immutable）。manifest 由 node hash-assets.mjs
// 生成（与 app-shell.js DOMAIN_FILES 同步），测试依旧读源码 base 名，零测试改动。

// 校验路径是否为 manifest 中的版本化资产 URL（/app-chat.<hash8>.js），是则回 base 名
export function versionedBase(p) {
  const m = p.match(/^\/([a-zA-Z0-9._-]+)\.([0-9a-f]{8})\.(js|css)$/);
  if (!m) return null;
  const base = m[1] + '.' + m[3];
  const hashed = m[1] + '.' + m[2] + '.' + m[3];
  return ASSET_MANIFEST.files[base] === hashed ? base : null;
}

// #260（v0.25.102）：空响应毒化缓存防护——哈希 URL 永不失效，一个 200 空 body 的缓存条目会永久毒化该资产。
// 实证：部署滚动窗口曾把空 glass.css 写进 Cache API，生产 glass.9381f43f.css 恒 0 字节、玻璃引擎整体失效
// （base 路径/带 query 均 40172 字节，唯无 query 哈希 URL 命中空缓存）。规则：content-length 为 0 或缺失
// （无法证明非空）的响应既不出缓存也不进缓存。
function cacheableAsset(res) {
  const cl = res.headers.get('content-length');
  return cl !== null && Number(cl) > 0;
}

// 改写 HTML 文档：资产引用 → 哈希名 + 内联 manifest（懒加载器读 window.ASSET_MANIFEST.files）
export function injectManifest(html) {
  const files = ASSET_MANIFEST.files;
  const out = html.replace(/(src|href)="\/([a-zA-Z0-9._-]+\.(?:js|css))"/g, (m, attr, base) => `${attr}="/${files[base] || base}"`);
  return out.replace('</head>', `<script>window.ASSET_MANIFEST=${JSON.stringify(ASSET_MANIFEST)};</script></head>`);
}

// 改写后 HTML 的弱 ETag（改写 body 的哈希前 16 hex）——worker 必须自持 HTML 的 ETag：
// 存储的 index.html 在"只改资产不动页面"的发版里字节不变，若沿用 ASSETS 的原 ETag，
// 重验请求会命中旧 ETag 得 304，浏览器继续用上一版哈希引用 → 新部署下旧哈希 404（审计发现）。
const etagOf = out =>
  crypto.subtle.digest('SHA-256', new TextEncoder().encode(out))
    .then(d => '"' + [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16) + '"');

const CONDITIONAL = new Set(['if-none-match', 'if-modified-since', 'if-match', 'if-unmodified-since']);

// 服务 HTML：改写资产引用 + 内联 manifest；用自身 ETag 驱动 304（index.html no-cache 每次导航重验）
async function serveHtml(request, env, p, res) {
  const strip = new Headers(request.headers);
  for (const k of CONDITIONAL) strip.delete(k);
  const htmlReq = new Request(request.url, { method: request.method, headers: strip });
  const stored = res.ok ? res : await env.ASSETS.fetch(htmlReq); // res 304 时回退无条件重取
  if (!stored.ok) return applySecurityHeaders(stored, p);
  const out = injectManifest(await stored.text());
  const etag = await etagOf(out);
  if (request.headers.get('if-none-match') === etag) {
    return applySecurityHeaders(new Response(null, { status: 304, headers: { ETag: etag } }), p);
  }
  const headers = new Headers(stored.headers);
  headers.delete('Content-Length'); headers.delete('ETag'); headers.delete('Last-Modified');
  headers.set('ETag', etag);
  return applySecurityHeaders(new Response(out, { status: 200, headers }), p);
}

// API 分发：纯路由，无副作用（留档在 fetch 层统一包裹）。
// :id 路径统一经 idMatch 抽取（正则只写一次，杜绝 approve/reject 双 match 旧写法）
function idMatch(p, pattern) {
  const m = p.match(pattern);
  return m ? parseInt(m[1], 10) : null;
}

export async function routeApi(db, p, method, body, url, req, env) { // 导出供测试穿透路由接线（2026-08-09 审计：曾因 idMatch 下标残留致单条已读恒 400 而单测未覆盖）
  // 认证
  if (p === '/api/auth/register' && method === 'POST') return await handleRegister(db, body, req);
  if (p === '/api/auth/login' && method === 'POST') return await handleLogin(db, body, req);
  if (p === '/api/auth/check' && method === 'GET') return await handleCheckUsername(db, url);
  if (p === '/api/auth/me' && method === 'GET') return await handleAuthMe(db, req);
  if (p === '/api/auth/re-auth' && method === 'POST') return await handleReAuth(db, body, req);
  // v0.26.0 验证码/凭证（A3/A5/A6/A7）
  if (p === '/api/auth/otp/request' && method === 'POST') return await handleOtpRequest(db, body, req);
  if (p === '/api/auth/phone/bind' && method === 'POST') return await handleBindPhone(db, body, req);
  if (p === '/api/auth/email/bind' && method === 'POST') return await handleBindEmail(db, body, req);
  if (p === '/api/auth/login/code' && method === 'POST') return await handleLoginWithCode(db, body, req);
  if (p === '/api/user/username' && method === 'POST') return await handleChangeUsername(db, body, req);
  if (p === '/api/user/username/status' && method === 'GET') return await handleUsernameStatus(db, req);
  if (p === '/api/user/creds' && method === 'GET') return await handleGetMyCreds(db, req);
  if (p === '/api/auth/check-invite' && method === 'POST') return await handleCheckInvite(db, body); // v1.2.0 T5：教师注册第一步邀请码预校验（只验证不消费）
  if (p === '/api/auth/logout' && method === 'POST') return await handleLogout(db, req);
  if (p === '/api/auth/sessions' && method === 'GET') return await handleListSessions(db, req);
  if (p === '/api/auth/sessions/revoke' && method === 'POST') return await handleRevokeSession(db, body, req);
  if (p === '/api/user/avatar' && method === 'POST') return await handleSaveAvatar(db, body, req);
  if (p === '/api/user/deactivate' && method === 'POST') return await handleDeactivateAccount(db, body, req);
  const userPublic = idMatch(p, /^\/api\/users\/(\d+)$/);
  if (userPublic && method === 'GET') return await handleGetUserPublic(db, userPublic);

  // 管理员
  if (p === '/api/admin/invite' && method === 'POST') return await handleGenInvite(db, body, req);
  if (p === '/api/admin/invites' && method === 'GET') return await handleListInvites(db, req); // v1.2.0 T4：邀请码管理列表
  const inviteRevoke = idMatch(p, /^\/api\/admin\/invites\/([A-Za-z0-9]+)$/);
  if (inviteRevoke && method === 'DELETE') return await handleRevokeInvite(db, inviteRevoke, req); // v1.2.0 T4：作废未用码
  if (p === '/api/admin/verifications' && method === 'GET') return await handleListVerifications(db, url, req); // v1.2.0 T6：学信网核验队列
  const verifAction = idMatch(p, /^\/api\/admin\/verifications\/(\d+)\/action$/);
  if (verifAction && method === 'POST') return await handleVerificationAction(db, verifAction, body, req); // v1.2.0 T6：通过/拒绝+结构化录入
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
  if (p === '/api/feedbacks/mine' && method === 'GET') return await handleMyFeedbacks(db, req); // #165：我的反馈/投诉
  if (p === '/api/feedbacks' && method === 'GET') return await handleAdminFeedbacks(db, url, req);
  const feedbackResolve = idMatch(p, /^\/api\/feedbacks\/(\d+)\/resolve$/);
  if (feedbackResolve && method === 'POST') return await handleResolveFeedback(db, feedbackResolve, body, req);
  // R22：投诉独立通道（与反馈分表分通道；候选搜索/最近交互/我的投诉/管理员处理）
  if (p === '/api/complaints' && method === 'POST') return await handleCreateComplaint(db, body, req);
  if (p === '/api/complaints/mine' && method === 'GET') return await handleMyComplaints(db, req);
  if (p === '/api/complaints/candidates' && method === 'GET') return await handleComplaintCandidates(db, url, req);
  if (p === '/api/complaints/recent' && method === 'GET') return await handleComplaintRecent(db, url, req);
  if (p === '/api/complaints' && method === 'GET') return await handleAdminComplaints(db, url, req);
  const complaintResolve = idMatch(p, /^\/api\/complaints\/(\d+)\/resolve$/);
  if (complaintResolve && method === 'POST') return await handleResolveComplaint(db, complaintResolve, req);
  const complaintAttach = idMatch(p, /^\/api\/complaints\/(\d+)\/attachment$/); // U11：投诉附件懒加载
  if (complaintAttach && method === 'GET') return await handleComplaintAttachment(db, complaintAttach, url, req);
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
  if (p === '/api/privacy-settings' && method === 'GET') return await handleGetPrivacySettings(db, req);
  if (p === '/api/privacy-settings' && method === 'POST') return await handleSetPrivacySettings(db, body, req);
  if (p === '/api/teacher/profile' && method === 'GET') return await handleGetProfile(db, url, req);
  if (p === '/api/teacher/profile' && method === 'POST') return await handleSaveProfile(db, body, req);
  if (p === '/api/teacher/verify-chsi' && method === 'POST') return await handleVerifyChsi(db, body, req); // v1.2.0 T3：学信网验证码核验
  if (p === '/api/teacher/verify-status' && method === 'GET') return await handleChsiStatus(db, req); // v1.2.0 T5：核验状态
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
  if (p === '/api/notifications/read-all' && method === 'POST') return await handleMarkAllNotificationsRead(db, req); // 2026-08-09 反馈：离开通知页批量已读
  const notifRead = idMatch(p, /^\/api\/notifications\/(\d+)\/read$/); // #151 单条已读（取代批量全读）
  if (notifRead && method === 'POST') return await handleMarkNotificationRead(db, notifRead, req); // 2026-08-09 审计：#151 曾误传 notifRead[1]（idMatch 已返回数字，取下标恒 undefined → 恒 400，单条已读线上失效）
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

  // 发起签约（v0.24.0 极简签约流：加号栏「发起签约」→ 会话内签约请求气泡 → 对方确认/拒绝）
  const convSigning = idMatch(p, /^\/api\/conversations\/(\d+)\/signing$/);
  if (convSigning && method === 'POST') return await handleCreateSigning(db, { ...body, conversationId: convSigning }, req);
  const convBindableDemands = idMatch(p, /^\/api\/conversations\/(\d+)\/bindable-demands$/);
  if (convBindableDemands && method === 'GET') return await handleGetConversationBindableDemands(db, convBindableDemands, url, req);
  const signingRespond = idMatch(p, /^\/api\/signing-requests\/(\d+)\/respond$/);
  if (signingRespond && method === 'POST') return await handleRespondSigning(db, signingRespond, body, req);

  // 教师荣誉奖项（v1.0 R2：提交/列表/删除 + 管理员审核）
  if (p === '/api/teacher/awards' && method === 'POST') return await handleCreateAward(db, body, req);
  if (p === '/api/teacher/awards' && method === 'GET') return await handleGetAwards(db, url, req);
  const awardDelete = idMatch(p, /^\/api\/teacher\/awards\/(\d+)$/);
  if (awardDelete && method === 'DELETE') return await handleDeleteAward(db, awardDelete, body, req);
  if (p === '/api/admin/awards' && method === 'GET') return await handleAdminAwards(db, url, req);
  const awardProof = idMatch(p, /^\/api\/admin\/awards\/(\d+)\/proof$/);
  if (awardProof && method === 'GET') return await handleAdminAwardProof(db, awardProof, req);
  const awardAction = idMatch(p, /^\/api\/admin\/awards\/(\d+)\/action$/);
  if (awardAction && method === 'POST') return await handleAdminAwardAction(db, awardAction, body, req);

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
  if (p === '/api/posts/favorites/mine' && method === 'GET') return await handleMyFavorites(db, req); // R23 我的收藏
  const postFav = idMatch(p, /^\/api\/posts\/(\d+)\/favorite$/);
  if (postFav && method === 'POST') return await handleToggleFavorite(db, postFav, body, req);
  const postLike = idMatch(p, /^\/api\/posts\/(\d+)\/like$/);
  if (postLike && method === 'POST') return await handleToggleLike(db, postLike, body, req);
  const postById = idMatch(p, /^\/api\/posts\/(\d+)$/);
  if (postById && method === 'DELETE') return await handleDeletePost(db, postById, body, req);

  // v0.26.0 D：统一内容审核/管理（D1 提取 + D2 处罚）
  if (p === '/api/admin/content' && method === 'GET') return await handleAdminContent(db, url, req);
  const contentAction = p.match(/^\/api\/admin\/content\/([a-z]+)\/(\d+)\/action$/);
  if (contentAction && method === 'POST') return await handleContentAction(db, contentAction[1], parseInt(contentAction[2], 10), body, req);

  // B2（v0.27.0 网络层重构）：批量只读端点（一次往返拉 N 个 GET；鉴权记忆化共享、边缘缓存复用）
  if (p === '/api/batch' && method === 'POST') return await handleBatch(db, body, url, req, env);

  // 健康检查
  if (p === '/api/health') return json({ status: 'ok', timestamp: new Date().toISOString() });

  // D1 保活（v0.25.16）：Pages 无原生 cron，由独立保活 Worker 的 cron 每 5 分钟打本端点，
  // 对业务/留档/台账三库 SELECT 1 保持唤醒（等效 scheduled handler 的保活逻辑）。纯读、无敏感数据。
  if (p === '/api/keepalive' && method === 'GET') {
    await keepD1Warm(env);
    return json({ status: 'ok' });
  }

  // 数据版本戳（v0.23.0 静默数据层）：客户端 8s 轮询探测；廉价单表读，无需鉴权（计数器无敏感性）
  if (p === '/api/data-version' && method === 'GET') return await handleGetDataVersion(db);

  return error('Not Found', 404);
}

// B6 公开列表边缘缓存（用户实测：游客 7s 出列表 / 教师列表 20s / 进模块拉表单 8s——D1 冷实例
// 偶发 ~6s 慢往返按 worker 实例隔离，keepalive 只热它所在实例，用户请求路由到其他实例仍冷）。
// 公开列表（教师 / 需求广场 / 帖子）命中边缘缓存零碰 D1，跨用户共享、冷实例也秒开。
// 一致性：TTL 30s 自愈（公开列表低频变更，发布/审核后 30s 内可见）。
// 【外部审查 1101 修】仅匿名请求参与缓存（无 X-Auth-Token）——登录用户请求的响应含 per-user
// 字段（posts.liked/favorited、teachers.matched、demands 观众变体），共享缓存跨用户下发即泄露；
// 访客请求无 per-user 数据，是冷启动缓存的目标受众。登录用户走实时 routeApi 保私有正确。
// 无 caches 环境（本地 dev / vm 测试）回落直取（fail-open，同加密咽喉内测兼容哲学）。
const PUBLIC_LIST_TTL_S = 30;
export function isAnonymous(request) {
  return !request.headers.get('X-Auth-Token');
}
export function isPublicListCacheable(p, url) {
  if (p === '/api/teachers') return true;                 // 教师列表（公开，含筛选 query 变体）
  if (p === '/api/posts') return true;                    // 资料广场（公开）
  if (p === '/api/student/demands' && !url.searchParams.has('scope')) return true; // 需求广场（无 scope=公开）
  return false;
}

// B2（v0.27.0 网络层重构）：公开列表边缘缓存读 helper——主请求路径与 /api/batch 子请求共用。
// 命中返回解析后的 JSON data（object），miss/读异常返回 null（fail-open 回落正常 handler，绝不 500）。
// 生产实证铁律（v0.26.9）：workerd Cache API 的 match 响应 body 流有锁定/不可重复读风险，
// 一律 text() 读一次重建 json，勿 clone/重复读原流。
async function readPublicListCache(url) {
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  if (!cache) return null;
  try {
    const cached = await cache.match(new Request(url));
    if (cached && cached.status === 200 && (cached.headers.get('content-type') || '').includes('application/json')) {
      const text = await cached.text();
      if (text) return JSON.parse(text);
    }
  } catch { /* 缓存读失败：回落正常 handler（不 500） */ }
  return null;
}

// B2 补（v0.27.0 审计）：公开列表边缘缓存写 helper——/api/batch 子请求 miss 后写回。
// 直接 await put（生产实证 waitUntil 异步写 → 紧随请求 miss）：text 极小毫秒级完成，
// 响应返回时缓存已就绪，下一个请求必命中。写失败静默（不影响主响应，fail-open）。
async function writePublicListCache(url, jsonText) {
  const apiCache = typeof caches !== 'undefined' ? caches.default : null;
  if (!apiCache) return;
  try {
    const headers = new Headers();
    headers.set('content-type', 'application/json; charset=UTF-8');
    headers.set('Cache-Control', `public, s-maxage=${PUBLIC_LIST_TTL_S}`);
    await apiCache.put(new Request(url), new Response(jsonText, { status: 200, headers }));
  } catch { /* 缓存写失败静默：不影响主响应 */ }
}

// B2（v0.27.0 网络层重构）：批量只读端点——一次鉴权 + N 个子 GET 并发。
// 设计（调研：API batching / BFF 聚合）：客户端 prefetch/域刷新/多模块首载把 N 个独立 GET
// 合并为 1 次往返——HTTP/1.1 下免浏览器 6 连接队列串行，HTTP/2 下减 worker 调用与 D1 往返；
// 子请求仍走 routeApi（复用公开列表边缘缓存 + 各 handler 校验）；authUser 经 B1 reqCtx 记忆化
// 共享 1 次 D1 鉴权；单子请求失败不阻断其余（结果带独立 status）。
// 写操作禁止入 batch——写路径仍走单请求，保证错误码/toast/二次认证/留档语义。
// 安全：子请求与直接 GET 权限面完全一致（不升级权限），batch 只省往返不改变路由语义。
// 批量读上限单源：constants.js CONFIG.BATCH_GET_MAX（前端 dhBatchGet 按同值分块，杜绝整批超限 400）
const BATCH_MAX = (globalThis.APP_CONSTANTS && globalThis.APP_CONSTANTS.CONFIG && globalThis.APP_CONSTANTS.CONFIG.BATCH_GET_MAX) || 16;
async function handleBatch(db, body, url, req, env) {
  const gets = body && Array.isArray(body.gets) ? body.gets : null;
  if (!gets || !gets.length || gets.length > BATCH_MAX) return error(MSG.INVALID_PARAMS, 400);
  const paths = gets.map(g => String(g));
  if (!paths.every(p => p.startsWith('/api/') && !/\s/.test(p) && p.length < 300)) {
    return error(MSG.INVALID_PARAMS, 400); // 只允许 /api/ 相对路径（防外域/协议相对/注入）
  }
  const results = await Promise.all(paths.map(async sub => {
    try {
      const subUrl = new URL(sub, url.origin);
      // 匿名公开列表子请求命中边缘缓存 → 零 D1 直返（与主请求路径同款）
      if (isAnonymous(req) && isPublicListCacheable(subUrl.pathname, subUrl)) {
        const hit = await readPublicListCache(subUrl);
        if (hit) return { path: sub, status: 200, data: hit };
      }
      const res = await routeApi(db, subUrl.pathname, 'GET', {}, subUrl, req, env);
      const data = await res.json();
      // B2 审计补：匿名公开列表 miss 子请求写回边缘缓存——否则访客预取全走批量时
      // 边缘缓存永不被预热（B6 冷启动收益被绕过），后续直连 GET 才温。await put 保响应返回即就绪。
      if (res.status === 200 && isAnonymous(req) && isPublicListCacheable(subUrl.pathname, subUrl)) {
        await writePublicListCache(subUrl, JSON.stringify(data));
      }
      return { path: sub, status: res.status, data };
    } catch {
      return { path: sub, status: 500, data: { error: MSG.SERVER_ERROR } };
    }
  }));
  return json({ results });
}

// D1 保活（v0.22.8 + v0.25.16 重构单点）：对业务/留档/台账三库轻查询 SELECT 1。
// v0.26.13 评估（D2，见 docs/backlog.md）：initDb schema 版本判断（v0.26.12）已把冷 isolate 首击
// 从 25s 降到 <1.7s，keepalive 原「首击唤醒」职责不再必要；保留为防极端空闲的保底保险
// （全部 isolate 回收 + D1 连接冷时首次查询仍多几百 ms）。调用方：① scheduled 事件——Pages 无
// 原生 cron 触发器，wrangler.toml [triggers] 对 Pages 不生效（2026 实测 API/CLI 均无法注册，见
// 会话），由独立保活 Worker（keepalive-worker/，wrangler cron 触发）打 /api/keepalive 代为唤醒；
// ② /api/keepalive 路由。保活失败静默，不影响主流程。
function keepD1Warm(env) {
  try {
    const ping = db => (db ? db.prepare('SELECT 1').run().catch(() => {}) : Promise.resolve());
    return Promise.all([ping(env.DB), ping(env.LOG_DB), ping(env.LEDGER_DB)]).catch(() => {});
  } catch { return Promise.resolve(); } // 绑定缺失/同步抛错全兜底：保活失败静默，绝不影响主流程
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
      // 路径遍历纵深防御（2026-08-09 审计 F-2）：点段一律 404——线上 CDN 边缘已拒（实测 400），
      // worker 侧再加一道，防未来边缘规范化行为变化后 server/ 源码泄露（p 此处已 decodeURIComponent）
      if (p.includes('..')) return applySecurityHeaders(new Response('Not Found', { status: 404 }), p);
      if (p.startsWith('/server/') || p.startsWith('/server') || p.startsWith('/docs/') ||
          p === '/secrets.js' ||
          p.startsWith('/.git/') || p.startsWith('/.wrangler/') || p.startsWith('/node_modules/') ||
          p === '/package.json' || p === '/package-lock.json' || p.endsWith('.md') ||
          p === '/wrangler.toml' || p === '/robots.txt' || p === '/sitemap.xml' ||
          p.startsWith('/.claude/') || p.startsWith('/.github/') || p === '/.claude' || p === '/.github') { // 本地配置/CI 目录不入静态面（网安审计）
        return applySecurityHeaders(new Response('Not Found', { status: 404 }), p);
      }
      // 版本化资产路由（#169A + v0.25.83 边缘缓存）：manifest 校验放行的哈希 URL → base 文件 + immutable。
      // 边缘缓存（Cache API）：内容哈希寻址的 URL 永不失效，可安全缓存到 Cloudflare 边缘——跨用户首访
      // 也命中（此前响应头虽 immutable，但 CDN 边缘不缓存 worker 响应，新用户首访仍回源）。本地 dev /
      // 无 caches 环境（测试）自动回落直取。
      const vBase = versionedBase(p);
      if (vBase) {
        const cache = typeof caches !== 'undefined' ? caches.default : null;
        if (cache) {
          const cached = await cache.match(new Request(url));
          // #260（v0.25.102）：命中空/无长度缓存不返回，直接回源覆盖（防历史毒化条目自愈）
          if (cached && cacheableAsset(cached)) return applySecurityHeaders(cached, p);
        }
        const res = await env.ASSETS.fetch(new Request(new URL(vBase, url), request));
        if (res.ok) {
          const headers = new Headers(res.headers);
          headers.set('Cache-Control', 'public, max-age=31536000, immutable');
          const out = new Response(res.body, { status: res.status, headers });
          // 空响应（content-length 0/缺失）不进缓存——哈希 URL 永不失效，空缓存会永久毒化生产
          if (cache && cacheableAsset(res)) ctx.waitUntil(cache.put(new Request(url), out.clone()));
          return applySecurityHeaders(out, p);
        }
        return applySecurityHeaders(new Response('Not Found', { status: 404 }), p);
      }
      // 版本化形态但不在当前 manifest（部署竞态里浏览器可能带旧哈希 URL 撞新版本）→ 404，
      // 绝不给 HTML 冒充脚本（SPA 回退会把 index.html 喂给 <script src>，报错且难排查）
      if (/^\/([a-zA-Z0-9._-]+)\.([0-9a-f]{8})\.(js|css)$/.test(p)) {
        return applySecurityHeaders(new Response('Not Found', { status: 404 }), p);
      }
      const res = await env.ASSETS.fetch(request);
      // HTML 文档（含 SPA 回退）：改写资产引用为哈希名 + 内联 manifest（懒加载器据此取哈希 URL）。
      // ETag 由 worker 自持（改写 body 哈希）——沿用 ASSETS 原 ETag 会在只改资产不发版页面的发版后误判 304。
      // 304 响应无 content-type：按路径推断（/、/index.html、SPA 无扩展名路由均为 HTML）
      const isHtml = res.ok
        ? (res.headers.get('content-type') || '').includes('text/html')
        : /\.html?$/i.test(p) || !/\.[a-zA-Z0-9]{1,6}$/.test(p);
      if (isHtml) return serveHtml(request, env, p, res);
      return applySecurityHeaders(res, p);
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
      bindTextAuditEnv(env); // 文本审核咽喉（text-audit）：语义层密钥经 Secrets 网关读取，fail-open
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
      // v0.26.0 E2 高频轻量日常审核断点：内容域写请求途中统一过监听断点（数据副本 + 上下文入队列 →
      // 审核节点）。v0.30.0（S2-1）起节点为门牌合规 L1 规则层（AUDIT_MAP 抽取自由文本字段交
      // auditFreeText），命中详细门牌号 → 400 reject。驳回文案走上传过程自身的 toast（api 调用方
      // catch 已 showToast(err.message) 原样弹出，无需额外 toast 通路）。≤300ms 预算 fail-open。
      const audit = await auditBeforeWrite({ path: p, method: request.method, body, ip, userId: null });
      if (audit.reject) {
        return applySecurityHeaders(error(audit.reject, 400), p);
      }
      // B6 公开列表边缘缓存：GET 公开列表命中缓存 → 零 D1 零留档直接返回（冷启动治本）；
      // miss 走正常 handler 后把响应写入边缘缓存（waitUntil 托管，30s TTL 自愈）。
      // 【命中读 text 重建，catch 回落 routeApi】：workerd Cache API 的 match 响应 body 流
      // 有锁定/不可重复读风险（生产实证 clone 后仍 500、durationMs 4ms）——改为 text() 读一次
      // 重建 json 响应；任何缓存读异常都回落正常 handler（绝不 500，fail-open）。
      const apiCache = typeof caches !== 'undefined' ? caches.default : null;
      // 匿名门（外部审查 1101）：仅访客请求参与公开列表缓存——登录请求含 per-user 字段，走实时
      const publicList = request.method === 'GET' && isAnonymous(request) && isPublicListCacheable(p, url);
      if (publicList && apiCache) {
        const cachedData = await readPublicListCache(url);
        if (cachedData) return applySecurityHeaders(json(cachedData), p);
      }
      const res = await routeApi(db, p, request.method, body, url, request, env); // env 供保活等需多绑定端点
      if (publicList && apiCache && res.status === 200) {
        let text = null;
        try {
          text = await res.text(); // 读一次消费 body（下面用 text 重建返回，避免二次读原流）
          const headers = new Headers(res.headers);
          headers.set('Cache-Control', `public, s-maxage=${PUBLIC_LIST_TTL_S}`);
          // 直接 await put（不用 ctx.waitUntil fire-and-forget）：text 极小毫秒级完成，且保证
          // 响应返回时缓存已就绪——下一个请求必命中；生产实证 waitUntil 异步写导致响应先返回、
          // 紧随的请求 miss 走 D1（冷启动又现）
          await apiCache.put(new Request(url), new Response(text, { status: res.status, headers }));
        } catch { /* 缓存写失败静默：text 保持 null 走原 res */ }
        if (text !== null) {
          try { return applySecurityHeaders(json(JSON.parse(text)), p); } catch { /* 文本异常：回落原 res */ }
        }
      }
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
      // 留档改 ctx.waitUntil 托管（U10 v0.25.106）：响应路径不再等待留档写库——每写请求省 1 次 D1 往返
      // （登录 6.4s→~4.4s，网络层架构债专项第一步）。workerd 的 ctx.waitUntil 是官方保活通道，
      // 保证留档完成（非悬浮 Promise；历史 0 留档事故是裸 await 后响应结束被掐断，waitUntil 正确托管，
      // _worker 已用于 bumpVersions 同款）。logRequest 内部吞错，留档失败绝不阻断响应。
      // logRequest 兼作本请求全部留档的统一落库点（B4：业务 logEvent 队列 + 本条访问留档一次 batch）
      ctx.waitUntil(logRequest(db, { method: request.method, path: p, body, status: res.status, req: request, durationMs: Date.now() - t0 }));
      return applySecurityHeaders(res, p);
    } catch (err) {
      console.error('API Error:', err); // 细节只留服务端日志
      await logRequest(db, { method: request.method, path: p, body, status: 500, req: request, durationMs: Date.now() - t0 });
      return applySecurityHeaders(error(MSG.SERVER_ERROR, 500), p); // 回显脱敏：不回传 err.message
    }
  },
  // D1 保活（v0.22.8 + v0.25.16）：逻辑收敛到 keepD1Warm 单点（与 /api/keepalive 路由共用）。
  // Pages 无原生 cron 触发，本 handler 实际由独立保活 Worker 的 cron 打 /api/keepalive 代为驱动；
  // 保留 scheduled 入口以兼容未来 Workers 直部署场景。
  async scheduled(event, env, ctx) {
    await keepD1Warm(env);
  },
};
