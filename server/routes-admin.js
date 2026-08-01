/**
 * 路由模块：管理员（邀请码 / 统计 / 用户管理 / 需求管理 / 评价审核 / 日志检索）
 * 管理员敏感操作一律发语义日志 admin.*（封禁、删除、审核、发码）
 */
import {
  json, error, requireAdminOrError, authUser, genCode,
  MSG, STATUS,
} from './core.js';
import {
  dbCreateInviteCode,
  dbGetUserStats, dbGetCount, dbGetReviewStats, dbGetInviteStats,
  dbGetRecentUsers, dbGetRecentDemands, dbGetReviewsAdmin, dbGetReviewById,
  dbUpdateReviewStatus, dbRecomputeTeacherRating,
  dbGetDemandById, dbDeleteDemand, dbDeleteReview, dbDeleteMessage,
  dbGetStudentUsersAdmin, dbGetTeacherUsersAdmin, dbGetUserById, dbSetUserBanned, dbSetTeacherVerified,
  dbGetAllDemandsAdmin, dbGetMessageById,
  dbCreateFeedback, dbGetFeedbacksAdmin, dbGetFeedbackById, dbResolveFeedback,
} from './db.js';
import { logEvent, queryLog, decryptLogEntry } from './log.js';
import '../constants.js'; // 用户可见文案统一走 globalThis.APP_CONSTANTS.UI
import { dbBroadcastNotification, notifyUser } from './notify.js';

// 邀请码有效期
const INVITE_VALIDITY_MS = 5 * 60 * 1000;

export async function handleGenInvite(db, body, req) {
  const admin = await authUser(db, req);
  const e = requireAdminOrError(admin);
  if (e) return e;

  const code = genCode(8);
  const exp = new Date(Date.now() + INVITE_VALIDITY_MS);
  const expiresAt = exp.toISOString();                       // 返前端：ISO 带 Z，new Date 解析无时区歧义
  const expiresAtDb = expiresAt.slice(0, 19).replace('T', ' '); // 入库：同 datetime('now','localtime') 格式（worker 上即 UTC），字符串比较才正确
  await dbCreateInviteCode(db, code, admin.id, expiresAtDb);
  await logEvent(db, { action: 'admin.invite.create', actorUserId: admin.id, actorUsername: admin.username,
    actorRole: 'admin', entity: 'invite', entityId: code, detail: { expiresAt }, req });
  return json({ code, expiresAt });
}

export async function handleAdminStats(db, url, req) {
  const e = requireAdminOrError(await authUser(db, req));
  if (e) return e;

  const users = await dbGetUserStats(db) || { total:0, students:0, teachers:0 };
  const profiles = await dbGetCount(db, 'teacher_profiles');
  const demands = await dbGetCount(db, 'student_demands');
  const reviews = await dbGetReviewStats(db) || { total:0, approved:0, pending:0, rejected:0 };
  const invites = await dbGetInviteStats(db) || { total:0, used:0, active:0 };
  const recentUsers = await dbGetRecentUsers(db);
  const recentDemands = await dbGetRecentDemands(db);

  return json({
    stats: { users, profiles, demands, reviews, invites, recentUsers, recentDemands }
  });
}

export async function handleAdminReviews(db, url, req) {
  const e = requireAdminOrError(await authUser(db, req));
  if (e) return e;
  const status = url.searchParams.get('status') || '';
  const teacherUserId = parseInt(url.searchParams.get('teacherUserId')) || 0;
  const reviews = await dbGetReviewsAdmin(db, { status, teacherUserId });
  return json({ reviews });
}

// 教师评分重算（评价通过/原已通过的评价被拒绝或删除时统一调用）：口径下沉 db.js 共享（注销清理同款）
// recomputeTeacherRating 即 dbRecomputeTeacherRating

export async function handleReviewAction(db, reviewId, action, body, req) {
  const admin = await authUser(db, req);
  const e = requireAdminOrError(admin);
  if (e) return e;
  const review = await dbGetReviewById(db, reviewId);
  if (!review) return error(MSG.REVIEW_NOT_FOUND);

  const wasApproved = review.status === STATUS.APPROVED; // 改动前的状态（status 在下方才被更新）
  const status = action === 'approve' ? STATUS.APPROVED : STATUS.REJECTED;
  await dbUpdateReviewStatus(db, reviewId, status);

  // 通过 → 重算；拒绝一条「原已通过」的评价同样要重算（把已计入的评分摘掉）
  if (action === 'approve' || (action === 'reject' && wasApproved)) {
    await dbRecomputeTeacherRating(db, review.teacher_user_id);
  }
  await logEvent(db, { action: `admin.review.${action}`, actorUserId: admin.id, actorUsername: admin.username,
    actorRole: 'admin', entity: 'review', entityId: reviewId,
    detail: { teacherUserId: review.teacher_user_id }, req });
  return json({ message: action === 'approve' ? MSG.REVIEW_APPROVED : MSG.REVIEW_REJECTED });
}

