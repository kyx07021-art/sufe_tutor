/**
 * admin 域 API（V-1-4c 实体迁入：server/routes-admin.js + server/routes-audit.js）。
 * 邀请码 / 统计 / 用户管理 / 需求管理 / 聊天管理 / 日志检索 / 广播 / 密钥轮换 / 统一内容审核。
 * 评价审核在 reviews/api.js；教师认证审核在 teacher/api.js；反馈工单在 complaints/api.js。
 * 管理员敏感操作一律发语义日志 admin.*（封禁、删除、审核、发码）。
 * 守卫统一走 requireAdmin（security.requireUser role='admin' 别名）。
 */
import { json, error, errorMsg, genCode, toDbTime } from '../../core/util.js';
import { requireAdmin } from '../../core/security.js';
import { MSG } from '../../../shared/codes.js';
import { LIMITS } from '../../../shared/config.js';
import {
  dbCreateInviteCode, dbListInviteCodes, dbRevokeInviteCode,
  dbGetUserStats, dbGetCount, dbGetCountWhere, dbGetReviewStats, dbGetInviteStats,
  dbGetRecentUsers, dbGetRecentDemands,
  dbGetDemandById, dbAdminForceDeleteDemand, dbDeleteMessage,
  dbGetStudentUsersAdmin, dbGetTeachers, dbGetUserById, dbSetUserBanned, dbSearchUsersByRole,
  dbGetDemands, dbGetMessageById,
  dbGetAllContentAdmin, dbGetPostById, dbGetReviewById, dbGetFeedbackById, dbGetComplaintById,
  dbGetUpload, dbGetTeacherProfile, dbGetContractById, dbGetSigningById,
  dbDeletePost, dbDeleteReview, dbDeleteFeedback, dbDeleteComplaint, dbDeleteUpload,
  dbDeleteContract, dbDeleteSigning,
} from '../../../../server/db.js';
import { logEvent, queryLog, decryptLogEntry, dbGetTrafficBuckets } from '../../core/log.js';
import { confirmDangerOtp } from '../../core/danger-ops.js'; // 封禁/解封危险操作二次认证（同注销/签约口径）
import { reencryptChunk } from '../../../../server/reencrypt.js'; // v1.5.0 密钥轮换重加密（危险操作，capToken 门禁；A-12 分片续跑）
import { getDashboardMetrics } from '../../../../server/telemetry.js'; // v1.5.0 观测 dashboard 数据
import { dbBroadcastNotification, notifyUser } from '../../core/notify.js';

// 邀请码有效期：一次性凭证 TTL 单源（constants.SECURITY.ONE_TIME_TTL_MS，与 capToken 同 5 分钟）
export async function handleGenInvite(db, body, req) {
  const { admin, err } = await requireAdmin(db, req);
  if (err) return err;

  // v1.2.0 T4：邀请码无过期时间（去掉 expiresAt 参数），一人使用并成功注册后失效
  const code = genCode(LIMITS.INVITE_CODE_LEN);
  await dbCreateInviteCode(db, code, admin.id);
  await logEvent(db, { action: 'admin.invite.create', actorUserId: admin.id, actorUsername: admin.username,
    actorRole: 'admin', entity: 'invite', entityId: code, detail: {}, req });
  return json({ code });
}

// v1.2.0 T4：邀请码管理模块——列表（含状态/使用者）
export async function handleListInvites(db, req) {
  const { err } = await requireAdmin(db, req);
  if (err) return err;
  const invites = await dbListInviteCodes(db) || [];
  return json({ invites });
}

// v1.2.0 T4：作废未使用邀请码（已使用不可作废）
export async function handleRevokeInvite(db, code, req) {
  const { admin, err } = await requireAdmin(db, req);
  if (err) return err;
  const ok = await dbRevokeInviteCode(db, code);
  if (!ok) return errorMsg('INVITE_INVALID', 404);
  await logEvent(db, { action: 'admin.invite.revoke', actorUserId: admin.id, actorUsername: admin.username,
    actorRole: 'admin', entity: 'invite', entityId: code, detail: {}, req });
  return json({ ok: true });
}

