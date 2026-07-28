/**
 * 路由模块：评价（学生发表 / 修改 / 公开列表）
 * 规则：仅签约学生可评价（签约机制未上线，门禁经 dbIsContracted 预留接口）；
 *       每名学生对每名教师限一条，已有评价只能修改（修改后重回待审核）。
 */
import { json, error, MSG } from './core.js';
import {
  dbFindUserById, dbCreateReview, dbGetApprovedReviews, dbGetReviewByPair,
  dbUpdateReview, dbIsContracted,
} from './db.js';
import { logEvent } from './log.js';

export async function handleCreateReview(db, body, req) {
  const { teacherUserId, reviewerUserId, rating, comment } = body;
  if (!rating || rating < 1 || rating > 5) return error(MSG.RATING_RANGE);
  if (!comment || comment.trim().length < 2) return error(MSG.COMMENT_TOO_SHORT);

  const reviewer = await dbFindUserById(db, reviewerUserId);
  if (!reviewer || reviewer.role !== 'student') return error(MSG.STUDENT_REVIEW_ONLY, 403);
  if (!(await dbIsContracted(db, reviewerUserId, teacherUserId))) return error(MSG.REVIEW_CONTRACT_ONLY, 403);
  if (await dbGetReviewByPair(db, reviewerUserId, teacherUserId)) return error(MSG.REVIEW_EXISTS, 409);

  const id = await dbCreateReview(db, teacherUserId, reviewerUserId, rating, comment.trim());
  logEvent(db, { action: 'review.create', actorUserId: reviewerUserId, actorRole: 'student',
    entity: 'review', entityId: id, detail: { teacherUserId, rating }, req });
  return json({ id, message: MSG.REVIEW_SUBMITTED });
}

// 修改自己的评价（归属校验 + 重回待审核）
export async function handleUpdateReview(db, reviewId, body, req) {
  const { reviewerUserId, rating, comment } = body;
  if (!rating || rating < 1 || rating > 5) return error(MSG.RATING_RANGE);
  if (!comment || comment.trim().length < 2) return error(MSG.COMMENT_TOO_SHORT);

  const existing = await dbGet(db, 'SELECT * FROM reviews WHERE id=?', [reviewId]);
  if (!existing) return error(MSG.REVIEW_NOT_FOUND, 404);
  if (existing.reviewer_user_id !== reviewerUserId) return error(MSG.NO_PERMISSION, 403);

  await dbUpdateReview(db, reviewId, rating, comment.trim());
  logEvent(db, { action: 'review.update', actorUserId: reviewerUserId, actorRole: 'student',
    entity: 'review', entityId: reviewId, detail: { rating }, req });
  return json({ message: MSG.REVIEW_UPDATED });
}

// 公开列表（仅已通过）+ 请求者自己的评价（mine，任意状态，供「写评价/修改评价」判定）
export async function handleGetReviews(db, url) {
  const teacherUserId = parseInt(url.searchParams.get('teacherUserId'));
  const reviewerRaw = url.searchParams.get('reviewerUserId');
  const reviews = await dbGetApprovedReviews(db, teacherUserId);
  const mine = reviewerRaw ? await dbGetReviewByPair(db, parseInt(reviewerRaw), teacherUserId) : null;
  return json({ reviews, mine });
}
