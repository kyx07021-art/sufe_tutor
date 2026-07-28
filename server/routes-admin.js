/**
 * 路由模块：管理员（邀请码 / 统计 / 用户管理 / 需求管理 / 评价审核 / 日志检索）
 * 管理员敏感操作一律发语义日志 admin.*（封禁、删除、审核、发码）
 */
import {
  json, error, requireAdmin, genCode, dbGet, dbRun, dbAll,
  INITIAL_RATING, INITIAL_WEIGHT, MSG,
} from './core.js';
import {
  dbFindUserByUsername, dbCreateInviteCode, dbGetAllInvites,
  dbGetUserStats, dbGetCount, dbGetReviewStats, dbGetInviteStats,
  dbGetRecentUsers, dbGetRecentDemands, dbGetReviewsAdmin, dbGetReviewById,
  dbUpdateReviewStatus, dbGetApprovedReviewStats, dbUpdateTeacherRating,
  dbGetDemandById, dbDeleteDemand, dbDeleteReview, mapTeacherProfileRow,
} from './db.js';
import { logEvent, queryLog } from './log.js';
import { dbBroadcastNotification, notifyUser } from './notify.js';

// 邀请码有效期
const INVITE_VALIDITY_MS = 5 * 60 * 1000;

export async function handleAdminCheck(db, url) {
  return json({ isAdmin: !!(await requireAdmin(db, url.searchParams.get('username'))) });
}