export async function handleAdminStats(db, url, req) {
  const { err } = await requireAdmin(db, req);
  if (err) return err;

  const users = await dbGetUserStats(db) || { total:0, students:0, teachers:0 };
  const profiles = await dbGetCount(db, 'teacher_profiles');
  const demands = await dbGetCount(db, 'student_demands');
  const reviews = await dbGetReviewStats(db) || { total:0, approved:0, pending:0, rejected:0 };
  const invites = await dbGetInviteStats(db) || { total:0, used:0, active:0 };
  const recentUsers = await dbGetRecentUsers(db);
  const recentDemands = await dbGetRecentDemands(db);
  // 待办计数（管理员今日必办：待审核项 + 未处理反馈/投诉）
  const awardsPending = await dbGetCountWhere(db, 'teacher_awards', "status='pending'");
  const feedbacksOpen = await dbGetCountWhere(db, 'feedbacks', "status='open'");
  const complaintsOpen = await dbGetCountWhere(db, 'complaints', "status='open'");

  return json({
    stats: { users, profiles, demands, reviews, invites, recentUsers, recentDemands,
      todo: { awardsPending, feedbacksOpen, complaintsOpen } }
  });
}

// v1.5.0 管理端 dashboard：一次返回待办 + 观测指标（KPI/趋势/状态分布/热点路径）。
export async function handleAdminDashboard(db, url, req) {
  const { err } = await requireAdmin(db, req);
  if (err) return err;
  const hours = Math.min(24 * 7, Math.max(1, parseInt(url.searchParams.get('hours')) || 24));
  const [users, reviews, metrics] = await Promise.all([
    dbGetUserStats(db),
    dbGetReviewStats(db),
    getDashboardMetrics(db, hours),
  ]);
  const todo = {
    verificationsPending: await dbGetCountWhere(db, 'teacher_verifications', "status='pending'"),
    reviewsPending: reviews ? Number(reviews.pending || 0) : 0,
    awardsPending: await dbGetCountWhere(db, 'teacher_awards', "status='pending'"),
    feedbacksOpen: await dbGetCountWhere(db, 'feedbacks', "status='open'"),
    complaintsOpen: await dbGetCountWhere(db, 'complaints', "status='open'"),
  };
  return json({ dashboard: {
    hours,
    counts: { users, reviews, demands: await dbGetCount(db, 'student_demands'), teachers: await dbGetCount(db, 'teacher_profiles') },
    todo,
    metrics,
  } });
}

// 流量监测：站点总流量 + 平均延迟。
// 口径：activity_log 中 http.* 访问留档 = 服务端实际处理的请求；流量 = 每桶请求数；
// 平均延迟 = AVG(duration_ms)（历史桶为 null）。范围白名单 24h/7d/30d，空桶补零。
export async function handleAdminTraffic(db, url, req) {
  const { err } = await requireAdmin(db, req);
  if (err) return err;
  const range = ['24h', '7d', '30d'].includes(String(url.searchParams.get('range') || '')) ? url.searchParams.get('range') : '24h';
  const unit = range === '24h' ? 'hour' : 'day';
  const n = range === '24h' ? 24 : range === '7d' ? 7 : 30;
  const now = new Date();
  // 从整点/整天边界起算 n 个完整桶（首桶不满的截断不出现）
  const from = unit === 'hour'
    ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours() - (n - 1)))
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (n - 1)));
  const fromTs = toDbTime(from);
  const rows = await dbGetTrafficBuckets(db, unit, fromTs);
  const map = new Map(rows.map(r => [r.bucket, r]));
  const step = unit === 'hour' ? 3600 * 1000 : 24 * 3600 * 1000;
  const buckets = [];
  for (let i = 0; i < n; i++) {
    const t = from.getTime() + i * step;
    const label = fmtTrafficBucket(t, unit);
    const row = map.get(label);
    buckets.push({ label, requests: row ? Number(row.requests) : 0, avgMs: row && row.avg_ms != null ? Number(row.avg_ms) : null });
  }
  return json({ range, unit, buckets });
}
// 与 SQL strftime 输出同格式（UTC，'YYYY-MM-DD HH:00' / 'YYYY-MM-DD'）
const fmtTrafficBucket = (t, unit) => {
  const d = new Date(t);
  const p = x => String(x).padStart(2, '0');
  const day = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  return unit === 'hour' ? `${day} ${p(d.getUTCHours())}:00` : day;
};

