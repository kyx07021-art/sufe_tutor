/**
 * 路由模块：投诉独立通道（R22）
 *
 * 与用户反馈（/api/feedbacks）分表分通道、独立浮窗组件；仅外层接口接管理员临时通路。
 * 参考正规平台举报流程（调研收敛）：选择具体对象（教师/学生/帖子，候选支持 id/昵称搜索 +
 * 最近交互拉取）→ 预设理由 → 补充描述 → 确认提交；服务端快照被投诉对象防删后失标、
 * 自投诉拦截、每日限额防滥用；管理员可查看/标记处理并通知投诉人；用户可跟踪「我的投诉」。
 *
 * 端点：
 *   POST /api/complaints { targetType, targetId, reason, detail } —— 提交投诉（requireUser）
 *   GET  /api/complaints/mine —— 我的投诉（状态跟踪）
 *   GET  /api/complaints/candidates?target=teacher|student|post&q= —— 对象候选搜索
 *   GET  /api/complaints/recent?target=teacher|student —— 最近交互用户
 *   GET  /api/complaints —— 管理员查看（status 可选过滤）
 *   POST /api/complaints/:id/resolve —— 管理员标记已处理并通知投诉人
 */
import { json, errorMsg } from '../../core/util.js';
import { requireUser, requireAdmin } from '../../core/security.js';
import { SERVER_TEXT } from '../../../shared/codes.js';
import { STATUS } from '../../../shared/enums.js';
import { LIMITS } from '../../../shared/config.js';
import {
  dbCreateComplaint, dbCountComplaintsToday, dbGetComplaintsByUser, dbGetComplaintsAdmin,
  dbGetComplaintById, dbResolveComplaint, dbSearchUsersByRole, dbRecentInteractions, dbSearchPosts,
  dbGetUserById, dbGetPostById, dbGetUpload, dbGetUploads, dbDeleteUpload,
  dbCreateFeedback, dbGetFeedbacksByUser, dbGetFeedbacksAdmin, dbGetFeedbackById, dbResolveFeedback,
} from '../../../../server/db.js';
import { decryptField } from '../../core/crypto.js'; // U11：投诉附件密文出门解密（与聊天附件同口径）
import { logEvent } from '../../core/log.js';
import { notifyUser } from '../../core/notify.js';

const TARGET_TYPES = ['teacher', 'student', 'post'];

/** 解析被投诉对象并生成展示快照；对象不存在 → null */
async function resolveTarget(db, type, id) {
  if (type === 'teacher' || type === 'student') {
    const u = await dbGetUserById(db, id);
    if (!u || u.role !== type) return null;
    return { id: u.id, name: u.username, subtitle: type === 'teacher' ? '教师' : '学生', role: u.role };
  }
  const p = await dbGetPostById(db, id);
  if (!p) return null;
  const author = await dbGetUserById(db, p.user_id);
  return { id: p.id, name: p.title, subtitle: author ? `帖子 · ${author.username}` : '帖子', authorId: p.user_id };
}