export async function handleGenInvite(db, body, req) {
  const { username } = body;
  const admin = await requireAdmin(db, username);
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

export async function handleAdminInvites(db, url) {
  if (!(await requireAdmin(db, url.searchParams.get('username')))) return error(MSG.ADMIN_ONLY, 403);
  const invites = await dbGetAllInvites(db);
  return json({ invites });
}

export async function handleAdminStats(db, url) {
  if (!(await requireAdmin(db, url.searchParams.get('username')))) return error(MSG.ADMIN_ONLY, 403);

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

export async function handleAdminReviews(db, url) {
  if (!(await requireAdmin(db, url.searchParams.get('username')))) return error(MSG.ADMIN_ONLY, 403);
  const status = url.searchParams.get('status') || '';
  const teacherUserId = parseInt(url.searchParams.get('teacherUserId')) || 0;
  const reviews = await dbGetReviewsAdmin(db, { status, teacherUserId });
  return json({ reviews });
}

export async function handleReviewAction(db, reviewId, action, body, req) {
  const admin = await requireAdmin(db, body.username);
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

export async function handleAdminUsers(db, url) {
  if (!(await requireAdmin(db, url.searchParams.get('username')))) return error(MSG.ADMIN_ONLY, 403);
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
  const admin = await requireAdmin(db, body.username);
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

export async function handleAdminDeleteDemand(db, demandId, body, req) {
  const admin = await requireAdmin(db, body.username);
  if (!admin) return error(MSG.ADMIN_ONLY, 403);
  if (!(await dbGetDemandById(db, demandId))) return error(MSG.DEMAND_NOT_FOUND, 404);
  await dbDeleteDemand(db, demandId);
  logEvent(db, { action: 'admin.demand.delete', actorUserId: admin.id, actorUsername: admin.username,
    actorRole: 'admin', entity: 'demand', entityId: demandId, req });
  return json({ message: MSG.DEMAND_DELETED });
}

export async function handleAdminDeleteReview(db, reviewId, body, req) {
  const admin = await requireAdmin(db, body.username);
  if (!admin) return error(MSG.ADMIN_ONLY, 403);
  if (!(await dbGetReviewById(db, reviewId))) return error(MSG.REVIEW_NOT_FOUND, 404);
  await dbDeleteReview(db, reviewId);
  logEvent(db, { action: 'admin.review.delete', actorUserId: admin.id, actorUsername: admin.username,
    actorRole: 'admin', entity: 'review', entityId: reviewId, req });
  return json({ message: MSG.REVIEW_DELETED });
}

// 日志检索（action 前缀 / 操作人 / 实体 / 时间范围 / detail 模糊 / 分页）
export async function handleAdminLogs(db, url) {
  if (!(await requireAdmin(db, url.searchParams.get('username')))) return error(MSG.ADMIN_ONLY, 403);
  const f = Object.fromEntries(url.searchParams);
  const result = await queryLog(db, f);
  return json(result);
}

// POST /api/feedbacks { userId, kind, title, content } —— 全用户可提交（关于我们页「用户反馈」）
export async function handleCreateFeedback(db, body, req) {
  const userId = parseInt(body.userId);
  const kind = body.kind === 'bug' ? 'bug' : 'suggestion';
  const title = String(body.title || '').trim().slice(0, 60);
  const content = String(body.content || '').trim().slice(0, 5000);
  if (!userId) return error(MSG.LOGIN_REQUIRED);
  if (!content) return error(MSG.BROADCAST_EMPTY);
  const res = await dbRun(db, 'INSERT INTO feedbacks (user_id, kind, title, content) VALUES (?,?,?,?)', [userId, kind, title, content]);
  logEvent(db, { action: 'feedback.create', actorUserId: userId, entity: 'feedback',
    entityId: (res && res.meta && res.meta.last_row_id) || 0, detail: { kind, title, len: content.length }, req });
  return json({ ok: true }, 201);
}

// GET /api/feedbacks?username= —— 管理员查看全部反馈（含提交者用户名 + 处理状态）
export async function handleAdminFeedbacks(db, url) {
  if (!(await requireAdmin(db, url.searchParams.get('username')))) return error(MSG.ADMIN_ONLY, 403);
  const feedbacks = await dbAll(db,
    `SELECT f.*, u.username FROM feedbacks f JOIN users u ON u.id = f.user_id ORDER BY f.id DESC LIMIT 200`);
  return json({ feedbacks });
}

// POST /api/feedbacks/:id/resolve { username } —— 管理员标记已处理，通知反馈提出者
export async function handleResolveFeedback(db, feedbackId, body, req) {
  const admin = await requireAdmin(db, body.username);
  if (!admin) return error(MSG.ADMIN_ONLY, 403);
  const f = await dbGet(db, 'SELECT * FROM feedbacks WHERE id=?', [feedbackId]);
  if (!f) return error(MSG.FEEDBACK_NOT_FOUND, 404);
  if (f.status !== 'resolved') {
    await dbRun(db, `UPDATE feedbacks SET status='resolved' WHERE id=?`, [feedbackId]);
    await notifyUser(db, f.user_id, MSG.FEEDBACK_RESOLVED);
    logEvent(db, { action: 'admin.feedback.resolve', actorUserId: admin.id, actorUsername: admin.username,
      actorRole: 'admin', entity: 'feedback', entityId: feedbackId, detail: { kind: f.kind }, req });
  }
  return json({ ok: true });
}

// 通知信息页「发通知」：管理员发送全体可见的系统公告（编辑器复用发帖组件：标题+正文，
// 推送时标题加【系统通知】前缀）
export async function handleAdminBroadcast(db, body, req) {
  const admin = await requireAdmin(db, body.username);
  if (!admin) return error(MSG.ADMIN_ONLY, 403);
  const title = String(body.title || '').trim();
  const text = String(body.text || '').trim();
  if (!text) return error(MSG.BROADCAST_EMPTY);
  const message = title ? `【系统通知】${title}\n${text}` : text;
  const count = await dbBroadcastNotification(db, message);
  logEvent(db, { action: 'admin.notify.broadcast', actorUserId: admin.id, actorUsername: admin.username,
    actorRole: 'admin', entity: 'notification', entityId: 0, detail: { recipients: count, len: message.length }, req });
  return json({ ok: true, count });
}