export async function handleAdminUsers(db, url, req) {
  const { err } = await requireAdmin(db, req);
  if (err) return err;
  const role = url.searchParams.get('role');
  if (!['student', 'teacher'].includes(role)) return errorMsg('INVALID_ROLE');
  // 用户名搜索（q 可选）：LIKE 转义在数据层单点（dbSearchUsersByRole 同口径），管理员效率入口
  const q = String(url.searchParams.get('q') || '').trim();
  if (q) return json({ users: await dbSearchUsersByRole(db, role, q, 0, LIMITS.ADMIN_SEARCH_MAX) });

  const users = role === 'student'
    ? await dbGetStudentUsersAdmin(db)
    : await dbGetTeachers(db, { adminView: true });
  return json({ users });
}

export async function handleBanUser(db, userId, body, req) {
  const { admin, err } = await requireAdmin(db, req);
  if (err) return err;
  const target = await dbGetUserById(db, userId);
  if (!target) return errorMsg('USER_NOT_FOUND', 404);
  if (target.role === 'admin') return errorMsg('NO_PERMISSION', 403);
  // 封禁/解封 = 危险操作（同注销/签约口径），须 capToken 二次认证：管理员令牌被复用/泄露时封禁一击无效
  if (!(await confirmDangerOtp(db, req, body))) return errorMsg('REAUTH_FAILED', 403);

  const banned = body.banned ? 1 : 0;
  await dbSetUserBanned(db, userId, banned);
  await logEvent(db, { action: banned ? 'admin.ban' : 'admin.unban', actorUserId: admin.id,
    actorUsername: admin.username, actorRole: 'admin', entity: 'user', entityId: userId,
    detail: { targetUsername: target.username, targetRole: target.role, banned }, req });
  return json({ message: banned ? MSG.BANNED : MSG.UNBANNED, banned });
}

// GET /api/admin/demands —— 管理员全量需求（含已签约；广场端点恒定排除 contracted，管理员页需独立全量端点）
export async function handleAdminDemands(db, url, req) {
  const { err } = await requireAdmin(db, req);
  if (err) return err;
  // 网安报告 F-09：keyset 游标分页（db.js），返回 { demands, nextCursor }，前端 nextCursor 翻页
  return json(await dbGetDemands(db, { admin: true, cursor: url.searchParams.get('cursor') || null }));
}

export async function handleAdminDeleteDemand(db, demandId, body, req) {
  const { admin, err } = await requireAdmin(db, req);
  if (err) return err;
  const existing = await dbGetDemandById(db, demandId);
  if (!existing) return errorMsg('DEMAND_NOT_FOUND', 404);
  // 管理员可删全部需求（含已签约 contracted）；
  // 数据层 dbAdminForceDeleteDemand 同事务清 contracts/signing_requests 的 demand_id 引用再删需求，
  // F-03b 悬空不变量照守（常规非管理员路径仍走 dbDeleteDemand 的原子门禁）。
  const ok = await dbAdminForceDeleteDemand(db, demandId);
  if (!ok) return errorMsg('DEMAND_NOT_FOUND', 409); // 行已被并发删除等
  await logEvent(db, { action: 'admin.demand.delete', actorUserId: admin.id, actorUsername: admin.username,
    actorRole: 'admin', entity: 'demand', entityId: demandId, req });
  return json({ message: MSG.DEMAND_DELETED });
}

// DELETE /api/admin/messages/:id —— 管理员删除单条聊天消息（留档 admin.message.delete；backoffice 接口）
export async function handleAdminDeleteMessage(db, messageId, body, req) {
  const { admin, err } = await requireAdmin(db, req);
  if (err) return err;
  const m = await dbGetMessageById(db, messageId);
  if (!m) return errorMsg('MESSAGE_NOT_FOUND', 404);
  await dbDeleteMessage(db, messageId);
  await logEvent(db, { action: 'admin.message.delete', actorUserId: admin.id, actorUsername: admin.username,
    actorRole: 'admin', entity: 'message', entityId: messageId,
    detail: { conversationId: m.conversation_id, senderUserId: m.sender_user_id, kind: m.kind }, req });
  return json({ ok: true });
}