// POST /api/complaints —— 提交投诉（对象必选、理由白名单、自投诉拦截、每日限额）
// U11：body.uploadIds 可选——附件已在 /api/uploads 暂存（前端复用聊天暂存区上传），
// 提交时从暂存复制密文入投诉（与聊天发送同口径），复制成功后删暂存（残留由 STALE_UPLOAD_WINDOW 兜底）。
export async function handleCreateComplaint(db, body, req) {
  const { user: me, err } = await requireUser(db, req);
  if (err) return err;
  const targetType = body.targetType;
  if (!TARGET_TYPES.includes(targetType)) return errorMsg('COMPLAINT_TARGET_REQUIRED', 400);
  const targetId = Number(body.targetId);
  if (!Number.isInteger(targetId) || targetId <= 0) return errorMsg('COMPLAINT_TARGET_REQUIRED', 400);

  const reasons = SERVER_TEXT.COMPLAINT_REASONS || [];
  const reason = String(body.reason || '').trim();
  if (!reasons.includes(reason)) return errorMsg('COMPLAINT_REASON_REQUIRED', 400);
  const detail = String(body.detail || '').trim().slice(0, LIMITS.COMPLAINT_DETAIL_MAX);

  // 附件：数量钳制 + 归属校验（仅本人暂存可复制，防借 id 搬运他人附件）
  // 逐条 dbGetUpload → dbGetUploads 单查（WHERE IN，N 往返 → 1）
  const uploadIds = Array.isArray(body.uploadIds)
    ? [...new Set(body.uploadIds.map(Number).filter(Number.isInteger))] // 审计 C-5：Set 去重（[1,1,1,1] 不再复制 4 份同附件）
    : [];
  if (uploadIds.length > LIMITS.COMPLAINT_ATTACH_MAX) return errorMsg('COMPLAINT_ATTACH_TOO_MANY', 400);
  const attachments = [];
  const uploadRows = uploadIds.length ? await dbGetUploads(db, uploadIds) : [];
  const uploadById = new Map(uploadRows.map(u => [u.id, u]));
  for (const id of uploadIds) {
    const up = uploadById.get(id);
    if (!up || up.user_id !== me.id) return errorMsg('COMPLAINT_ATTACH_NOT_FOUND', 400);
    attachments.push({ kind: up.kind, name: up.name, body: up.body, thumb: up.thumb || '' });
  }

  const target = await resolveTarget(db, targetType, targetId);
  if (!target) return errorMsg('COMPLAINT_TARGET_NOT_FOUND', 404);
  // 不能投诉自己：用户类型比对本人 id；帖子比对作者 id（resolveTarget 快照已带 authorId）
  const selfId = targetType === 'post' ? target.authorId : target.id;
  if (selfId === me.id) return errorMsg('COMPLAINT_SELF_FORBIDDEN', 400);

  const today = await dbCountComplaintsToday(db, me.id);
  if (today >= LIMITS.COMPLAINT_DAILY_LIMIT) return errorMsg('COMPLAINT_DAILY_LIMIT', 429);

  const complaintId = await dbCreateComplaint(db, me.id, targetType, targetId, target, reason, detail, attachments);
  // 复制成功即删暂存（best-effort：删失败由 30 分钟清理窗口兜底，不留孤儿大字段）
  await Promise.all(uploadIds.map(id => dbDeleteUpload(db, id).catch(() => {})));
  await logEvent(db, { action: 'complaint.create', actorUserId: me.id, entity: 'complaint',
    entityId: complaintId, detail: { targetType, targetId, reason, len: detail.length, attachCount: attachments.length }, req });
  return json({ ok: true }, 201);
}

// U11：投诉附件缩略图出门解密（小字段随列表；body 本体大字段懒加载走 /attachment 接口，与聊天列表同口径）
async function decryptComplaintAttachments(list) {
  for (const c of list) {
    for (const a of (c.attachments || [])) {
      if (a.thumb) { try { a.thumb = await decryptField(a.thumb); } catch { a.thumb = ''; } }
      a.body = ''; // 列表不下发本体
    }
  }
  return list;
}

// GET /api/complaints/mine —— 我的投诉（状态跟踪闭环）
export async function handleMyComplaints(db, req) {
  const { user: me, err } = await requireUser(db, req);
  if (err) return err;
  return json({ complaints: await decryptComplaintAttachments(await dbGetComplaintsByUser(db, me.id)) });
}

// GET /api/complaints/candidates?target=teacher|student|post&q= —— 对象候选搜索（id 精确 / 昵称/标题模糊）
export async function handleComplaintCandidates(db, url, req) {
  const { user: me, err } = await requireUser(db, req);
  if (err) return err;
  const target = url.searchParams.get('target') || '';
  const q = (url.searchParams.get('q') || '').trim();
  let candidates = [];
  if (target === 'teacher' || target === 'student') {
    candidates = await dbSearchUsersByRole(db, target, q, me.id);
  } else if (target === 'post') {
    candidates = await dbSearchPosts(db, q);
  }
  return json({ candidates: candidates.map(c => ({ id: c.id, name: c.username != null ? c.username : c.title, subtitle: target === 'post' ? `帖子${c.id} · ${(c.title || '').slice(0, 24)}` : (c.role === 'teacher' ? '教师' : '学生'), role: c.role })) });
}

