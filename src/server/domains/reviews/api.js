/**
 * 路由模块：评价（学生发表 / 修改 / 公开列表）
 * 规则：评价资格经三条件模型（dbCanReview：会话存在 + 双方往来消息各≥1 + 教师核验 approved，
 *       禁止评价自己）；每名学生对每名教师限一条，已有评价只能修改（修改后重回待审核）。
 * 依赖：util / security（requireUser）/ eligibility（dbCanReview 三条件门禁）/ constants / db / log。
 */
import { json, errorMsg, isUniqueConflict, parseIdParam } from '../../core/util.js';
import { requireUser, requireAdmin } from '../../core/security.js';
import { MSG } from '../../../shared/codes.js';
import { STATUS } from '../../../shared/enums.js';
import { LIMITS } from '../../../shared/config.js';
import { dbCanReview } from './eligibility.js';
import {
  dbCreateReview, dbGetApprovedReviews, dbGetReviewByPair,
  dbUpdateReview, dbGetReviewById,
  dbGetReviewsAdmin, dbUpdateReviewStatus, dbRecomputeTeacherRating, dbDeleteReview,
} from '../../../../server/db.js';
import { confirmDangerOtp } from '../../core/danger-ops.js'; // P12: dangerous operations require capToken (same as ban/content-penalty path)
import { logEvent } from '../../core/log.js';

export async function handleCreateReview(db, body, req) {
  const { teacherUserId, rating, comment } = body;
  // 评分/评论长度限额单源 LIMITS（拒绝 2.5 / "3.5" / NaN）
  if (!Number.isInteger(rating) || rating < LIMITS.RATING_MIN || rating > LIMITS.RATING_MAX) return errorMsg('RATING_RANGE');
  if (!comment || comment.trim().length < LIMITS.REVIEW_COMMENT_MIN) return errorMsg('COMMENT_TOO_SHORT');

  const { user: reviewer, err } = await requireUser(db, req, 'student');
  if (err) return err;
  const reviewerUserId = reviewer.id;
  const eligibility = await dbCanReview(db, reviewerUserId, teacherUserId);
  if (!eligibility.ok) {
    // 三条件门禁（S6 定案②）：会话存在 + 双方往来消息各≥1 + 教师核验 approved；禁止评价自己。
    // 错误码单源归 shared/codes.js（主会话落码 REVIEW_ELIGIBILITY / REVIEW_SELF_FORBIDDEN），
    // 此处先复用既有键（403 NO_PERMISSION / 400 INVALID_PARAMS），主会话落码后替换。
    if (eligibility.reason === 'SELF_REVIEW') return errorMsg('INVALID_PARAMS', 400);
    return errorMsg('NO_PERMISSION', 403);
  }
  if (await dbGetReviewByPair(db, reviewerUserId, teacherUserId)) return errorMsg('REVIEW_EXISTS', 409);

  let id;
  try {
    id = await dbCreateReview(db, teacherUserId, reviewerUserId, rating, comment.trim());
  } catch (err2) {
    if (isUniqueConflict(err2)) return errorMsg('REVIEW_EXISTS', 409); // 唯一索引兜底（并发双发）
    throw err2;
  }
  await logEvent(db, { action: 'review.create', actorUserId: reviewerUserId, actorRole: 'student',
    entity: 'review', entityId: id, detail: { teacherUserId, rating }, req });
  return json({ id, message: MSG.REVIEW_SUBMITTED });
}

// 修改自己的评价（归属校验 + 重回待审核）
export async function handleUpdateReview(db, reviewId, body, req) {
  const { rating, comment } = body;
  if (!Number.isInteger(rating) || rating < LIMITS.RATING_MIN || rating > LIMITS.RATING_MAX) return errorMsg('RATING_RANGE');
  if (!comment || comment.trim().length < LIMITS.REVIEW_COMMENT_MIN) return errorMsg('COMMENT_TOO_SHORT');

  const { user: me, err } = await requireUser(db, req);
  if (err) return err;
  const existing = await dbGetReviewById(db, reviewId);
  if (!existing) return errorMsg('REVIEW_NOT_FOUND', 404);
  if (existing.reviewer_user_id !== me.id) return errorMsg('NO_PERMISSION', 403);
  const reviewerUserId = me.id;

  await dbUpdateReview(db, reviewId, rating, comment.trim());
  await logEvent(db, { action: 'review.update', actorUserId: reviewerUserId, actorRole: 'student',
    entity: 'review', entityId: reviewId, detail: { rating }, req });
  return json({ message: MSG.REVIEW_UPDATED });
}

