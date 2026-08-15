/**
 * 路由模块：管理员（邀请码 / 统计 / 用户管理 / 需求管理 / 评价审核 / 日志检索 / 反馈 / 广播）
 * 管理员敏感操作一律发语义日志 admin.*（封禁、删除、审核、发码）。
 * 守卫统一走 requireAdmin（security.requireUser role='admin' 别名），替代散落的 authUser+requireAdminOrError 样板。
 */
import { json, error, genCode, toDbTime } from './util.js';
import { requireUser, requireAdmin } from './security.js';
import { MSG, STATUS, LIMITS, SECURITY } from './constants.js';
import {
  dbCreateInviteCode, dbListInviteCodes, dbRevokeInviteCode,
  dbGetUserStats, dbGetCount, dbGetCountWhere, dbGetReviewStats, dbGetInviteStats,
  dbGetRecentUsers, dbGetRecentDemands, dbGetReviewsAdmin, dbGetReviewById,
  dbUpdateReviewStatus, dbRecomputeTeacherRating,
  dbGetDemandById, dbAdminForceDeleteDemand, dbDeleteReview, dbDeleteMessage,
  dbGetStudentUsersAdmin, dbGetTeachers, dbGetUserById, dbSetUserBanned, dbSetTeacherVerified, dbSearchUsersByRole,
  dbGetDemands, dbGetMessageById,
  dbCreateFeedback, dbGetFeedbacksAdmin, dbGetFeedbackById, dbResolveFeedback, dbGetFeedbacksByUser,
} from './db.js';
import { logEvent, queryLog, decryptLogEntry, dbGetTrafficBuckets } from './log.js';
import { confirmDangerOtp } from './danger-ops.js'; // 封禁/解封危险操作二次认证（同注销/签约口径）
import '../constants.js'; // 用户可见文案统一走 globalThis.APP_CONSTANTS.UI
import { dbBroadcastNotification, notifyUser } from './notify.js';

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
  if (!ok) return error(MSG.INVITE_INVALID, 404);
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

export async function handleAdminReviews(db, url, req) {
  const { err } = await requireAdmin(db, req);
  if (err) return err;
  const status = url.searchParams.get('status') || '';
  const teacherUserId = parseInt(url.searchParams.get('teacherUserId')) || 0;
  const reviews = await dbGetReviewsAdmin(db, { status, teacherUserId });
  return json({ reviews });
}

// 评价审核（approve / reject）：通过或拒绝原已通过的评价都触发教师评分重算（口径 db.js 共享）
export async function handleReviewAction(db, reviewId, action, body, req) {
  const { admin, err } = await requireAdmin(db, req);
  if (err) return err;
  const review = await dbGetReviewById(db, reviewId);
  if (!review) return error(MSG.REVIEW_NOT_FOUND, 404); // 资源不存在统一 404（原误用默认 400）

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
  const { err } = await requireAdmin(db, req);
  if (err) return err;
  const role = url.searchParams.get('role');
  if (!['student', 'teacher'].includes(role)) return error(MSG.INVALID_ROLE);
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
  if (!target) return error(MSG.USER_NOT_FOUND, 404);
  if (target.role === 'admin') return error(MSG.NO_PERMISSION, 403);
  // 封禁/解封 = 危险操作（同注销/签约口径），须 capToken 二次认证：管理员令牌被复用/泄露时封禁一击无效
  if (!(await confirmDangerOtp(db, req, body))) return error(MSG.REAUTH_FAILED, 403);

  const banned = body.banned ? 1 : 0;
  await dbSetUserBanned(db, userId, banned);
  await logEvent(db, { action: banned ? 'admin.ban' : 'admin.unban', actorUserId: admin.id,
    actorUsername: admin.username, actorRole: 'admin', entity: 'user', entityId: userId,
    detail: { targetUsername: target.username, targetRole: target.role, banned }, req });
  return json({ message: banned ? MSG.BANNED : MSG.UNBANNED, banned });
}

// POST /api/admin/teachers/:id/verify { verified } —— 学籍认证审核（运营建议：管理员核对学信网截图后置 1）
export async function handleVerifyTeacher(db, userId, body, req) {
  const { admin, err } = await requireAdmin(db, req);
  if (err) return err;
  const target = await dbGetUserById(db, userId);
  if (!target) return error(MSG.USER_NOT_FOUND, 404);
  if (target.role !== 'teacher') return error(MSG.TEACHER_ONLY, 403);
  // 学籍认证 = 信任锚点操作（影响学生对教师的信任判断），须 capToken 二次认证
  if (!(await confirmDangerOtp(db, req, body))) return error(MSG.REAUTH_FAILED, 403);
  const verified = body.verified ? 1 : 0;
  await dbSetTeacherVerified(db, userId, verified);
  await logEvent(db, { action: verified ? 'admin.teacher.verify' : 'admin.teacher.unverify', actorUserId: admin.id,
    actorUsername: admin.username, actorRole: 'admin', entity: 'user', entityId: userId,
    detail: { targetUsername: target.username, verified }, req });
  return json({ ok: true, verified });
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
  if (!existing) return error(MSG.DEMAND_NOT_FOUND, 404);
  // 管理员可删全部需求（含已签约 contracted）；
  // 数据层 dbAdminForceDeleteDemand 同事务清 contracts/signing_requests 的 demand_id 引用再删需求，
  // F-03b 悬空不变量照守（常规非管理员路径仍走 dbDeleteDemand 的原子门禁）。
  const ok = await dbAdminForceDeleteDemand(db, demandId);
  if (!ok) return error(MSG.DEMAND_NOT_FOUND, 409); // 行已被并发删除等
  await logEvent(db, { action: 'admin.demand.delete', actorUserId: admin.id, actorUsername: admin.username,
    actorRole: 'admin', entity: 'demand', entityId: demandId, req });
  return json({ message: MSG.DEMAND_DELETED });
}