// 日志检索（action 前缀 / 操作人 / 实体 / 时间范围 / detail 模糊 / 分页；backoffice 审计接口）
export async function handleAdminLogs(db, url, req) {
  const { err } = await requireAdmin(db, req);
  if (err) return err;
  const f = Object.fromEntries(url.searchParams);
  const result = await queryLog(db, f);
  return json(result);
}

// GET /api/admin/logs/:id/decrypt —— 单条留档显式解密（列表检索已透明解密，此为按 id 定点取原文）
export async function handleAdminDecryptLog(db, logId, req) {
  const { err } = await requireAdmin(db, req);
  if (err) return err;
  const entry = await decryptLogEntry(db, logId);
  if (!entry) return errorMsg('LOG_NOT_FOUND', 404);
  return json(entry);
}

// v1.5.0 密钥轮换：管理员经二次认证触发全库密文重加密。
// 契约：Worker Secrets 先同时配置新钥与 *_OLD 旧钥；成功后在发布层删除旧钥。无法解密的行只计数不覆盖。
// A-12 分片：D1 Free 单调用 50 次查询上限，全量逐行重加密必超限——单次调用只处理
// ≤REENCRYPT_ROW_BUDGET 行（reencryptChunk），body.cursor 透传续跑，done=true 才完成；
// capToken 一次性，客户端每轮续跑需重新 re-auth 签发（脚本续跑循环在 A-12-3 落地）。
export async function handleAdminReencrypt(db, body, req, env = null) {
  const { admin, err } = await requireAdmin(db, req);
  if (err) return err;
  if (!(await confirmDangerOtp(db, req, body))) return errorMsg('REAUTH_FAILED', 403);
  const cursor = (body && body.cursor) || null;
  const res = await reencryptChunk(db, cursor, env && env.LOG_DB); // 独立留档库一并重加密（N1 审计修复）
  await logEvent(db, { action: 'admin.crypto.reencrypt', actorUserId: admin.id, actorUsername: admin.username,
    actorRole: 'admin', entity: 'system', entityId: 0, detail: { cursor: cursor || null, done: !res.cursor, chunk: res.summary }, req });
  return json({ ok: true, done: !res.cursor, cursor: res.cursor,
    fields: res.summary.fields, attachments: res.summary.attachments, logs: res.summary.logs });
}

// 通知信息页「发通知」：管理员发送全体可见的系统公告（编辑器复用发帖组件：标题+正文，
// 推送时标题加【系统通知】前缀）
export async function handleAdminBroadcast(db, body, req) {
  const { admin, err } = await requireAdmin(db, req);
  if (err) return err;
  // 广播影响全站用户 = 最高危管理操作，须 capToken 二次认证（同封禁/处罚口径）
  if (!(await confirmDangerOtp(db, req, body))) return errorMsg('REAUTH_FAILED', 403);
  const title = String(body.title || '').trim();
  const text = String(body.text || '').trim();
  if (!text) return errorMsg('BROADCAST_EMPTY');
  // V-2-4 结构化：type=BROADCAST + params {title,text}，前缀拼装移交客户端渲染
  const count = await dbBroadcastNotification(db, title, text);
  await logEvent(db, { action: 'admin.notify.broadcast', actorUserId: admin.id, actorUsername: admin.username,
    actorRole: 'admin', entity: 'notification', entityId: 0, detail: { recipients: count, len: text.length }, req });
  return json({ ok: true, count });
}

// ============================================================
// D1/D2 统一内容审核（V-1-4c 从 server/routes-audit.js 迁入）
// ============================================================
const TYPE_LABEL = {
  post: '帖子', demand: '需求', teacher: '教师档案', review: '评价',
  message: '聊天消息', feedback: '反馈', complaint: '投诉', upload: '附件',
  contract: '合同', signing: '签约请求',
};

// 处罚通知三段截断预算（LIMITS.PENALTY_*_MAX 单源）：结构化 params 落库，客户端渲染总长 <200（v1 库层 200 字上限语义保留）

// GET /api/admin/content?type=post|demand|teacher|review|message|feedback|complaint|upload
export async function handleAdminContent(db, url, req) {
  const { admin, err } = await requireAdmin(db, req);
  if (err) return err;
  const type = url.searchParams.get('type') || null;
  const items = await dbGetAllContentAdmin(db, { type });
  await logEvent(db, { action: 'admin.content.list', actorUserId: admin.id, actorUsername: admin.username,
    actorRole: 'admin', entity: 'content', detail: { type: type || 'all', count: items.length }, req });
  return json({ items });
}

