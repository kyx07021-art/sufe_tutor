/**
 * Review eligibility gate (S6-R3: new trust model).
 *
 * A student may review a teacher only when all three conditions hold:
 * 1. A conversation exists for the (student, teacher) pair (active or previously closed).
 * 2. The two parties exchanged messages — the student sent >=1 message AND the teacher sent
 * >=1 message, aggregated over all conversations of this pair.
 * 3. The teacher's verification is approved (teacher_verifications.status = 'approved').
 *
 * Self-review is rejected outright before any query runs.
 *
 * This module is the single source of the R3 gate for GET /api/reviews () and the review
 * creation path. It issues only read-only SELECTs against shared tables (conversations /
 * messages / teacher_verifications) and deliberately does NOT import chat/teacher repo
 * internals — cross-domain coupling is avoided by writing the SQL here directly.
 *
 * Messages counted are the user-generated kinds only ('text'|'image'|'file'); system bubbles
 * (contract / signing_request / signing_response) are auto-inserted by flows and do not
 * demonstrate two-way conversation engagement.
 */
import { dbGet } from '../../core/util.js';

// user-generated message kinds that count as "往来消息" (messages exchanged between the parties)
const USER_MESSAGE_KINDS = ['text', 'image', 'file'];

export async function dbCanReview(db, studentUserId, teacherUserId) {
  // Strict identifier validation (C5): malformed ids can never satisfy any condition.
  if (!Number.isInteger(studentUserId) || studentUserId <= 0 ||
      !Number.isInteger(teacherUserId) || teacherUserId <= 0) {
    return { ok: false, reason: 'NO_CONVERSATION' };
  }
  if (studentUserId === teacherUserId) return { ok: false, reason: 'SELF_REVIEW' };

  // Condition 1: a conversation for the pair. conversations is UNIQUE(student, teacher) so at
  // most one row exists; any status (active or closed) counts as "活跃/曾活跃会话".
  const conv = await dbGet(db,
    'SELECT 1 AS x FROM conversations WHERE student_user_id=? AND teacher_user_id=? LIMIT 1',
    [studentUserId, teacherUserId]);
  if (!conv) return { ok: false, reason: 'NO_CONVERSATION' };

  // Condition 2: bidirectional messages. Aggregate sender counts over every conversation of the
  // pair; SUM over an empty set yields one row of NULLs, normalized to 0 below.
  const placeholders = USER_MESSAGE_KINDS.map(() => '?').join(',');
  const cnt = await dbGet(db, `SELECT
      SUM(CASE WHEN m.sender_user_id=? THEN 1 ELSE 0 END) AS student_cnt,
      SUM(CASE WHEN m.sender_user_id=? THEN 1 ELSE 0 END) AS teacher_cnt
    FROM messages m
    JOIN conversations c ON c.id=m.conversation_id
    WHERE c.student_user_id=? AND c.teacher_user_id=?
      AND m.kind IN (${placeholders})`,
    [studentUserId, teacherUserId, studentUserId, teacherUserId, ...USER_MESSAGE_KINDS]);
  const studentCnt = Number(cnt && cnt.student_cnt != null ? cnt.student_cnt : 0);
  const teacherCnt = Number(cnt && cnt.teacher_cnt != null ? cnt.teacher_cnt : 0);
  if (studentCnt < 1 || teacherCnt < 1) return { ok: false, reason: 'NO_BIDIRECTIONAL_MESSAGES' };

  // Condition 3: teacher verification approved.
  const verif = await dbGet(db,
    "SELECT 1 AS x FROM teacher_verifications WHERE user_id=? AND status='approved' LIMIT 1",
    [teacherUserId]);
  if (!verif) return { ok: false, reason: 'TEACHER_NOT_VERIFIED' };

  return { ok: true };
}
