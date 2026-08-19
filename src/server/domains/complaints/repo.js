/**
 * 投诉/反馈域数据层（V-1-4 从 server/db.js 提取）：feedbacks / complaints / 候选搜索。
 */
import { dbAll, dbGet, dbRun } from '../../core/util.js';
import { safeJsonArray, safeJsonObject } from '../../core/json.js';
import { likeEscape } from '../posts/repo.js';
import { LIMITS } from '../../../shared/config.js';
import { STATUS } from '../../../shared/enums.js';

// 用户反馈（关于平台模块）
// ============================================================
export async function dbCreateFeedback(db, userId, kind, title, content, subject = '') {
  const res = await dbRun(db,
    'INSERT INTO feedbacks (user_id, kind, title, content, subject) VALUES (?,?,?,?,?)',
    [userId, kind, title, content, subject]);
  return (res && res.meta && res.meta.last_row_id) || 0;
}

// 我的反馈/投诉列表——用户侧状态跟踪闭环（本人可见，无他人数据）
export async function dbGetFeedbacksByUser(db, userId) {
  return await dbAll(db, `SELECT * FROM feedbacks WHERE user_id=? ORDER BY id DESC LIMIT ${LIMITS.FEEDBACK_MINE_MAX}`, [userId]);
}

export async function dbGetFeedbacksAdmin(db, status) {
  // 可选 status 下推过滤（白名单，防注入）；不传则返回全部。
  // feedbacks.status 合法值仅 open/resolved（'pending' 会使「未处理」过滤恒空）——Z-6-F4：字面量走 STATUS
  const where = (status === STATUS.OPEN || status === STATUS.RESOLVED) ? ' WHERE f.status=?' : '';
  const params = where ? [status] : [];
  return await dbAll(db,
    'SELECT f.*, u.username FROM feedbacks f JOIN users u ON u.id = f.user_id' + where + ` ORDER BY f.id DESC LIMIT ${LIMITS.FEEDBACK_ADMIN_MAX}`, params);
}

export async function dbGetFeedbackById(db, feedbackId) {
  return await dbGet(db, 'SELECT * FROM feedbacks WHERE id=?', [feedbackId]);
}

export async function dbResolveFeedback(db, feedbackId) {
  await dbRun(db, `UPDATE feedbacks SET status='resolved' WHERE id=?`, [feedbackId]);
}

// ============================================================
// R22 投诉独立通道（与 feedbacks 分表分通道；仅外层接口接管理员临时通路）
// ============================================================
export async function dbCreateComplaint(db, userId, targetType, targetId, snapshot, reason, detail, attachments = []) {
  const res = await dbRun(db,
    'INSERT INTO complaints (user_id, target_type, target_id, target_snapshot, reason, detail, attachments) VALUES (?,?,?,?,?,?,?)',
    [userId, targetType, targetId, JSON.stringify(snapshot), reason, detail, JSON.stringify(attachments)]);
  return (res && res.meta && res.meta.last_row_id) || 0;
}

// 今日投诉计数（防滥用：COMPLAINT_DAILY_LIMIT/日）
export async function dbCountComplaintsToday(db, userId) {
  const row = await dbGet(db,
    `SELECT COUNT(*) AS c FROM complaints WHERE user_id=? AND date(created_at)=date('now','localtime')`, [userId]);
  return (row && row.c) || 0;
}

// 我的投诉（状态跟踪闭环；target_snapshot 单点反序列化）
export async function dbGetComplaintsByUser(db, userId) {
  const rows = await dbAll(db, `SELECT * FROM complaints WHERE user_id=? ORDER BY id DESC LIMIT ${LIMITS.COMPLAINT_MINE_MAX}`, [userId]);
  return rows.map(mapComplaint);
}

export async function dbGetComplaintsAdmin(db, status) {
  // Z-6-F4：状态字面量走 STATUS（open/resolved）
  const where = (status === STATUS.OPEN || status === STATUS.RESOLVED) ? ' WHERE c.status=?' : '';
  const params = where ? [status] : [];
  const rows = await dbAll(db,
    'SELECT c.*, u.username AS reporter FROM complaints c JOIN users u ON u.id = c.user_id' + where
    + ` ORDER BY c.id DESC LIMIT ${LIMITS.COMPLAINT_ADMIN_MAX}`, params);
  return rows.map(mapComplaint);
}

function mapComplaint(row) {
  return { ...row, target_snapshot: safeJsonObject(row.target_snapshot), attachments: safeJsonArray(row.attachments) };
}

export async function dbGetComplaintById(db, complaintId) {
  const row = await dbGet(db, 'SELECT * FROM complaints WHERE id=?', [complaintId]);
  return row ? mapComplaint(row) : null;
}

export async function dbResolveComplaint(db, complaintId) {
  await dbRun(db, `UPDATE complaints SET status='resolved', resolved_at=datetime('now','localtime') WHERE id=?`, [complaintId]);
}

// —— 投诉对象候选：按角色搜用户（id 精确 / 昵称模糊），排除自己 ——
export async function dbSearchUsersByRole(db, role, q, excludeId, limit = LIMITS.COMPLAINT_CANDIDATE_MAX) {
  const num = /^\d+$/.test(q) ? +q : 0;
  // S2-2（SQLi 审计）：q 中 %/_ 转义字面 + ESCAPE 子句（对齐 dbListPosts）——防 LIKE 通配符注入放大匹配/枚举
  const like = `%${likeEscape(q)}%`;
  return await dbAll(db,
    `SELECT id, username, role FROM users WHERE role=? AND id<>? AND (username LIKE ? ESCAPE '\\' OR (? > 0 AND id = ?))
     ORDER BY id DESC LIMIT ${limit}`, [role, excludeId, like, num, num]);
}

// 最近交互用户（会话另一侧；type='teacher' 对教师 / 'student' 对学生；按最近消息时间排序）
export async function dbRecentInteractions(db, userId, role, limit = LIMITS.COMPLAINT_CANDIDATE_MAX) {
  return await dbAll(db,
    `SELECT u.id, u.username, u.role, MAX(m.created_at) AS last_at
     FROM conversations c
     JOIN users u ON u.id = CASE WHEN c.student_user_id=? THEN c.teacher_user_id ELSE c.student_user_id END
     JOIN messages m ON m.conversation_id = c.id
     WHERE (c.student_user_id=? OR c.teacher_user_id=?) AND u.role=?
     GROUP BY u.id ORDER BY last_at DESC LIMIT ${limit}`,
    [userId, userId, userId, role]);
}

// 帖子候选：按标题模糊 / id 精确
export async function dbSearchPosts(db, q, limit = LIMITS.COMPLAINT_CANDIDATE_MAX) {
  const num = /^\d+$/.test(q) ? +q : 0;
  // S2-2（SQLi 审计）：同 dbSearchUsersByRole——q 中 %/_ 转义字面 + ESCAPE
  const like = `%${likeEscape(q)}%`;
  return await dbAll(db,
    `SELECT id, title, user_id FROM posts WHERE title LIKE ? ESCAPE '\\' OR (? > 0 AND id = ?)
     ORDER BY id DESC LIMIT ${limit}`, [like, num, num]);
}
