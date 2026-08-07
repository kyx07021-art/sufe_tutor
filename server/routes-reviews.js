/**
 * 路由模块：评价（学生发表 / 修改 / 公开列表）
 * 规则：仅签约学生可评价（门禁经 dbIsContracted）；每名学生对每名教师限一条，
 *       已有评价只能修改（修改后重回待审核）。
 * 依赖：util / security（requireUser）/ constants（校验文案/评分/评论限额）/ db / log。
 */
import { json, error } from './util.js';
import { requireUser } from './security.js';
import { MSG, LIMITS } from './constants.js';
import {
  dbCreateReview, dbGetApprovedReviews, dbGetReviewByPair,
  dbUpdateReview, dbIsContracted, dbGetReviewById,
} from './db.js';
import { logEvent } from './log.js';

export async function handleCreateReview(db, body, req) {
  const { teacherUserId, rating, comment } = body;
  // 评分/评论长度限额单源 LIMITS（拒绝 2.5 / "3.5" / NaN）
  if (!Number.isInteger(rating) || rating < LIMITS.RATING_MIN || rating > LIMITS.RATING_MAX) return error(MSG.RATING_RANGE);
  if (!comment || comment.trim().length < LIMITS.COMMENT_MIN_LEN) return error(MSG.COMMENT_TOO_SHORT);

  const { user: reviewer, err } = await requireUser(db, req, 'student');
  if (err) return err;
  const reviewerUserId = reviewer.id;
  if (!(await dbIsContracted(db, reviewerUserId, teacherUserId))) return error(MSG.REVIEW_CONTRACT_ONLY, 403);
  if (await dbGetReviewByPair(db, reviewerUserId, teacherUserId)) return error(MSG.REVIEW_EXISTS, 409);

  let id;
  try {
    id = await dbCreateReview(db, teacherUserId, reviewerUserId, rating, comment.trim());
  } catch (err2) {
    if (String(err2?.message || err2).includes('UNIQUE')) return error(MSG.REVIEW_EXISTS, 409); // 唯一索引兜底（并发双发）
    throw err2;
  }
  await logEvent(db, { action: 'review.create', actorUserId: reviewerUserId, actorRole: 'student',
    entity: 'review', entityId: id, detail: { teacherUserId, rating }, req });
  return json({ id, message: MSG.REVIEW_SUBMITTED });
}

// 修改自己的评价（归属校验 + 重回待审核）
export async function handleUpdateReview(db, reviewId, body, req) {
  const { rating, comment } = body;
  if (!Number.isInteger(rating) || rating < LIMITS.RATING_MIN || rating > LIMITS.RATING_MAX) return error(MSG.RATING_RANGE);
  if (!comment || comment.trim().length < LIMITS.COMMENT_MIN_LEN) return error(MSG.COMMENT_TOO_SHORT);

  const { user: me, err } = await requireUser(db, req);
  if (err) return err;
  const existing = await dbGetReviewById(db, reviewId);
  if (!existing) return error(MSG.REVIEW_NOT_FOUND, 404);
  if (existing.reviewer_user_id !== me.id) return error(MSG.NO_PERMISSION, 403);
  const reviewerUserId = me.id;

  await dbUpdateReview(db, reviewId, rating, comment.trim());
  await logEvent(db, { action: 'review.update', actorUserId: reviewerUserId, actorRole: 'student',
    entity: 'review', entityId: reviewId, detail: { rating }, req });
  return json({ message: MSG.REVIEW_UPDATED });
}

// 公开列表（仅已通过）+ 「我的评价」（mine：凭令牌取本人任意状态的私有态，供写/改评价判定；
// 访客无令牌则 mine=null，公开列表照常可见）
export async function handleGetReviews(db, url, req) {
  const teacherUserId = parseInt(url.searchParams.get('teacherUserId'));
  const reviews = await dbGetApprovedReviews(db, teacherUserId);
  const me = (await requireUser(db, req)).user || null; // 访客无令牌：err 分支 user 为 undefined → 公开列表照常
  const mine = me ? await dbGetReviewByPair(db, me.id, teacherUserId) : null;
  return json({ reviews, mine });
}
