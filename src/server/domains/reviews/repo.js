/**
 * 评价域数据层（V-1-4 从 server/db.js 提取）：reviews。
 */
import { dbAll, dbGet, dbRun } from '../../core/util.js';
import { dbRecomputeTeacherRating } from '../auth/repo.js';
import { LIMITS, STATUS } from '../../../../server/constants.js';

// ============================================================
// 评价
// ============================================================
export async function dbCreateReview(db, teacherUserId, reviewerUserId, rating, comment) {
  const result = await dbRun(db,
    'INSERT INTO reviews (teacher_user_id,reviewer_user_id,rating,comment) VALUES (?,?,?,?)',
    [teacherUserId, reviewerUserId, rating, comment]);
  return Number(result.meta.last_row_id);
}

export async function dbGetApprovedReviews(db, teacherUserId) {
  // 门控：已注销评价者/被评教师的数据不对外（教师注销后评价行保留留档，但不再经此公开出口）
  return await dbAll(db, `SELECT r.*, u.username as reviewer_name
    FROM reviews r JOIN users u ON r.reviewer_user_id=u.id
    WHERE r.teacher_user_id=? AND r.status='approved'
      AND u.deactivated=0
      AND EXISTS (SELECT 1 FROM users u2 WHERE u2.id=r.teacher_user_id AND u2.deactivated=0)
    ORDER BY r.created_at DESC LIMIT ${LIMITS.REVIEW_LIST_MAX}`,
    [teacherUserId]); // 防全表返回（面板滚动查看；上限单源自 constants.LIMITS）
}

// 某学生对某教师的自有评价（任意状态；「已有评价只能修改」与编辑回填用）
export async function dbGetReviewByPair(db, reviewerUserId, teacherUserId) {
  return await dbGet(db, 'SELECT * FROM reviews WHERE reviewer_user_id=? AND teacher_user_id=?',
    [reviewerUserId, teacherUserId]);
}

// 修改评价：重置为待审核（内容变更须重审）
// 网安审计 N-09：若原评价已通过（评分已计入教师 rating_sum/count），修改时立即摘除旧贡献——
// 否则「通过→改→被管理员拒绝」路径下 wasApproved=false 不再重算，教师评分永久残留旧版本贡献。
// 摘除 = 对本评价落 pending 后重算该教师评分（重算只统计 approved 评价，旧贡献自然出局）。
export async function dbUpdateReview(db, reviewId, rating, comment) {
  const existing = await dbGetReviewById(db, reviewId);
  const teacherUserId = existing && existing.teacher_user_id;
  const wasApproved = !!(existing && existing.status === STATUS.APPROVED);
  await dbRun(db,
    'UPDATE reviews SET rating=?, comment=?, status=\'pending\', reviewed_at=NULL, reviewed_by=NULL WHERE id=?',
    [rating, comment, reviewId]);
  if (wasApproved && teacherUserId) await dbRecomputeTeacherRating(db, teacherUserId);
}

// 签约门槛查询（v1.4.14 用户拍板：联系方式/评价统一按「已签约」开放——signing_request signed 即已签约；
// 文档合同 signed 不作依据（合同是附加保障，与签约状态无关），发起签约过程中（pending）不算。
export async function dbIsContracted(db, studentUserId, teacherUserId) {
  return !!(await dbGet(db,
    `SELECT 1 FROM conversations c
     WHERE c.student_user_id=? AND c.teacher_user_id=?
       AND EXISTS(SELECT 1 FROM signing_requests sr WHERE sr.conversation_id=c.id AND sr.status='signed')
     LIMIT 1`,
    [studentUserId, teacherUserId]));
}

// 管理端评价查询：可按状态 / 教师过滤（评价管理页与教师详情内评价栏共用）
export async function dbGetReviewsAdmin(db, { status, teacherUserId } = {}) {
  let sql = `SELECT r.*, u1.username as reviewer_name, u2.username as teacher_name
    FROM reviews r JOIN users u1 ON r.reviewer_user_id=u1.id JOIN users u2 ON r.teacher_user_id=u2.id`;
  const cond = [], params = [];
  if (status) { cond.push('r.status=?'); params.push(status); }
  if (teacherUserId) { cond.push('r.teacher_user_id=?'); params.push(teacherUserId); }
  if (cond.length) sql += ' WHERE ' + cond.join(' AND ');
  return await dbAll(db, sql + ' ORDER BY r.created_at DESC', params);
}

export async function dbDeleteReview(db, reviewId) {
  await dbRun(db, 'DELETE FROM reviews WHERE id=?', [reviewId]);
}

export async function dbUpdateReviewStatus(db, reviewId, status) {
  await dbRun(db,
    "UPDATE reviews SET status=?, reviewed_at=datetime('now','localtime') WHERE id=?",
    [status, reviewId]);
}

export async function dbGetReviewById(db, reviewId) {
  return await dbGet(db, 'SELECT * FROM reviews WHERE id=?', [reviewId]);
}

async function dbGetApprovedReviewStats(db, teacherUserId) {
  return await dbGet(db, `SELECT COUNT(*) as cnt, COALESCE(SUM(rating),0) as total
    FROM reviews WHERE teacher_user_id=? AND status='approved'`, [teacherUserId]);
}
