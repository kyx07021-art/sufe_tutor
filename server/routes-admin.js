/**
 * 路由模块：管理员（邀请码 / 统计 / 用户管理 / 需求管理 / 评价审核 / 日志检索）
 * 管理员敏感操作一律发语义日志 admin.*（封禁、删除、审核、发码）
 */
import {
  json, error, requireAdmin, authUser, genCode, dbGet, dbRun, dbAll,
  INITIAL_RATING, INITIAL_WEIGHT, MSG,
} from './core.js';
import {
  dbCreateInviteCode, dbGetAllInvites,
  dbGetUserStats, dbGetCount, dbGetReviewStats, dbGetInviteStats,
  dbGetRecentUsers, dbGetRecentDemands, dbGetReviewsAdmin, dbGetReviewById,
  dbUpdateReviewStatus, dbGetApprovedReviewStats, dbUpdateTeacherRating,
  dbGetDemandById, dbDeleteDemand, dbDeleteReview, dbDeleteMessage, mapTeacherProfileRow, mapDemandRow,
} from './db.js';
import { logEvent, queryLog, decryptLogEntry } from './log.js';
import '../constants.js'; // 用户可见文案统一走 globalThis.APP_CONSTANTS.UI
import { dbBroadcastNotification, notifyUser } from './notify.js';

// 邀请码有效期
const INVITE_VALIDITY_MS = 5 * 60 * 1000;

export async function handleAdminCheck(db, req) {
  return json({ isAdmin: !!(await requireAdmin(db, req)) });
}

export async function handleGenInvite(db, body, req) {
  const admin = await requireAdmin(db, req);
  if (!admin) return error(MSG.ADMIN_ONLY, 403);

  const code = genCode(8);
  const exp = new Date(Date.now() + INVITE_VALIDITY_MS);
  const expiresAt = exp.toISOString();                       // 返前端：ISO 带 Z，new Date 解析无时区歧义
  const expiresAtDb = expiresAt.slice(0, 19).replace('T', ' '); // 入库：同 datetime('now','localtime') 格式（worker 上即 UTC），字符串比较才正确
  await dbCreateInviteCode(db, code, admin.id, expiresAtDb);
  logEvent(db, { action: 'admin.invite.create', actorUserId: admin.id, actorUsername: admin.username,
    actorRole: 'admin', entity: 'invite', entityId: code, detail: { expiresAt }, req });
  return json({ code, expiresAt });
}

export async function handleAdminInvites(db, url, req) {
  if (!(await requireAdmin(db, req))) return error(MSG.ADMIN_ONLY, 403);
  const invites = await dbGetAllInvites(db);
  return json({ invites });
}

export async function handleAdminStats(db, url, req) {
  if (!(await requireAdmin(db, req))) return error(MSG.ADMIN_ONLY, 403);

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
  if (!(await requireAdmin(db, req))) return error(MSG.ADMIN_ONLY, 403);
  const status = url.searchParams.get('status') || '';
  const teacherUserId = parseInt(url.searchParams.get('teacherUserId')) || 0;
  const reviews = await dbGetReviewsAdmin(db, { status, teacherUserId });
  return json({ reviews });
}

export async function handleReviewAction(db, reviewId, action, body, req) {
  const admin = await requireAdmin(db, req);
  if (!admin) return error(MSG.ADMIN_ONLY, 403);
  const review = await dbGetReviewById(db, reviewId);
  if (!review) return error(MSG.REVIEW_NOT_FOUND);

  const status = action === 'approve' ? 'approved' : 'rejected';
  await dbUpdateReviewStatus(db, reviewId, status);

  if (action === 'approve') {
    const stats = await dbGetApprovedReviewStats(db, review.teacher_user_id);
    const cnt = stats?.cnt || 0;
    const sum = stats?.total || 0;
    const rating = (INITIAL_RATING * INITIAL_WEIGHT + sum) / (INITIAL_WEIGHT + cnt);
    await dbUpdateTeacherRating(db, review.teacher_user_id, rating, cnt, sum);
  }
  logEvent(db, { action: `admin.review.${action}`, actorUserId: admin.id, actorUsername: admin.username,
    actorRole: 'admin', entity: 'review', entityId: reviewId,
    detail: { teacherUserId: review.teacher_user_id }, req });
  return json({ message: action === 'approve' ? MSG.REVIEW_APPROVED : MSG.REVIEW_REJECTED });
}

