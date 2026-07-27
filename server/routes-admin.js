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
  const expiresAt = new Date(Date.now() + INVITE_VALIDITY_MS).toISOString();
  await dbCreateInviteCode(db, code, admin.id, expiresAt);
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
        tp.rating, tp.rating_count, tp.updated_at
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