export async function handleAdminDeleteReview(db, reviewId, body, req) {
  const { admin, err } = await requireAdmin(db, req);
  if (err) return err;
  const review = await dbGetReviewById(db, reviewId);
  if (!review) return error(MSG.REVIEW_NOT_FOUND, 404);
  await dbDeleteReview(db, reviewId);
  if (review.status === STATUS.APPROVED) await dbRecomputeTeacherRating(db, review.teacher_user_id); // 删除已通过评价 → 教师评分重算
  await logEvent(db, { action: 'admin.review.delete', actorUserId: admin.id, actorUsername: admin.username,
    actorRole: 'admin', entity: 'review', entityId: reviewId, req });
  return json({ message: MSG.REVIEW_DELETED });
}

// DELETE /api/admin/messages/:id —— 管理员删除单条聊天消息（留档 admin.message.delete；backoffice 接口）
export async function handleAdminDeleteMessage(db, messageId, body, req) {
  const { admin, err } = await requireAdmin(db, req);
  if (err) return err;
  const m = await dbGetMessageById(db, messageId);
  if (!m) return error(MSG.MESSAGE_NOT_FOUND, 404);
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
  if (!entry) return error(MSG.LOG_NOT_FOUND, 404);
  return json(entry);
}

// POST /api/feedbacks { kind, title, content } —— 全用户可提交（关于平台页「用户反馈」；身份凭令牌，防冒名）
export async function handleCreateFeedback(db, body, req) {
  const { user: me, err } = await requireUser(db, req);
  if (err) return err;
  const userId = me.id;
  // 投诉通道——kind 白名单扩 complaint；投诉对象白名单（teacher/student/platform），非投诉恒空
  const kind = (body.kind === 'bug' || body.kind === 'complaint') ? body.kind : 'suggestion';
  const subject = (kind === 'complaint' && ['teacher', 'student', 'platform'].includes(body.subject)) ? body.subject : '';
  const title = String(body.title || '').trim().slice(0, LIMITS.TITLE_MAX);
  const content = String(body.content || '').trim().slice(0, LIMITS.FEEDBACK_BODY_MAX);
  if (!content) return error(MSG.FEEDBACK_EMPTY); // 反馈场景文案（原误用广播文案 BROADCAST_EMPTY，已修）
  const feedbackId = await dbCreateFeedback(db, userId, kind, title, content, subject);
  await logEvent(db, { action: 'feedback.create', actorUserId: userId, entity: 'feedback',
    entityId: feedbackId, detail: { kind, title, len: content.length }, req });
  return json({ ok: true }, 201);
}

// 我的反馈/投诉——用户侧闭环（仅本人数据；GET /api/feedbacks/mine）
export async function handleMyFeedbacks(db, req) {
  const { user: me, err } = await requireUser(db, req);
  if (err) return err;
  return json({ feedbacks: await dbGetFeedbacksByUser(db, me.id) });
}

// GET /api/feedbacks?status= —— 管理员查看反馈（含提交者用户名 + 处理状态；status 可选过滤，下推 db 层）
export async function handleAdminFeedbacks(db, url, req) {
  const { err } = await requireAdmin(db, req);
  if (err) return err;
  const feedbacks = await dbGetFeedbacksAdmin(db, url.searchParams.get('status') || '');
  return json({ feedbacks });
}

// POST /api/feedbacks/:id/resolve —— 管理员标记已处理，通知反馈提出者（body 不参与，通知文案取 UI.FEEDBACK_RESOLVED）
export async function handleResolveFeedback(db, feedbackId, body, req) {
  const { admin, err } = await requireAdmin(db, req);
  if (err) return err;
  const f = await dbGetFeedbackById(db, feedbackId);
  if (!f) return error(MSG.FEEDBACK_NOT_FOUND, 404);
  if (f.status !== STATUS.RESOLVED) {
    await dbResolveFeedback(db, feedbackId);
    // #165：投诉受理回执单独特文案；Bug/建议走通用文案
    const text = f.kind === 'complaint'
      ? globalThis.APP_CONSTANTS.UI.FEEDBACK_COMPLAINT_RESOLVED
      : globalThis.APP_CONSTANTS.UI.FEEDBACK_RESOLVED;
    await notifyUser(db, f.user_id, text);
    await logEvent(db, { action: 'admin.feedback.resolve', actorUserId: admin.id, actorUsername: admin.username,
      actorRole: 'admin', entity: 'feedback', entityId: feedbackId, detail: { kind: f.kind }, req });
  }
  return json({ ok: true });
}