export async function handleAdminUsers(db, url, req) {
  if (!(await requireAdmin(db, req))) return error(MSG.ADMIN_ONLY, 403);
  const role = url.searchParams.get('role');
  if (!['student', 'teacher'].includes(role)) return error(MSG.INVALID_ROLE);

  let users;
  if (role === 'student') {
    users = await dbAll(db, `SELECT u.id,u.username,u.role,u.banned,u.created_at,COUNT(sd.id) AS demand_count
      FROM users u LEFT JOIN student_demands sd ON sd.user_id=u.id
      WHERE u.role='student' GROUP BY u.id ORDER BY u.created_at DESC`);
  } else {
    const rows = await dbAll(db, `SELECT u.id AS user_id, u.username, u.role, u.banned, u.created_at,
        tp.id, tp.grade, tp.gender, tp.subjects, tp.gaokao_scores, tp.price, tp.wechat, tp.email,
        tp.rating, tp.rating_count, tp.province, tp.intro, tp.address, tp.updated_at
      FROM users u LEFT JOIN teacher_profiles tp ON tp.user_id=u.id
      WHERE u.role='teacher' ORDER BY u.created_at DESC`);
    users = rows.map(r => ({ ...mapTeacherProfileRow(r), role: r.role, banned: r.banned, created_at: r.created_at }));
  }
  return json({ users });
}

export async function handleBanUser(db, userId, body, req) {
  const admin = await requireAdmin(db, req);
  if (!admin) return error(MSG.ADMIN_ONLY, 403);
  const target = await dbGet(db, 'SELECT id,username,role FROM users WHERE id=?', [userId]);
  if (!target) return error(MSG.USER_NOT_FOUND, 404);
  if (target.role === 'admin') return error(MSG.NO_PERMISSION, 403);

  const banned = body.banned ? 1 : 0;
  await dbRun(db, 'UPDATE users SET banned=? WHERE id=?', [banned, userId]);
  logEvent(db, { action: banned ? 'admin.ban' : 'admin.unban', actorUserId: admin.id,
    actorUsername: admin.username, actorRole: 'admin', entity: 'user', entityId: userId,
    detail: { targetUsername: target.username, targetRole: target.role, banned }, req });
  return json({ message: banned ? MSG.BANNED : MSG.UNBANNED, banned });
}

// GET /api/admin/demands —— 管理员全量需求（含已签约；广场端点恒定排除 contracted，管理员页需独立全量端点）
export async function handleAdminDemands(db, url, req) {
  if (!(await requireAdmin(db, req))) return error(MSG.ADMIN_ONLY, 403);
  const rows = await dbAll(db,
    `SELECT sd.*, u.username, u.avatar FROM student_demands sd JOIN users u ON u.id=sd.user_id ORDER BY sd.created_at DESC LIMIT 300`);
  return json({ demands: rows.map(mapDemandRow) });
}

export async function handleAdminDeleteDemand(db, demandId, body, req) {
  const admin = await requireAdmin(db, req);
  if (!admin) return error(MSG.ADMIN_ONLY, 403);
  const existing = await dbGetDemandById(db, demandId);
  if (!existing) return error(MSG.DEMAND_NOT_FOUND, 404);
  if (existing.status === 'contracted') return error(MSG.DEMAND_CONTRACTED_LOCKED, 409); // 已签约需求禁删（合同 demand_id 会悬空）
  await dbDeleteDemand(db, demandId);
  logEvent(db, { action: 'admin.demand.delete', actorUserId: admin.id, actorUsername: admin.username,
    actorRole: 'admin', entity: 'demand', entityId: demandId, req });
  return json({ message: MSG.DEMAND_DELETED });
}

export async function handleAdminDeleteReview(db, reviewId, body, req) {
  const admin = await requireAdmin(db, req);
  if (!admin) return error(MSG.ADMIN_ONLY, 403);
  if (!(await dbGetReviewById(db, reviewId))) return error(MSG.REVIEW_NOT_FOUND, 404);
  await dbDeleteReview(db, reviewId);
  logEvent(db, { action: 'admin.review.delete', actorUserId: admin.id, actorUsername: admin.username,
    actorRole: 'admin', entity: 'review', entityId: reviewId, req });
  return json({ message: MSG.REVIEW_DELETED });
}