export async function handleAdminUsers(db, url, req) {
  const e = requireAdminOrError(await authUser(db, req));
  if (e) return e;
  const role = url.searchParams.get('role');
  if (!['student', 'teacher'].includes(role)) return error(MSG.INVALID_ROLE);

  const users = role === 'student'
    ? await dbGetStudentUsersAdmin(db)
    : await dbGetTeacherUsersAdmin(db);
  return json({ users });
}

export async function handleBanUser(db, userId, body, req) {
  const admin = await authUser(db, req);
  const e = requireAdminOrError(admin);
  if (e) return e;
  const target = await dbGetUserById(db, userId);
  if (!target) return error(MSG.USER_NOT_FOUND, 404);
  if (target.role === 'admin') return error(MSG.NO_PERMISSION, 403);

  const banned = body.banned ? 1 : 0;
  await dbSetUserBanned(db, userId, banned);
  await logEvent(db, { action: banned ? 'admin.ban' : 'admin.unban', actorUserId: admin.id,
    actorUsername: admin.username, actorRole: 'admin', entity: 'user', entityId: userId,
    detail: { targetUsername: target.username, targetRole: target.role, banned }, req });
  return json({ message: banned ? MSG.BANNED : MSG.UNBANNED, banned });
}

// POST /api/admin/teachers/:id/verify { verified } —— 学籍认证审核（运营建议：管理员核对学信网截图后置 1）
export async function handleVerifyTeacher(db, userId, body, req) {
  const admin = await authUser(db, req);
  const e = requireAdminOrError(admin);
  if (e) return e;
  const target = await dbGetUserById(db, userId);
  if (!target) return error(MSG.USER_NOT_FOUND, 404);
  if (target.role !== 'teacher') return error(MSG.TEACHER_ONLY, 403);
  const verified = body.verified ? 1 : 0;
  await dbSetTeacherVerified(db, userId, verified);
  await logEvent(db, { action: verified ? 'admin.teacher.verify' : 'admin.teacher.unverify', actorUserId: admin.id,
    actorUsername: admin.username, actorRole: 'admin', entity: 'user', entityId: userId,
    detail: { targetUsername: target.username, verified }, req });
  return json({ ok: true, verified });
}

// GET /api/admin/demands —— 管理员全量需求（含已签约；广场端点恒定排除 contracted，管理员页需独立全量端点）
export async function handleAdminDemands(db, url, req) {
  const e = requireAdminOrError(await authUser(db, req));
  if (e) return e;
  // 网安报告 F-09：keyset 游标分页（db.js），返回 { demands, nextCursor }，前端 nextCursor 翻页
  return json(await dbGetAllDemandsAdmin(db, url.searchParams.get('cursor') || null));
}

export async function handleAdminDeleteDemand(db, demandId, body, req) {
  const admin = await authUser(db, req);
  const e = requireAdminOrError(admin);
  if (e) return e;
  const existing = await dbGetDemandById(db, demandId);
  if (!existing) return error(MSG.DEMAND_NOT_FOUND, 404);
  if (existing.status === STATUS.CONTRACTED) return error(MSG.DEMAND_CONTRACTED_LOCKED, 409); // 已签约需求禁删（合同 demand_id 会悬空）
  const ok = await dbDeleteDemand(db, demandId); // 数据层门禁：pending/signing 合同引用时拒绝（防悬空，F-03b）
  if (!ok) return error(MSG.DEMAND_CONTRACTED_LOCKED, 409);
  await logEvent(db, { action: 'admin.demand.delete', actorUserId: admin.id, actorUsername: admin.username,
    actorRole: 'admin', entity: 'demand', entityId: demandId, req });
  return json({ message: MSG.DEMAND_DELETED });
}

export async function handleAdminDeleteReview(db, reviewId, body, req) {
  const admin = await authUser(db, req);
  const e = requireAdminOrError(admin);
  if (e) return e;
  const review = await dbGetReviewById(db, reviewId);
  if (!review) return error(MSG.REVIEW_NOT_FOUND, 404);
  await dbDeleteReview(db, reviewId);
  if (review.status === STATUS.APPROVED) await dbRecomputeTeacherRating(db, review.teacher_user_id); // 删除已通过评价 → 教师评分重算
  await logEvent(db, { action: 'admin.review.delete', actorUserId: admin.id, actorUsername: admin.username,
    actorRole: 'admin', entity: 'review', entityId: reviewId, req });
  return json({ message: MSG.REVIEW_DELETED });
}

