/**
 * 内容审核/管理统一接口（D1/D2）—— 为未来审核者配备的「一声令下看所有、一声令下处罚」通道
 *
 * D1 统一提取 GET /api/admin/content：逐表抓出全部用户可操作内容，归拢统一结构
 *   { type, id, author:{id,username,role}, title, body, status, created_at, extra }。
 *   增量改造：只新增查询出口，不改变现有内容流转；私密字段（联系方式/附件本体）不提取。
 * D2 统一处罚 POST /api/admin/content/:type/:id/action { action, reason, rule }：
 *   action ∈ delete（删除内容）/ remove（下架语义，当前同 delete）/ ban（封禁作者）。
 *   处罚后自动通知作者（详细原因 + 触犯规则 + 触发内容摘要），处罚留档。
 *   审核者权限管理未来再说（当前 requireAdmin，与现有管理端同权）。
 */
import { json, error } from '../src/server/core/util.js';
import { requireAdmin } from '../src/server/core/security.js';
import { MSG, LIMITS } from './constants.js';
import { notifyUser } from '../src/server/core/notify.js';
import { logEvent } from '../src/server/core/log.js';
import { confirmDangerOtp } from '../src/server/core/danger-ops.js'; // 处罚（删除/封禁）危险操作二次认证（同注销/签约口径）
import {
  dbGetAllContentAdmin, dbGetPostById, dbGetDemandById, dbGetReviewById, dbGetMessageById,
  dbGetFeedbackById, dbGetComplaintById, dbGetUpload, dbGetUserById, dbGetTeacherProfile,
  dbGetContractById, dbGetSigningById,
  dbDeletePost, dbAdminForceDeleteDemand, dbDeleteReview, dbDeleteMessage,
  dbDeleteFeedback, dbDeleteComplaint, dbDeleteUpload, dbDeleteContract, dbDeleteSigning,
  dbSetUserBanned,
} from './db.js';

const TYPE_LABEL = {
  post: '帖子', demand: '需求', teacher: '教师档案', review: '评价',
  message: '聊天消息', feedback: '反馈', complaint: '投诉', upload: '附件',
  contract: '合同', signing: '签约请求',
};

// 处罚通知三段截断预算（reason+rule+summary + 模板开销 ≤ NOTIF_TEXT_MAX=200）
const PENALTY_REASON_MAX = 80;
const PENALTY_RULE_MAX = 30;
const PENALTY_SUMMARY_MAX = 40;

// ============================================================
// D1 统一内容提取
// ============================================================
// GET /api/admin/content?type=post|demand|teacher|review|message|feedback|complaint|upload
export async function handleAdminContent(db, url, req) {
  const { admin, err } = await requireAdmin(db, req);
  if (err) return err;
  const type = url.searchParams.get('type') || null;
  const items = await dbGetAllContentAdmin(db, { type });
  await logEvent(db, { action: 'admin.content.list', actorUserId: admin.id, actorUsername: admin.username,
    actorRole: 'admin', entity: 'content', detail: { type: type || 'all', count: items.length }, req });
  return json({ items });
}

