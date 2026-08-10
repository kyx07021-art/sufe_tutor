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
import { json, error } from './util.js';
import { requireUser, requireAdmin } from './security.js';
import { MSG, STATUS, LIMITS } from './constants.js';
import {
  dbCreateComplaint, dbCountComplaintsToday, dbGetComplaintsByUser, dbGetComplaintsAdmin,
  dbGetComplaintById, dbResolveComplaint, dbSearchUsersByRole, dbRecentInteractions, dbSearchPosts,
  dbGetUserById, dbGetPostById, dbGetUpload, dbDeleteUpload,
} from './db.js';
import { decryptField } from './crypto.js'; // U11：投诉附件密文出门解密（与聊天附件同口径）
import { logEvent } from './log.js';
import '../constants.js'; // 用户可见文案统一走 globalThis.APP_CONSTANTS.UI

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
  if (!TARGET_TYPES.includes(targetType)) return error(MSG.COMPLAINT_TARGET_REQUIRED, 400);
  const targetId = Number(body.targetId);
  if (!Number.isInteger(targetId) || targetId <= 0) return error(MSG.COMPLAINT_TARGET_REQUIRED, 400);

  const reasons = (globalThis.APP_CONSTANTS.UI.COMPLAINT_REASONS) || [];
  const reason = String(body.reason || '').trim();
  if (!reasons.includes(reason)) return error(MSG.COMPLAINT_REASON_REQUIRED, 400);
  const detail = String(body.detail || '').trim().slice(0, LIMITS.COMPLAINT_DETAIL_MAX);

  // 附件：数量钳制 + 归属校验（仅本人暂存可复制，防借 id 搬运他人附件）
  const uploadIds = Array.isArray(body.uploadIds) ? body.uploadIds.map(Number).filter(Number.isInteger) : [];
  if (uploadIds.length > LIMITS.COMPLAINT_ATTACH_MAX) return error(MSG.COMPLAINT_ATTACH_TOO_MANY, 400);
  const attachments = [];
  for (const id of uploadIds) {
    const up = await dbGetUpload(db, id);
    if (!up || up.user_id !== me.id) return error(MSG.COMPLAINT_ATTACH_NOT_FOUND, 400);
    attachments.push({ kind: up.kind, name: up.name, body: up.body, thumb: up.thumb || '' });
  }

  const target = await resolveTarget(db, targetType, targetId);
  if (!target) return error(MSG.COMPLAINT_TARGET_NOT_FOUND, 404);
  // 不能投诉自己：用户类型比对本人 id；帖子比对作者 id（resolveTarget 快照已带 authorId）
  const selfId = targetType === 'post' ? target.authorId : target.id;
  if (selfId === me.id) return error(MSG.COMPLAINT_SELF_FORBIDDEN, 400);

  const today = await dbCountComplaintsToday(db, me.id);
  if (today >= LIMITS.COMPLAINT_DAILY_LIMIT) return error(MSG.COMPLAINT_DAILY_LIMIT, 429);

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
  if (!c) return error(MSG.COMPLAINT_NOT_FOUND, 404);
  if (c.user_id !== me.id && me.role !== 'admin') return error(MSG.NO_PERMISSION, 403);
  const idx = parseInt(url.searchParams.get('idx')) || 0;
  const a = (c.attachments || [])[idx];
  if (!a) return error(MSG.COMPLAINT_ATTACH_NOT_FOUND, 404);
  return json({ kind: a.kind, name: a.name, body: await decryptField(a.body) }); // N-05：附件密文出门解密
}

// POST /api/complaints/:id/resolve —— 管理员标记已处理，通知投诉人
export async function handleResolveComplaint(db, complaintId, req) {
  const { admin, err } = await requireAdmin(db, req);
  if (err) return err;
  const c = await dbGetComplaintById(db, complaintId);
  if (!c) return error(MSG.COMPLAINT_NOT_FOUND, 404);
  if (c.status !== STATUS.RESOLVED) {
    await dbResolveComplaint(db, complaintId);
    const { notifyUser } = await import('./notify.js');
    await notifyUser(db, c.user_id, globalThis.APP_CONSTANTS.UI.FEEDBACK_COMPLAINT_RESOLVED);
    await logEvent(db, { action: 'admin.complaint.resolve', actorUserId: admin.id, actorUsername: admin.username,
      actorRole: 'admin', entity: 'complaint', entityId: complaintId,
      detail: { targetType: c.target_type, targetId: c.target_id }, req });
  }
  return json({ ok: true });
}