// POST /api/admin/content/:type/:id/action { action, reason, rule }
export async function handleContentAction(db, type, id, body, req) {
  const { admin, err } = await requireAdmin(db, req);
  if (err) return err;
  const action = body.action;
  // 三段截断预算：reason/rule/summary 分预算，总长钉在渲染预算内（单字段取满上限会组合超限被 v1 库层截断丢内容，故分字段各取上限）
  const reason = String(body.reason || '').trim().slice(0, LIMITS.PENALTY_REASON_MAX);
  const rule = String(body.rule || '').trim().slice(0, LIMITS.PENALTY_RULE_MAX);
  if (!['delete', 'remove', 'ban'].includes(action)) return errorMsg('INVALID_PARAMS');
  if (!reason) return errorMsg('PENALTY_REASON_REQUIRED');
  // teacher 档案无硬删分支（doDeleteContent 跳过）——API 直发 delete/remove 直接拒绝，
  // 防「no-op 却回成功 + 发'移除内容'通知」的误导文案（UI 层已只给封禁）
  if (type === 'teacher' && action !== 'ban') return errorMsg('INVALID_PARAMS');
  const label = TYPE_LABEL[type] || type;

  // 定位目标内容 + 作者（按类型取快照摘要，供处罚通知展示触发内容）
  let authorId = null, summary = '';
  switch (type) {
    case 'post': { const p = await dbGetPostById(db, id); if (!p) return errorMsg('POST_NOT_FOUND', 404); authorId = p.user_id; summary = `${p.title || ''} ${p.body_md || ''}`; break; }
    case 'demand': { const d = await dbGetDemandById(db, id); if (!d) return errorMsg('DEMAND_NOT_FOUND', 404); authorId = d.user_id; summary = String(d.additional_info || d.address || ''); break; }
    case 'teacher': { const t = await dbGetTeacherProfile(db, id); if (!t) return errorMsg('USER_NOT_FOUND', 404); authorId = id; summary = `${t.intro || ''} ${t.address || ''} ${t.school || ''}`; break; }
    case 'review': { const r = await dbGetReviewById(db, id); if (!r) return errorMsg('REVIEW_NOT_FOUND', 404); authorId = r.reviewer_user_id; summary = r.comment || ''; break; }
    case 'message': { const m = await dbGetMessageById(db, id); if (!m) return errorMsg('MESSAGE_NOT_FOUND', 404); authorId = m.sender_user_id; summary = m.body || m.name || ''; break; }
    case 'feedback': { const f = await dbGetFeedbackById(db, id); if (!f) return errorMsg('FEEDBACK_NOT_FOUND', 404); authorId = f.user_id; summary = `${f.title || ''} ${f.content || ''}`; break; }
    case 'complaint': { const c = await dbGetComplaintById(db, id); if (!c) return errorMsg('COMPLAINT_NOT_FOUND', 404); authorId = c.user_id; summary = `${c.reason || ''} ${c.detail || ''}`; break; }
    case 'upload': { const o = await dbGetUpload(db, id); if (!o) return errorMsg('INVALID_PARAMS', 404); authorId = o.user_id; summary = o.name || ''; break; }
    case 'contract': { const c = await dbGetContractById(db, id); if (!c) return errorMsg('CONTRACT_NOT_FOUND', 404); authorId = c.drafter_user_id; summary = `${c.plan || ''} ${c.schedule || ''}`; break; }
    case 'signing': { const s = await dbGetSigningById(db, id); if (!s) return errorMsg('CONTRACT_NOT_FOUND', 404); authorId = s.initiator_user_id; summary = `${s.price > 0 ? s.price + ' 元/时 ' : ''}${s.schedule || ''} ${s.method || ''}`; break; }
    default: return errorMsg('INVALID_PARAMS');
  }
  if (!authorId) return errorMsg('USER_NOT_FOUND', 404);
  const author = await dbGetUserById(db, authorId);
  const authorName = author ? author.username : `用户#${authorId}`;
  // 处罚 = 危险操作（删除/封禁不可逆），须 capToken 二次认证；且不得处罚管理员账户
  if (!(await confirmDangerOtp(db, req, body))) return errorMsg('REAUTH_FAILED', 403);
  if (author && author.role === 'admin') return errorMsg('NO_PERMISSION', 403);

  // 执行处罚（teacher 档案不硬删——ban 作者即可；其余类型删除/下架）
  if (type !== 'teacher' && (action === 'delete' || action === 'remove')) {
    await doDeleteContent(db, type, id);
  }
  if (action === 'ban') await dbSetUserBanned(db, authorId, 1);

  // 处罚后自动通知作者：V-2-4 结构化（label/rule/reason/summary/action 数据，文案客户端渲染）
  const summaryClip = String(summary || '').slice(0, LIMITS.PENALTY_SUMMARY_MAX);
  await notifyUser(db, authorId, 'CONTENT_PENALTY', {
    label, rule: rule || '', reason, summary: summaryClip, action,
  });

  await logEvent(db, { action: 'admin.content.action', actorUserId: admin.id, actorUsername: admin.username,
    actorRole: 'admin', entity: type, entityId: id,
    detail: { action, reason, rule, targetAuthor: authorName, targetUserId: authorId }, req });
  return json({ ok: true, message: MSG.CONTENT_ACTION_DONE });
}

