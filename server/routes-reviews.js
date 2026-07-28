/**
 * 路由模块：评价（学生发表 / 修改 / 公开列表）
 * 规则：仅签约学生可评价（签约机制未上线，门禁经 dbIsContracted 预留接口）；
 *       每名学生对每名教师限一条，已有评价只能修改（修改后重回待审核）。
 */
import { json, error, dbGet, authUser, MSG } from './core.js';
import {
  dbFindUserById, dbCreateReview, dbGetApprovedReviews, dbGetReviewByPair,
  dbUpdateReview, dbIsContracted,
} from './db.js';
import { logEvent } from './log.js';

export async function handleCreateReview(db, body, req) {
  const { teacherUserId, rating, comment } = body;
  if (!rating || rating < 1 || rating > 5) return error(MSG.RATING_RANGE);
  if (!comment || comment.trim().length < 2) return error(MSG.COMMENT_TOO_SHORT);

  const reviewer = await authUser(db, req);
  if (!reviewer || reviewer.role !== 'student') return error(MSG.STUDENT_REVIEW_ONLY, 403);
  const reviewerUserId = reviewer.id;
  if (!(await dbIsContracted(db, reviewerUserId, teacherUserId))) return error(MSG.REVIEW_CONTRACT_ONLY, 403);
  if (await dbGetReviewByPair(db, reviewerUserId, teacherUserId)) return error(MSG.REVIEW_EXISTS, 409);

  const id = await dbCreateReview(db, teacherUserId, reviewerUserId, rating, comment.trim());
  logEvent(db, { action: 'review.create', actorUserId: reviewerUserId, actorRole: 'student',
    entity: 'review', entityId: id, detail: { teacherUserId, rating }, req });
  return json({ id, message: MSG.REVIEW_SUBMITTED });
}

// 修改自己的评价（归属校验 + 重回待审核）
export async function handleUpdateReview(db, reviewId, body, req) {
  const { rating, comment } = body;
  if (!rating || rating < 1 || rating > 5) return error(MSG.RATING_RANGE);
  if (!comment || comment.trim().length < 2) return error(MSG.COMMENT_TOO_SHORT);

  const me = await authUser(db, req);
  if (!me) return error(MSG.LOGIN_REQUIRED, 401);
  const existing = await dbGet(db, 'SELECT * FROM reviews WHERE id=?', [reviewId]);
  if (!existing) return error(MSG.REVIEW_NOT_FOUND, 404);
  if (existing.reviewer_user_id !== me.id) return error(MSG.NO_PERMISSION, 403);
  const reviewerUserId = me.id;

  await dbUpdateReview(db, reviewId, rating, comment.trim());
  logEvent(db, { action: 'review.update', actorUserId: reviewerUserId, actorRole: 'student',
    entity: 'review', entityId: reviewId, detail: { rating }, req });
  return json({ message: MSG.REVIEW_UPDATED });
}

// 公开列表（仅已通过）+ 请求者自己的评价（mine，任意状态，供「写评价/修改评价」判定）
export async function handleGetReviews(db, url, req) {
  const teacherUserId = parseInt(url.searchParams.get('teacherUserId'));
  const reviewerRaw = url.searchParams.get('reviewerUserId');
  const reviews = await dbGetApprovedReviews(db, teacherUserId);
  // 「我的评价」（含待审/被拒私有态）仅限本人凭令牌查，防枚举他人私有评价
  let mine = null;
  if (reviewerRaw) {
    const me = await authUser(db, req);
    if (me && me.id === parseInt(reviewerRaw)) mine = await dbGetReviewByPair(db, me.id, teacherUserId);
  }
  return json({ reviews, mine });
}