// DELETE /api/admin/messages/:id —— 管理员删除单条聊天消息（留档 admin.message.delete）
export async function handleAdminDeleteMessage(db, messageId, body, req) {
  const admin = await requireAdmin(db, req);
  if (!admin) return error(MSG.ADMIN_ONLY, 403);
  const m = await dbGet(db, 'SELECT id, conversation_id, sender_user_id, kind FROM messages WHERE id=?', [messageId]);
  if (!m) return error(MSG.MESSAGE_NOT_FOUND, 404);
  await dbDeleteMessage(db, messageId);
  logEvent(db, { action: 'admin.message.delete', actorUserId: admin.id, actorUsername: admin.username,
    actorRole: 'admin', entity: 'message', entityId: messageId,
    detail: { conversationId: m.conversation_id, senderUserId: m.sender_user_id, kind: m.kind }, req });
  return json({ ok: true });
}

// 日志检索（action 前缀 / 操作人 / 实体 / 时间范围 / detail 模糊 / 分页）
export async function handleAdminLogs(db, url, req) {
  if (!(await requireAdmin(db, req))) return error(MSG.ADMIN_ONLY, 403);
  const f = Object.fromEntries(url.searchParams);
  const result = await queryLog(db, f);
  return json(result);
}

// GET /api/admin/logs/:id/decrypt —— 单条留档显式解密（列表检索已透明解密，此为按 id 定点取原文）
export async function handleAdminDecryptLog(db, logId, req) {
  if (!(await requireAdmin(db, req))) return error(MSG.ADMIN_ONLY, 403);
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
  const res = await dbRun(db, 'INSERT INTO feedbacks (user_id, kind, title, content) VALUES (?,?,?,?)', [userId, kind, title, content]);
  logEvent(db, { action: 'feedback.create', actorUserId: userId, entity: 'feedback',
    entityId: (res && res.meta && res.meta.last_row_id) || 0, detail: { kind, title, len: content.length }, req });
  return json({ ok: true }, 201);
}

// GET /api/feedbacks?username= —— 管理员查看全部反馈（含提交者用户名 + 处理状态）
export async function handleAdminFeedbacks(db, url, req) {
  if (!(await requireAdmin(db, req))) return error(MSG.ADMIN_ONLY, 403);
  const feedbacks = await dbAll(db,
    `SELECT f.*, u.username FROM feedbacks f JOIN users u ON u.id = f.user_id ORDER BY f.id DESC LIMIT 200`);
  return json({ feedbacks });
}

// POST /api/feedbacks/:id/resolve { username } —— 管理员标记已处理，通知反馈提出者
export async function handleResolveFeedback(db, feedbackId, body, req) {
  const admin = await requireAdmin(db, req);
  if (!admin) return error(MSG.ADMIN_ONLY, 403);
  const f = await dbGet(db, 'SELECT * FROM feedbacks WHERE id=?', [feedbackId]);
  if (!f) return error(MSG.FEEDBACK_NOT_FOUND, 404);
  if (f.status !== 'resolved') {
    await dbRun(db, `UPDATE feedbacks SET status='resolved' WHERE id=?`, [feedbackId]);
    await notifyUser(db, f.user_id, globalThis.APP_CONSTANTS.UI.FEEDBACK_RESOLVED);
    logEvent(db, { action: 'admin.feedback.resolve', actorUserId: admin.id, actorUsername: admin.username,
      actorRole: 'admin', entity: 'feedback', entityId: feedbackId, detail: { kind: f.kind }, req });
  }
  return json({ ok: true });
}

// 通知信息页「发通知」：管理员发送全体可见的系统公告（编辑器复用发帖组件：标题+正文，
// 推送时标题加【系统通知】前缀）
export async function handleAdminBroadcast(db, body, req) {
  const admin = await requireAdmin(db, req);
  if (!admin) return error(MSG.ADMIN_ONLY, 403);
  const title = String(body.title || '').trim();
  const text = String(body.text || '').trim();
  if (!text) return error(MSG.BROADCAST_EMPTY);
  const message = title ? `${globalThis.APP_CONSTANTS.UI.NOTIFY_BROADCAST_PREFIX}${title}\n${text}` : text;
  const count = await dbBroadcastNotification(db, message);
  logEvent(db, { action: 'admin.notify.broadcast', actorUserId: admin.id, actorUsername: admin.username,
    actorRole: 'admin', entity: 'notification', entityId: 0, detail: { recipients: count, len: message.length }, req });
  return json({ ok: true, count });
}
