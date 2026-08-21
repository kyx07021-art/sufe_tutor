/**
 * 奖项域数据层（V-1-4 提取）：teacher_awards。
 */
import { dbAll, dbGet, dbRun } from '../../core/util.js';
import { LIMITS } from '../../../shared/config.js';
import { STATUS, AWARD_STATUS } from '../../../shared/enums.js'; // Z-16-F4：AWARD_STATUS 单源 shared/enums，本地定义删除

// Z-16-F3：限额真源 LIMITS（shared/config.js，规则 41），re-export 保 api.js 既有接口
export const AWARD_TITLE_MAX = LIMITS.AWARD_TITLE_MAX;
export const AWARD_ISSUER_MAX = LIMITS.AWARD_ISSUER_MAX;
export const AWARDS_MAX = LIMITS.AWARDS_MAX;
export const AWARD_DATE_RE = /^(?:\d{4}(?:-\d{2})?)?$/;
export { AWARD_STATUS }; // 单源 shared/enums.js，re-export 保 api.js 既有接口（Z-16-F4）

export async function initAwardsTable(db) {
  await dbRun(db, `CREATE TABLE IF NOT EXISTS teacher_awards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    teacher_user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    issuer TEXT NOT NULL DEFAULT '',
    award_date TEXT NOT NULL DEFAULT '',
    proof_upload_id INTEGER,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
    admin_note TEXT NOT NULL DEFAULT '',
    created_at DATETIME DEFAULT (datetime('now')),
    FOREIGN KEY (teacher_user_id) REFERENCES users(id) ON DELETE CASCADE)`);
  await dbRun(db, 'CREATE INDEX IF NOT EXISTS idx_awards_teacher ON teacher_awards(teacher_user_id, id)');
  await dbRun(db, 'CREATE INDEX IF NOT EXISTS idx_awards_status ON teacher_awards(status, id)');
}

// ============================================================
// 数据层
// ============================================================
export async function dbCreateAward(db, teacherUserId, { title, issuer, awardDate, proofUploadId }) {
  const r = await dbRun(db,
    `INSERT INTO teacher_awards (teacher_user_id, title, issuer, award_date, proof_upload_id)
     VALUES (?, ?, ?, ?, ?)`, [teacherUserId, title, issuer, awardDate, proofUploadId]);
  return (r && r.meta && r.meta.changes > 0) ? Number(r.meta.last_row_id) : 0;
}

export async function dbCountAwardsByTeacher(db, teacherUserId) {
  const r = await dbGet(db, 'SELECT COUNT(*) AS c FROM teacher_awards WHERE teacher_user_id=?', [teacherUserId]);
  return r ? r.c : 0;
}

export async function dbGetAwardById(db, id) {
  return await dbGet(db, 'SELECT * FROM teacher_awards WHERE id=?', [id]);
}

/** 某教师奖项：本人/管理员视角全量；公开视角仅 approved */
export async function dbGetAwardsByTeacher(db, teacherUserId, { publicOnly = false } = {}) {
  return await dbAll(db, publicOnly
    ? `SELECT id, title, issuer, award_date FROM teacher_awards
       WHERE teacher_user_id=? AND status='approved' ORDER BY id DESC`
    : `SELECT id, title, issuer, award_date, proof_upload_id, status, admin_note, created_at
       FROM teacher_awards WHERE teacher_user_id=? ORDER BY id DESC`, [teacherUserId]);
}

/** 管理员审核队列（status 过滤白名单：pending/approved/rejected 或全部） */
export async function dbGetAwardsAdmin(db, status) {
  const s = status || '';
  if (!['', ...Object.values(AWARD_STATUS)].includes(s)) return [];
  return await dbAll(db, s
    ? `SELECT a.*, u.username AS teacher_username FROM teacher_awards a
       LEFT JOIN users u ON u.id=a.teacher_user_id WHERE a.status=? ORDER BY a.id ASC`
    : `SELECT a.*, u.username AS teacher_username FROM teacher_awards a
       LEFT JOIN users u ON u.id=a.teacher_user_id ORDER BY a.id ASC`, s ? [s] : []);
}

export async function dbDeleteAward(db, id) {
  await dbRun(db, 'DELETE FROM teacher_awards WHERE id=?', [id]);
}

/** 审核落态（条件 UPDATE：仅 pending 可审，赢家模式防并发双审） */
export async function dbSetAwardStatus(db, id, status, note) {
  const r = await dbRun(db,
    `UPDATE teacher_awards SET status=?, admin_note=? WHERE id=? AND status='pending'`,
    [status, note, id]);
  return !!(r && r.meta && r.meta.changes > 0);
}