// 公开列表（仅已通过）+ 「我的评价」（mine：凭令牌取本人任意状态的私有态，供写/改评价判定；
// 访客无令牌则 mine=null，公开列表照常可见）
export async function handleGetReviews(db, url, req) {
  // PA-1f-F3 / C5 strict query parsing: teacherUserId must be /^\d+$/ (parseIdParam precedent).
  // Dirty input ('5abc', empty string) -> 400 INVALID_PARAMS; no parseInt prefix-truncation hitting the PK.
  // Absent param -> null (route-smoke path: returns an empty approved list, as before).
  const rawTeacherId = url.searchParams.get('teacherUserId');
  if (rawTeacherId !== null && !/^\d+$/.test(rawTeacherId)) return errorMsg('INVALID_PARAMS', 400);
  const teacherUserId = rawTeacherId === null ? null : Number(rawTeacherId);
  const reviews = await dbGetApprovedReviews(db, teacherUserId);
  const me = (await requireUser(db, req)).user || null; // 访客无令牌：err 分支 user 为 undefined → 公开列表照常
  const mine = me ? await dbGetReviewByPair(db, me.id, teacherUserId) : null;
  return json({ reviews, mine });
}

// ============================================================
// 管理员：评价审核（V-1-4c 迁入，reviews 域自持）
// ============================================================
export async function handleAdminReviews(db, url, req) {
  const { err } = await requireAdmin(db, req);
  if (err) return err;
  const status = url.searchParams.get('status') || '';
  // PA-1f-F3 / C5: optional teacherUserId filter must be /^\d+$/; dirty input -> 400;
  // absent -> null (no teacher filter in dbGetReviewsAdmin).
  const rawTeacherId = url.searchParams.get('teacherUserId');
  if (rawTeacherId !== null && !/^\d+$/.test(rawTeacherId)) return errorMsg('INVALID_PARAMS', 400);
  const teacherUserId = rawTeacherId === null ? null : Number(rawTeacherId);
  const reviews = await dbGetReviewsAdmin(db, { status, teacherUserId });
  return json({ reviews });
}

// 评价审核（approve / reject）：通过或拒绝原已通过的评价都触发教师评分重算（口径 db.js 共享）
export async function handleReviewAction(db, reviewId, action, body, req) {
  const { admin, err } = await requireAdmin(db, req);
  if (err) return err;
  const review = await dbGetReviewById(db, reviewId);
  if (!review) return errorMsg('REVIEW_NOT_FOUND', 404); // 资源不存在统一 404（原误用默认 400）
  // 审核 = 危险操作（改状态 + 触发评分重算，管理员令牌复用/泄露时一击改公开评分），须 capToken 二次认证（P12 同封禁/处罚口径）
  if (!(await confirmDangerOtp(db, req, body))) return errorMsg('REAUTH_FAILED', 403);

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

export async function handleAdminDeleteReview(db, reviewId, body, req) {
  const { admin, err } = await requireAdmin(db, req);
  if (err) return err;
  const review = await dbGetReviewById(db, reviewId);
  if (!review) return errorMsg('REVIEW_NOT_FOUND', 404);
  // 删除评价 = 危险操作（不可逆 + 触发评分重算），须 capToken 二次认证（P12 同封禁/处罚口径）
  if (!(await confirmDangerOtp(db, req, body))) return errorMsg('REAUTH_FAILED', 403);
  await dbDeleteReview(db, reviewId);
  if (review.status === STATUS.APPROVED) await dbRecomputeTeacherRating(db, review.teacher_user_id); // 删除已通过评价 → 教师评分重算
  await logEvent(db, { action: 'admin.review.delete', actorUserId: admin.id, actorUsername: admin.username,
    actorRole: 'admin', entity: 'review', entityId: reviewId, req });
  return json({ message: MSG.REVIEW_DELETED });
}

// ============================================================
// reviews 域路由表（V-1-4c：评价 + 管理员评价审核）
// ============================================================
const S = (method, path, handler) => ({ method, path, handler });
export const routes = [
  S('POST', '/api/reviews', c => handleCreateReview(c.db, c.body, c.req)),
  S('GET', '/api/reviews', c => handleGetReviews(c.db, c.url, c.req)),
  S('PUT', '/api/reviews/:id', c => handleUpdateReview(c.db, parseIdParam(c.params.id), c.body, c.req)),
  S('GET', '/api/admin/reviews', c => handleAdminReviews(c.db, c.url, c.req)),
  S('POST', '/api/admin/reviews/:id/approve', c => handleReviewAction(c.db, parseIdParam(c.params.id), 'approve', c.body, c.req)),
  S('POST', '/api/admin/reviews/:id/reject', c => handleReviewAction(c.db, parseIdParam(c.params.id), 'reject', c.body, c.req)),
  S('DELETE', '/api/admin/reviews/:id', c => handleAdminDeleteReview(c.db, parseIdParam(c.params.id), c.body, c.req)),
];