// 通知信息页「发通知」：管理员发送全体可见的系统公告（编辑器复用发帖组件：标题+正文，
// 推送时标题加【系统通知】前缀）
export async function handleAdminBroadcast(db, body, req) {
  const { admin, err } = await requireAdmin(db, req);
  if (err) return err;
  // 广播影响全站用户 = 最高危管理操作，须 capToken 二次认证（同封禁/处罚口径）
  if (!(await confirmDangerOtp(db, req, body))) return error(MSG.REAUTH_FAILED, 403);
  const title = String(body.title || '').trim();
  const text = String(body.text || '').trim();
  if (!text) return error(MSG.BROADCAST_EMPTY);
  const message = title ? `${globalThis.APP_CONSTANTS.UI.NOTIFY_BROADCAST_PREFIX}${title}\n${text}` : text;
  const count = await dbBroadcastNotification(db, message);
  await logEvent(db, { action: 'admin.notify.broadcast', actorUserId: admin.id, actorUsername: admin.username,
    actorRole: 'admin', entity: 'notification', entityId: 0, detail: { recipients: count, len: message.length }, req });
  return json({ ok: true, count });
}

// ============================================================
// v1.2.0 T6：学信网核验队列（manual provider：管理员查证后结构化录入）
// ============================================================
export async function handleListVerifications(db, url, req) {
  const { err } = await requireAdmin(db, req);
  if (err) return err;
  const status = url.searchParams.get('status') || 'all';
  const list = await dbListTeacherVerifications(db, status) || [];
  return json({ verifications: list });
}

// POST /api/admin/verifications/:id/action { action:'approve'|'reject', school, level, major, enrollment_status, enroll_year }
// approve：结构化录入学信网字段 + 自动填入教师档案 + 通知教师；reject：通知教师
export async function handleVerificationAction(db, id, body, req) {
  const { admin, err } = await requireAdmin(db, req);
  if (err) return err;
  const v = await dbGetTeacherVerificationById(db, id);
  if (!v) return error(MSG.USER_NOT_FOUND, 404);
  const action = body.action;
  if (action === 'approve') {
    const school = String(body.school || '').trim().slice(0, LIMITS.SCHOOL_MAX);
    const level = String(body.level || '').trim().slice(0, 20);
    const major = String(body.major || '').trim().slice(0, 60);
    const enrollmentStatus = String(body.enrollment_status || '').trim().slice(0, 20);
    const enrollYear = String(body.enroll_year || '').trim().slice(0, 10);
    if (!school || !level) return error(MSG.INVALID_PARAMS, 400); // 院校/层次必填（结构化输入）
    const now = new Date().toISOString();
    await dbUpsertTeacherVerification(db, {
      userId: v.user_id, verifyCode: v.verify_code, status: 'approved', provider: v.provider || 'manual',
      school, level, major, enrollmentStatus, enrollYear, verifiedBy: admin.id, verifiedAt: now,
    });
    await dbApplyChsiToProfile(db, v.user_id, { school, level, major, enrollmentStatus, enrollYear });
    const text = `${globalThis.APP_CONSTANTS.UI.CHSI_NOTIFY_APPROVED}\n${globalThis.APP_CONSTANTS.UI.CHSI_NOTIFY_DETAIL}${school} · ${level}${major ? ' · ' + major : ''}`;
    await notifyUser(db, v.user_id, text);
    await logEvent(db, { action: 'admin.chsi.approve', actorUserId: admin.id, actorUsername: admin.username,
      actorRole: 'admin', entity: 'user', entityId: v.user_id, detail: { school, level, major }, req });
    return json({ ok: true });
  }
  if (action === 'reject') {
    const reason = String(body.reason || '').trim().slice(0, 200);
    await dbUpsertTeacherVerification(db, {
      userId: v.user_id, verifyCode: v.verify_code, status: 'rejected', provider: v.provider || 'manual',
      verifiedBy: admin.id, verifiedAt: new Date().toISOString(),
    });
    await notifyUser(db, v.user_id, `${globalThis.APP_CONSTANTS.UI.CHSI_NOTIFY_REJECTED}${reason ? '\n' + reason : ''}`);
    await logEvent(db, { action: 'admin.chsi.reject', actorUserId: admin.id, actorUsername: admin.username,
      actorRole: 'admin', entity: 'user', entityId: v.user_id, detail: { reason }, req });
    return json({ ok: true });
  }
  return error(MSG.INVALID_ACTION, 400);
}
