/**
 * 路由模块：评价（学生发表 / 公开列表）
 */
import { json, error, MSG } from './core.js';
import { dbFindUserById, dbCreateReview, dbGetApprovedReviews } from './db.js';

export async function handleCreateReview(db, body) {
  const { teacherUserId, reviewerUserId, rating, comment } = body;
  if (!rating || rating < 1 || rating > 5) return error(MSG.RATING_RANGE);
  if (!comment || comment.trim().length < 2) return error(MSG.COMMENT_TOO_SHORT);

  const reviewer = await dbFindUserById(db, reviewerUserId);
  if (!reviewer || reviewer.role !== 'student') return error(MSG.STUDENT_REVIEW_ONLY, 403);

  const id = await dbCreateReview(db, teacherUserId, reviewerUserId, rating, comment.trim());
  return json({ id, message: MSG.REVIEW_SUBMITTED });
}

export async function handleGetReviews(db, url) {
  const teacherUserId = parseInt(url.searchParams.get('teacherUserId'));
  const reviews = await dbGetApprovedReviews(db, teacherUserId);
  return json({ reviews });
}
