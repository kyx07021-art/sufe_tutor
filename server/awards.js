/**
 * 教师荣誉奖项模块（自持表域 + 接口，同 signing.js 模式；db.js 仅借 init 建表）
 *
 * 契约（调研口径：家教平台资质「先审后展示」通行模式，同教师学籍认证 verified 先例）：
 *   - 教师提交奖项（名称/颁发机构/获奖时间/奖状图片证明）→ 状态 pending；
 *   - 奖状图片复用 uploads 暂存链（加密落库），提交时校验 uploadId 归属本人且为 image；
 *   - 管理员人工审核 approve/reject（危险操作，须 capToken 二次认证 + 禁止审核管理员自身数据
 *     之外的任何越权——只审 pending）；审核后通知作者（含驳回理由）+ 留档；
 *   - 公开出口（教师卡片/资料右栏）只下发 approved；本人视角可见全部状态；
 *   - 每教师奖项上限 AWARDS_MAX 条（防刷）；删除奖项连带删除奖状 upload（防证明图泄漏）。
 */
import { dbAll, dbGet, dbRun, json, error } from './util.js';
import { requireUser, requireAdmin } from './security.js';
import { confirmDangerOtp } from './danger-ops.js';
import { notifyUser } from './notify.js';
import { logEvent } from './log.js';
import { MSG, LIMITS } from './constants.js';
import { dbGetUpload, dbDeleteUpload } from './db.js';
import { decryptField } from './crypto.js'; // 奖状证明解密读取（管理员审核出口）
import '../constants.js'; // 用户可见文案统一走 globalThis.APP_CONSTANTS.UI

const UIC = globalThis.APP_CONSTANTS.UI;

// 奖项字段上限（与前端 maxlength 同源）
const AWARD_TITLE_MAX = 60;   // 奖项名称
const AWARD_ISSUER_MAX = 60;  // 颁发机构
const AWARDS_MAX = 10;        // 每教师奖项条数上限
const AWARD_DATE_RE = /^(?:\d{4}(?:-\d{2})?)?$/; // 空 | YYYY | YYYY-MM

export const AWARD_STATUS = { PENDING: 'pending', APPROVED: 'approved', REJECTED: 'rejected' };

