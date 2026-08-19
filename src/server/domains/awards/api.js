import { json, errorMsg, parseIdParam } from '../../core/util.js';
import { requireUser, requireAdmin } from '../../core/security.js';
import { confirmDangerOtp } from '../../core/danger-ops.js';
import { notifyUser } from '../../core/notify.js';
import { logEvent } from '../../core/log.js';
import { MSG } from '../../../shared/codes.js';
import { dbGetUpload, dbDeleteUpload } from '../../../../server/db.js';
import { decryptField } from '../../core/crypto.js';

import { initAwardsTable, dbCreateAward, dbCountAwardsByTeacher, dbGetAwardById, dbGetAwardsByTeacher, dbGetAwardsAdmin, dbDeleteAward, dbSetAwardStatus, AWARDS_MAX, AWARD_STATUS, AWARD_TITLE_MAX, AWARD_ISSUER_MAX, AWARD_DATE_RE } from './repo.js';
export { initAwardsTable, dbCreateAward, dbCountAwardsByTeacher, dbGetAwardById, dbGetAwardsByTeacher, dbGetAwardsAdmin, dbDeleteAward, dbSetAwardStatus, AWARD_STATUS };

export async function handleCreateAward(db, body, req) {
  const { user: me, err } = await requireUser(db, req, 'teacher');
  if (err) return err;
  const title = String(body.title || '').trim().slice(0, AWARD_TITLE_MAX);
  const issuer = String(body.issuer || '').trim().slice(0, AWARD_ISSUER_MAX);
  const awardDate = String(body.awardDate || '').trim();
  if (!title) return errorMsg('AWARD_TITLE_REQUIRED');
  if (awardDate && !AWARD_DATE_RE.test(awardDate)) return errorMsg('AWARD_DATE_INVALID');
  // 奖状证明必填（用户需求「需上传奖状证明」）：uploadId 归属本人 + 图片类（走 uploads 暂存链加密落库）
  const pid = parseInt(body.proofUploadId, 10);
  if (!Number.isInteger(pid) || pid <= 0) return errorMsg('AWARD_PROOF_REQUIRED');
  const up = await dbGetUpload(db, pid);
  if (!up || up.user_id !== me.id) return errorMsg('AWARD_PROOF_REQUIRED');
  if (up.kind !== 'image') return errorMsg('AWARD_PROOF_REQUIRED');
  // 条数上限（防刷；先查后插，唯一性无强约束，超限窗口可容忍）
  if ((await dbCountAwardsByTeacher(db, me.id)) >= AWARDS_MAX) return errorMsg('AWARD_LIMIT_REACHED', 400);
  const id = await dbCreateAward(db, me.id, { title, issuer, awardDate, proofUploadId: pid });
  if (!id) return errorMsg('SERVER_ERROR', 500);
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
  if (!a) return errorMsg('AWARD_NOT_FOUND', 404);
  if (a.teacher_user_id !== me.id) return errorMsg('NO_PERMISSION', 403);
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
  if (!a || !a.proof_upload_id) return errorMsg('AWARD_NOT_FOUND', 404);
  const up = await dbGetUpload(db, a.proof_upload_id);
  if (!up) return errorMsg('AWARD_NOT_FOUND', 404);
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
  if (!['approve', 'reject'].includes(action)) return errorMsg('INVALID_PARAMS');
  const note = String(body.note || '').trim().slice(0, 200);
  if (action === 'reject' && !note) return errorMsg('AWARD_REJECT_NOTE_REQUIRED');
  const a = await dbGetAwardById(db, awardId);
  if (!a) return errorMsg('AWARD_NOT_FOUND', 404);
  // 危险操作（审核结果不可逆）须 capToken 二次认证（同封禁/处罚口径）
  if (!(await confirmDangerOtp(db, req, body))) return errorMsg('REAUTH_FAILED', 403);
  const status = action === 'approve' ? AWARD_STATUS.APPROVED : AWARD_STATUS.REJECTED;
  if (!(await dbSetAwardStatus(db, awardId, status, note))) return errorMsg('AWARD_STATE_INVALID', 409); // 非 pending（已审/并发双审）
  await notifyUser(db, a.teacher_user_id,
    action === 'approve' ? 'AWARD_APPROVED' : 'AWARD_REJECTED', { title: a.title });
  await logEvent(db, { action: `award.${action}`, actorUserId: admin.id, actorUsername: admin.username,
    actorRole: 'admin', entity: 'award', entityId: awardId,
    detail: { targetTeacher: a.teacher_user_id, title: a.title, note }, req });
  return json({ ok: true, message: action === 'approve' ? MSG.AWARD_APPROVED : MSG.AWARD_REJECTED });
}

// ============================================================
// awards 域路由表（V-1-4c）
// ============================================================
const S = (method, path, handler) => ({ method, path, handler });
export const routes = [
  S('POST', '/api/teacher/awards', c => handleCreateAward(c.db, c.body, c.req)),
  S('GET', '/api/teacher/awards', c => handleGetAwards(c.db, c.url, c.req)),
  S('DELETE', '/api/teacher/awards/:id', c => handleDeleteAward(c.db, parseIdParam(c.params.id), c.body, c.req)),
  S('GET', '/api/admin/awards', c => handleAdminAwards(c.db, c.url, c.req)),
  S('GET', '/api/admin/awards/:id/proof', c => handleAdminAwardProof(c.db, parseIdParam(c.params.id), c.req)),
  S('POST', '/api/admin/awards/:id/action', c => handleAdminAwardAction(c.db, parseIdParam(c.params.id), c.body, c.req)),
];