// GET /api/complaints/recent?target=teacher|student —— 最近交互用户（候选快捷选取）
export async function handleComplaintRecent(db, url, req) {
  const { user: me, err } = await requireUser(db, req);
  if (err) return err;
  const target = url.searchParams.get('target') || '';
  if (target !== 'teacher' && target !== 'student') return json({ candidates: [] });
  const users = await dbRecentInteractions(db, me.id, target);
  return json({ candidates: users.map(u => ({ id: u.id, name: u.username, subtitle: target === 'teacher' ? '教师' : '学生', role: u.role })) });
}

// GET /api/complaints —— 管理员查看（status 可选过滤）
export async function handleAdminComplaints(db, url, req) {
  const { err } = await requireAdmin(db, req);
  if (err) return err;
  const complaints = await dbGetComplaintsAdmin(db, url.searchParams.get('status') || '');
  return json({ complaints: await decryptComplaintAttachments(complaints) });
}

// GET /api/complaints/:id/attachment?idx=N —— 投诉附件懒加载（投诉人本人或管理员；与聊天附件同款懒加载模式）
export async function handleComplaintAttachment(db, complaintId, url, req) {
  const { user: me, err } = await requireUser(db, req);
  if (err) return err;
  const c = await dbGetComplaintById(db, complaintId);
  if (!c) return errorMsg('COMPLAINT_NOT_FOUND', 404);
  if (c.user_id !== me.id && me.role !== 'admin') return errorMsg('NO_PERMISSION', 403);
  const idx = parseInt(url.searchParams.get('idx')) || 0;
  const a = (c.attachments || [])[idx];
  if (!a) return errorMsg('COMPLAINT_ATTACH_NOT_FOUND', 404);
  return json({ kind: a.kind, name: a.name, body: await decryptField(a.body) }); // N-05：附件密文出门解密
}

// POST /api/complaints/:id/resolve —— 管理员标记已处理，通知投诉人
export async function handleResolveComplaint(db, complaintId, req) {
  const { admin, err } = await requireAdmin(db, req);
  if (err) return err;
  const c = await dbGetComplaintById(db, complaintId);
  if (!c) return errorMsg('COMPLAINT_NOT_FOUND', 404);
  if (c.status !== STATUS.RESOLVED) {
    await dbResolveComplaint(db, complaintId);
    const { notifyUser } = await import('../../core/notify.js');
    await notifyUser(db, c.user_id, 'FEEDBACK_COMPLAINT_RESOLVED', {});
    await logEvent(db, { action: 'admin.complaint.resolve', actorUserId: admin.id, actorUsername: admin.username,
      actorRole: 'admin', entity: 'complaint', entityId: complaintId,
      detail: { targetType: c.target_type, targetId: c.target_id }, req });
  }
  return json({ ok: true });
}

// ============================================================
// 用户反馈 / 投诉工单（V-1-4c 迁入；反馈与投诉共用 status 语义）
// ============================================================
// POST /api/feedbacks { kind, title, content } —— 全用户可提交（关于平台页「用户反馈」；身份凭令牌，防冒名）
export async function handleCreateFeedback(db, body, req) {
  const { user: me, err } = await requireUser(db, req);
  if (err) return err;
  const userId = me.id;
  // 投诉通道——kind 白名单扩 complaint；投诉对象白名单（teacher/student/platform），非投诉恒空
  const kind = (body.kind === 'bug' || body.kind === 'complaint') ? body.kind : 'suggestion';
  const subject = (kind === 'complaint' && ['teacher', 'student', 'platform'].includes(body.subject)) ? body.subject : '';
  const title = String(body.title || '').trim().slice(0, LIMITS.TITLE_MAX);
  const content = String(body.content || '').trim().slice(0, LIMITS.FEEDBACK_BODY_MAX);
  if (!content) return errorMsg('FEEDBACK_EMPTY'); // 反馈场景文案（原误用广播文案 BROADCAST_EMPTY，已修）
  const feedbackId = await dbCreateFeedback(db, userId, kind, title, content, subject);
  await logEvent(db, { action: 'feedback.create', actorUserId: userId, entity: 'feedback',
    entityId: feedbackId, detail: { kind, title, len: content.length }, req });
  return json({ ok: true }, 201);
}