// ============================================================
// 建表（幂等；表域自持）
// ============================================================
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
    created_at DATETIME DEFAULT (datetime('now','localtime')),
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
    ? `SELECT id, title, issuer, award_date, status FROM teacher_awards
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

// ============================================================
// 接口
// ============================================================
/** POST /api/teacher/awards —— 教师提交奖项（含奖状证明 uploadId） */
export async function handleCreateAward(db, body, req) {
  const { user: me, err } = await requireUser(db, req, 'teacher');
  if (err) return err;
  const title = String(body.title || '').trim().slice(0, AWARD_TITLE_MAX);
  const issuer = String(body.issuer || '').trim().slice(0, AWARD_ISSUER_MAX);
  const awardDate = String(body.awardDate || '').trim();
  if (!title) return error(MSG.AWARD_TITLE_REQUIRED);
  if (awardDate && !AWARD_DATE_RE.test(awardDate)) return error(MSG.AWARD_DATE_INVALID);
  // 奖状证明必填（用户需求「需上传奖状证明」）：uploadId 归属本人 + 图片类（走 uploads 暂存链加密落库）
  const pid = parseInt(body.proofUploadId, 10);
  if (!Number.isInteger(pid) || pid <= 0) return error(MSG.AWARD_PROOF_REQUIRED);
  const up = await dbGetUpload(db, pid);
  if (!up || up.user_id !== me.id) return error(MSG.AWARD_PROOF_REQUIRED);
  if (up.kind !== 'image') return error(MSG.AWARD_PROOF_REQUIRED);
  // 条数上限（防刷；先查后插，唯一性无强约束，超限窗口可容忍）
  if ((await dbCountAwardsByTeacher(db, me.id)) >= AWARDS_MAX) return error(MSG.AWARD_LIMIT_REACHED, 400);
  const id = await dbCreateAward(db, me.id, { title, issuer, awardDate, proofUploadId: pid });
  if (!id) return error(MSG.SERVER_ERROR, 500);
  await logEvent(db, { action: 'award.create', actorUserId: me.id, actorUsername: me.username,
    actorRole: 'teacher', entity: 'award', entityId: id, detail: { title, proofUploadId: pid }, req });
  return json({ id, message: MSG.AWARD_SUBMITTED }, 201);
}

/** GET /api/teacher/awards?userId= —— 缺省本人全量；他人视角仅 approved（教师卡片/资料右栏公开出口） */
export async function handleGetAwards(db, url, req) {
  const uidParam = parseInt(url.searchParams.get('userId'), 10);
  if (Number.isInteger(uidParam) && uidParam > 0) {
    return json({ awards: await dbGetAwardsByTeacher(db, uidParam, { publicOnly: true }) });
  }
  const { user: me, err } = await requireUser(db, req, 'teacher');
  if (err) return err;
  return json({ awards: await dbGetAwardsByTeacher(db, me.id) });
}

/** DELETE /api/teacher/awards/:id —— 本人删除（连带删除奖状 upload，防证明图滞留泄漏） */
export async function handleDeleteAward(db, awardId, body, req) {
  const { user: me, err } = await requireUser(db, req, 'teacher');
  if (err) return err;
  const a = await dbGetAwardById(db, awardId);
  if (!a) return error(MSG.AWARD_NOT_FOUND, 404);
  if (a.teacher_user_id !== me.id) return error(MSG.NO_PERMISSION, 403);
  await dbDeleteAward(db, awardId);
  if (a.proof_upload_id) await dbDeleteUpload(db, a.proof_upload_id);
  await logEvent(db, { action: 'award.delete', actorUserId: me.id, actorUsername: me.username,
    actorRole: 'teacher', entity: 'award', entityId: awardId, req });
  return json({ ok: true });
}

/** GET /api/admin/awards/:id/proof —— 奖状证明解密读取（管理员审核用；仅此一个读取出口） */
export async function handleAdminAwardProof(db, awardId, req) {
  const { err } = await requireAdmin(db, req);
  if (err) return err;
  const a = await dbGetAwardById(db, awardId);
  if (!a || !a.proof_upload_id) return error(MSG.AWARD_NOT_FOUND, 404);
  const up = await dbGetUpload(db, a.proof_upload_id);
  if (!up) return error(MSG.AWARD_NOT_FOUND, 404);
  const body = await decryptField(up.body);
  return json({ dataUrl: body, name: up.name });
}

/** GET /api/admin/awards?status= —— 管理员审核队列 */
export async function handleAdminAwards(db, url, req) {
  const { err } = await requireAdmin(db, req);
  if (err) return err;
  return json({ awards: await dbGetAwardsAdmin(db, url.searchParams.get('status') || '') });
}

/** POST /api/admin/awards/:id/action { action:'approve'|'reject', note } —— 人工审核（危险操作二次认证） */
export async function handleAdminAwardAction(db, awardId, body, req) {
  const { admin, err } = await requireAdmin(db, req);
  if (err) return err;
  const action = body.action;
  if (!['approve', 'reject'].includes(action)) return error(MSG.INVALID_PARAMS);
  const note = String(body.note || '').trim().slice(0, 200);
  if (action === 'reject' && !note) return error(MSG.AWARD_REJECT_NOTE_REQUIRED);
  const a = await dbGetAwardById(db, awardId);
  if (!a) return error(MSG.AWARD_NOT_FOUND, 404);
  // 危险操作（审核结果不可逆）须 capToken 二次认证（同封禁/处罚口径）
  if (!(await confirmDangerOtp(db, req, body))) return error(MSG.REAUTH_FAILED, 403);
  const status = action === 'approve' ? AWARD_STATUS.APPROVED : AWARD_STATUS.REJECTED;
  if (!(await dbSetAwardStatus(db, awardId, status, note))) return error(MSG.AWARD_STATE_INVALID, 409); // 非 pending（已审/并发双审）
  await notifyUser(db, a.teacher_user_id,
    action === 'approve' ? UIC.AWARD_APPROVED_NOTIFY.replace('{title}', a.title) : UIC.AWARD_REJECTED_NOTIFY.replace('{title}', a.title));
  await logEvent(db, { action: `award.${action}`, actorUserId: admin.id, actorUsername: admin.username,
    actorRole: 'admin', entity: 'award', entityId: awardId,
    detail: { targetTeacher: a.teacher_user_id, title: a.title, note }, req });
  return json({ ok: true, message: action === 'approve' ? MSG.AWARD_APPROVED : MSG.AWARD_REJECTED });
}
