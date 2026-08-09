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
  dbGetUserById, dbGetPostById,
} from './db.js';
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

  const target = await resolveTarget(db, targetType, targetId);
  if (!target) return error(MSG.COMPLAINT_TARGET_NOT_FOUND, 404);
  // 不能投诉自己：用户类型比对本人 id；帖子比对作者 id（resolveTarget 快照已带 authorId）
  const selfId = targetType === 'post' ? target.authorId : target.id;
  if (selfId === me.id) return error(MSG.COMPLAINT_SELF_FORBIDDEN, 400);

  const today = await dbCountComplaintsToday(db, me.id);
  if (today >= LIMITS.COMPLAINT_DAILY_LIMIT) return error(MSG.COMPLAINT_DAILY_LIMIT, 429);

  const complaintId = await dbCreateComplaint(db, me.id, targetType, targetId, target, reason, detail);
  await logEvent(db, { action: 'complaint.create', actorUserId: me.id, entity: 'complaint',
    entityId: complaintId, detail: { targetType, targetId, reason, len: detail.length }, req });
  return json({ ok: true }, 201);
}

// GET /api/complaints/mine —— 我的投诉（状态跟踪闭环）
export async function handleMyComplaints(db, req) {
  const { user: me, err } = await requireUser(db, req);
  if (err) return err;
  return json({ complaints: await dbGetComplaintsByUser(db, me.id) });
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
  return json({ complaints });
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