// DELETE /api/admin/messages/:id —— 管理员删除单条聊天消息（留档 admin.message.delete）
export async function handleAdminDeleteMessage(db, messageId, body, req) {
  const admin = await authUser(db, req);
  const e = requireAdminOrError(admin);
  if (e) return e;
  const m = await dbGetMessageById(db, messageId);
  if (!m) return error(MSG.MESSAGE_NOT_FOUND, 404);
  await dbDeleteMessage(db, messageId);
  await logEvent(db, { action: 'admin.message.delete', actorUserId: admin.id, actorUsername: admin.username,
    actorRole: 'admin', entity: 'message', entityId: messageId,
    detail: { conversationId: m.conversation_id, senderUserId: m.sender_user_id, kind: m.kind }, req });
  return json({ ok: true });
}

// 日志检索（action 前缀 / 操作人 / 实体 / 时间范围 / detail 模糊 / 分页）
export async function handleAdminLogs(db, url, req) {
  const e = requireAdminOrError(await authUser(db, req));
  if (e) return e;
  const f = Object.fromEntries(url.searchParams);
  const result = await queryLog(db, f);
  return json(result);
}

// GET /api/admin/logs/:id/decrypt —— 单条留档显式解密（列表检索已透明解密，此为按 id 定点取原文）
export async function handleAdminDecryptLog(db, logId, req) {
  const e = requireAdminOrError(await authUser(db, req));
  if (e) return e;
  const entry = await decryptLogEntry(db, logId);
  if (!entry) return error(MSG.LOG_NOT_FOUND, 404);
  return json(entry);
}

// POST /api/feedbacks { kind, title, content } —— 全用户可提交（关于平台页「用户反馈」；身份凭令牌，防冒名）
export async function handleCreateFeedback(db, body, req) {
  const me = await authUser(db, req);
  if (!me) return error(MSG.LOGIN_REQUIRED, 401);
  const userId = me.id;
  const kind = body.kind === 'bug' ? 'bug' : 'suggestion';
  const title = String(body.title || '').trim().slice(0, 60);
  const content = String(body.content || '').trim().slice(0, 5000);
  if (!content) return error(MSG.BROADCAST_EMPTY);
  const feedbackId = await dbCreateFeedback(db, userId, kind, title, content);
  await logEvent(db, { action: 'feedback.create', actorUserId: userId, entity: 'feedback',
    entityId: feedbackId, detail: { kind, title, len: content.length }, req });
  return json({ ok: true }, 201);
}

// GET /api/feedbacks?status= —— 管理员查看反馈（含提交者用户名 + 处理状态；status 可选过滤，下推 db 层）
export async function handleAdminFeedbacks(db, url, req) {
  const e = requireAdminOrError(await authUser(db, req));
  if (e) return e;
  const feedbacks = await dbGetFeedbacksAdmin(db, url.searchParams.get('status') || '');
  return json({ feedbacks });
}

// POST /api/feedbacks/:id/resolve { username } —— 管理员标记已处理，通知反馈提出者
export async function handleResolveFeedback(db, feedbackId, body, req) {
  const admin = await authUser(db, req);
  const e = requireAdminOrError(admin);
  if (e) return e;
  const f = await dbGetFeedbackById(db, feedbackId);
  if (!f) return error(MSG.FEEDBACK_NOT_FOUND, 404);
  if (f.status !== STATUS.RESOLVED) {
    await dbResolveFeedback(db, feedbackId);
    await notifyUser(db, f.user_id, globalThis.APP_CONSTANTS.UI.FEEDBACK_RESOLVED);
    await logEvent(db, { action: 'admin.feedback.resolve', actorUserId: admin.id, actorUsername: admin.username,
      actorRole: 'admin', entity: 'feedback', entityId: feedbackId, detail: { kind: f.kind }, req });
  }
  return json({ ok: true });
}

// 通知信息页「发通知」：管理员发送全体可见的系统公告（编辑器复用发帖组件：标题+正文，
// 推送时标题加【系统通知】前缀）
export async function handleAdminBroadcast(db, body, req) {
  const admin = await authUser(db, req);
  const e = requireAdminOrError(admin);
  if (e) return e;
  const title = String(body.title || '').trim();
  const text = String(body.text || '').trim();
  if (!text) return error(MSG.BROADCAST_EMPTY);
  const message = title ? `${globalThis.APP_CONSTANTS.UI.NOTIFY_BROADCAST_PREFIX}${title}\n${text}` : text;
  const count = await dbBroadcastNotification(db, message);
  await logEvent(db, { action: 'admin.notify.broadcast', actorUserId: admin.id, actorUsername: admin.username,
    actorRole: 'admin', entity: 'notification', entityId: 0, detail: { recipients: count, len: message.length }, req });
  return json({ ok: true, count });
}