/** 按类型删除内容（数据层 mapper 单点；teacher 无硬删分支） */
async function doDeleteContent(db, type, id) {
  switch (type) {
    case 'post': await dbDeletePost(db, id); break;
    case 'demand': await dbAdminForceDeleteDemand(db, id); break;
    case 'review': await dbDeleteReview(db, id); break;
    case 'message': await dbDeleteMessage(db, id); break;
    case 'feedback': await dbDeleteFeedback(db, id); break;
    case 'complaint': await dbDeleteComplaint(db, id); break;
    case 'upload': await dbDeleteUpload(db, id); break;
    case 'contract': await dbDeleteContract(db, id); break;
    case 'signing': await dbDeleteSigning(db, id); break;
  }
}

// ============================================================
// admin 域路由表（V-1-4c）
// ============================================================
const S = (method, path, handler) => ({ method, path, handler });
const n = v => parseInt(v, 10);
export const routes = [
  S('POST', '/api/admin/invite', c => handleGenInvite(c.db, c.body, c.req)),
  S('GET', '/api/admin/invites', c => handleListInvites(c.db, c.req)),
  S('DELETE', '/api/admin/invites/:code', c => handleRevokeInvite(c.db, c.params.code, c.req)),
  S('GET', '/api/admin/stats', c => handleAdminStats(c.db, c.url, c.req)),
  S('GET', '/api/admin/dashboard', c => handleAdminDashboard(c.db, c.url, c.req)),
  S('GET', '/api/admin/traffic', c => handleAdminTraffic(c.db, c.url, c.req)),
  S('GET', '/api/admin/logs', c => handleAdminLogs(c.db, c.url, c.req)),
  S('GET', '/api/admin/logs/:id/decrypt', c => handleAdminDecryptLog(c.db, n(c.params.id), c.req)),
  S('GET', '/api/admin/users', c => handleAdminUsers(c.db, c.url, c.req)),
  S('GET', '/api/admin/demands', c => handleAdminDemands(c.db, c.url, c.req)),
  S('DELETE', '/api/admin/demands/:id', c => handleAdminDeleteDemand(c.db, n(c.params.id), c.body, c.req)),
  S('POST', '/api/admin/users/:id/ban', c => handleBanUser(c.db, n(c.params.id), c.body, c.req)),
  S('DELETE', '/api/admin/messages/:id', c => handleAdminDeleteMessage(c.db, n(c.params.id), c.body, c.req)),
  S('POST', '/api/admin/reencrypt', c => handleAdminReencrypt(c.db, c.body, c.req, c.env)),
  S('POST', '/api/notifications/broadcast', c => handleAdminBroadcast(c.db, c.body, c.req)),
  S('GET', '/api/admin/content', c => handleAdminContent(c.db, c.url, c.req)),
  S('POST', '/api/admin/content/:type/:id/action', c => handleContentAction(c.db, c.params.type, n(c.params.id), c.body, c.req)),
];