// ============================================================
// D2 统一内容管理处罚
// ============================================================
// POST /api/admin/content/:type/:id/action { action, reason, rule }
export async function handleContentAction(db, type, id, body, req) {
  const { admin, err } = await requireAdmin(db, req);
  if (err) return err;
  const action = body.action;
  // 三段截断预算：reason/rule/summary 分预算，总长钉在 NOTIF_TEXT_MAX 内（单字段取满上限会组合超限被库层截断丢内容）
  const reason = String(body.reason || '').trim().slice(0, PENALTY_REASON_MAX);
  const rule = String(body.rule || '').trim().slice(0, PENALTY_RULE_MAX);
  if (!['delete', 'remove', 'ban'].includes(action)) return error(MSG.INVALID_PARAMS);
  if (!reason) return error(MSG.PENALTY_REASON_REQUIRED);
  // teacher 档案无硬删分支（doDeleteContent 跳过）——API 直发 delete/remove 直接拒绝，
  // 防「no-op 却回成功 + 发'移除内容'通知」的误导文案（UI 层已只给封禁）
  if (type === 'teacher' && action !== 'ban') return error(MSG.INVALID_PARAMS);
  const label = TYPE_LABEL[type] || type;

  // 定位目标内容 + 作者（按类型取快照摘要，供处罚通知展示触发内容）
  let authorId = null, summary = '';
  switch (type) {
    case 'post': { const p = await dbGetPostById(db, id); if (!p) return error(MSG.POST_NOT_FOUND, 404); authorId = p.user_id; summary = `${p.title || ''} ${p.body_md || ''}`; break; }
    case 'demand': { const d = await dbGetDemandById(db, id); if (!d) return error(MSG.DEMAND_NOT_FOUND, 404); authorId = d.user_id; summary = String(d.additional_info || d.address || ''); break; }
    case 'teacher': { const t = await dbGetTeacherProfile(db, id); if (!t) return error(MSG.USER_NOT_FOUND, 404); authorId = id; summary = `${t.intro || ''} ${t.address || ''} ${t.school || ''}`; break; }
    case 'review': { const r = await dbGetReviewById(db, id); if (!r) return error(MSG.REVIEW_NOT_FOUND, 404); authorId = r.reviewer_user_id; summary = r.comment || ''; break; }
    case 'message': { const m = await dbGetMessageById(db, id); if (!m) return error(MSG.MESSAGE_NOT_FOUND, 404); authorId = m.sender_user_id; summary = m.body || m.name || ''; break; }
    case 'feedback': { const f = await dbGetFeedbackById(db, id); if (!f) return error(MSG.FEEDBACK_NOT_FOUND, 404); authorId = f.user_id; summary = `${f.title || ''} ${f.content || ''}`; break; }
    case 'complaint': { const c = await dbGetComplaintById(db, id); if (!c) return error(MSG.COMPLAINT_NOT_FOUND, 404); authorId = c.user_id; summary = `${c.reason || ''} ${c.detail || ''}`; break; }
    case 'upload': { const o = await dbGetUpload(db, id); if (!o) return error(MSG.INVALID_PARAMS, 404); authorId = o.user_id; summary = o.name || ''; break; }
    case 'contract': { const c = await dbGetContractById(db, id); if (!c) return error(MSG.CONTRACT_NOT_FOUND, 404); authorId = c.drafter_user_id; summary = `${c.plan || ''} ${c.schedule || ''}`; break; }
    case 'signing': { const s = await dbGetSigningById(db, id); if (!s) return error(MSG.CONTRACT_NOT_FOUND, 404); authorId = s.initiator_user_id; summary = `${s.price > 0 ? s.price + ' 元/时 ' : ''}${s.schedule || ''} ${s.method || ''}`; break; }
    default: return error(MSG.INVALID_PARAMS);
  }
  if (!authorId) return error(MSG.USER_NOT_FOUND, 404);
  const author = await dbGetUserById(db, authorId);
  const authorName = author ? author.username : `用户#${authorId}`;
  // 处罚 = 危险操作（删除/封禁不可逆），须 capToken 二次认证；且不得处罚管理员账户
  if (!(await confirmDangerOtp(db, req, body))) return error(MSG.REAUTH_FAILED, 403);
  if (author && author.role === 'admin') return error(MSG.NO_PERMISSION, 403);

  // 执行处罚（teacher 档案不硬删——ban 作者即可；其余类型删除/下架）
  if (type !== 'teacher' && (action === 'delete' || action === 'remove')) {
    await doDeleteContent(db, type, id);
  }
  if (action === 'ban') await dbSetUserBanned(db, authorId, 1);

  // 处罚后自动通知作者：详细原因 + 触犯规则 + 触发内容摘要（截断）
  const summaryClip = String(summary || '').slice(0, PENALTY_SUMMARY_MAX);
  const punish = action === 'ban' ? '封禁账户' : '移除内容';
  const notifText = `你的${label}因违反规则「${rule || '平台规则'}」被管理员${punish}。原因：${reason}${summaryClip ? `。触发内容：${summaryClip}` : ''}`;
  await notifyUser(db, authorId, notifText);

  await logEvent(db, { action: 'admin.content.action', actorUserId: admin.id, actorUsername: admin.username,
    actorRole: 'admin', entity: type, entityId: id,
    detail: { action, reason, rule, targetAuthor: authorName, targetUserId: authorId }, req });
  return json({ ok: true, message: `已${punish}${label}` });
}

/** 按类型删除内容（数据层 mapper 单点；teacher 无硬删分支） */
async function doDeleteContent(db, type, id) {
  switch (type) {
    case 'post': await dbDeletePost(db, id); break;
    case 'demand': await dbAdminForceDeleteDemand(db, id); break;
    case 'review': await dbDeleteReview(db, id); break;
    case 'message': await dbDeleteMessage(db, id); break;
    case 'feedback': await dbDeleteFeedback(db, id); break;
    case 'complaint': await dbDeleteComplaint(db, id); break;
    case 'upload': await dbDeleteUpload(db, id); break;
    case 'contract': await dbDeleteContract(db, id); break;
    case 'signing': await dbDeleteSigning(db, id); break;
  }
}