// 我的反馈/投诉——用户侧闭环（仅本人数据；GET /api/feedbacks/mine）
export async function handleMyFeedbacks(db, req) {
  const { user: me, err } = await requireUser(db, req);
  if (err) return err;
  return json({ feedbacks: await dbGetFeedbacksByUser(db, me.id) });
}

// GET /api/feedbacks?status= —— 管理员查看反馈（含提交者用户名 + 处理状态；status 可选过滤，下推 db 层）
export async function handleAdminFeedbacks(db, url, req) {
  const { err } = await requireAdmin(db, req);
  if (err) return err;
  const feedbacks = await dbGetFeedbacksAdmin(db, url.searchParams.get('status') || '');
  return json({ feedbacks });
}

// POST /api/feedbacks/:id/resolve —— 管理员标记已处理，通知反馈提出者（body 不参与，V-2-4 结构化通知：文案客户端 NOTIF_FEEDBACK_* 单源渲染）
export async function handleResolveFeedback(db, feedbackId, body, req) {
  const { admin, err } = await requireAdmin(db, req);
  if (err) return err;
  const f = await dbGetFeedbackById(db, feedbackId);
  if (!f) return errorMsg('FEEDBACK_NOT_FOUND', 404);
  if (f.status !== STATUS.RESOLVED) {
    await dbResolveFeedback(db, feedbackId);
    // #165：投诉受理回执单独特文案；Bug/建议走通用文案
    await notifyUser(db, f.user_id,
      f.kind === 'complaint' ? 'FEEDBACK_COMPLAINT_RESOLVED' : 'FEEDBACK_RESOLVED', {});
    await logEvent(db, { action: 'admin.feedback.resolve', actorUserId: admin.id, actorUsername: admin.username,
      actorRole: 'admin', entity: 'feedback', entityId: feedbackId, detail: { kind: f.kind }, req });
  }
  return json({ ok: true });
}

// ============================================================
// complaints 域路由表（V-1-4c：投诉 + 反馈工单）
// ============================================================
const S = (method, path, handler) => ({ method, path, handler });
const n = v => parseInt(v, 10);
export const routes = [
  S('POST', '/api/complaints', c => handleCreateComplaint(c.db, c.body, c.req)),
  S('GET', '/api/complaints/mine', c => handleMyComplaints(c.db, c.req)),
  S('GET', '/api/complaints/candidates', c => handleComplaintCandidates(c.db, c.url, c.req)),
  S('GET', '/api/complaints/recent', c => handleComplaintRecent(c.db, c.url, c.req)),
  S('GET', '/api/complaints', c => handleAdminComplaints(c.db, c.url, c.req)),
  S('POST', '/api/complaints/:id/resolve', c => handleResolveComplaint(c.db, n(c.params.id), c.req)),
  S('GET', '/api/complaints/:id/attachment', c => handleComplaintAttachment(c.db, n(c.params.id), c.url, c.req)),
  S('POST', '/api/feedbacks', c => handleCreateFeedback(c.db, c.body, c.req)),
  S('GET', '/api/feedbacks', c => handleAdminFeedbacks(c.db, c.url, c.req)),
  S('GET', '/api/feedbacks/mine', c => handleMyFeedbacks(c.db, c.req)),
  S('POST', '/api/feedbacks/:id/resolve', c => handleResolveFeedback(c.db, n(c.params.id), c.body, c.req)),
];
