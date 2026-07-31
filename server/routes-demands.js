/**
 * 路由模块：学生需求（增删改查）+ 需求意向
 */
import { json, error, authUser, MSG, STATUS, dbRun } from './core.js';
import '../region-data.js'; // 副作用导入：globalThis.SUFE_REGIONS（省份校验单源）
import '../constants.js';   // 副作用导入：globalThis.APP_CONSTANTS（系统通知文案单源，与前端共用）
import {
  dbFindUserById, dbCreateDemand, dbGetAllDemands, dbGetDemandsByUser,
  dbGetDemandById, dbUpdateDemand, dbDeleteDemand, dbCreateIntent, dbGetIntentTeachers,
  dbGetIntentWithDemand, dbResolveIntent, dbUpsertConversation, dbGetTeacherProfile,
  dbCreatePush, dbGetPendingPushesForTeacher, dbGetPushById, dbResolvePush, dbAcceptPushAsIntent,
} from './db.js';
import { logEvent } from './log.js';
import { notifyUser } from './notify.js';

const UIC = globalThis.APP_CONSTANTS.UI; // 接受/拒绝通知文案（constants.js 收口）

// 委婉通知文案：拒绝/退回时给对方一个体面的交代（科目名经 region-data 解码，年级不入库名故省略）
// 模板本体在 constants.js UI 块（NOTIFY_PUSH_REJECT / NOTIFY_INTENT_REJECT），此处仅填 {subjects}
function demandSubjectsText(d) {
  const R = globalThis.SUFE_REGIONS;
  const UI = globalThis.APP_CONSTANTS.UI;
  // mapper 已将 target_subjects 反序列化为数组；旧路径偶为 JSON 串，故数组直用、串才解析（杜绝双重解析静默死亡/500）
  const raw = d ? d.target_subjects : null;
  let ids = Array.isArray(raw) ? raw : [];
  if (!ids.length && typeof raw === 'string') { try { ids = JSON.parse(raw || '[]'); } catch { ids = []; } }
  const names = ids.map(id => R.subjectNames[id] || '').filter(Boolean).join('、');
  return names || UI.NOTIFY_SUBJECTS_FALLBACK;
}
const pushRejectNote = d => globalThis.APP_CONSTANTS.UI.NOTIFY_PUSH_REJECT.replace('{subjects}', demandSubjectsText(d));
const intentRejectNote = d => globalThis.APP_CONSTANTS.UI.NOTIFY_INTENT_REJECT.replace('{subjects}', demandSubjectsText(d));

// 需求输入硬化：预算钳到 [0,99999] 且 max>=min；授课方式白名单（online/offline，非法值回落 offline）
const clampBudget = v => { const n = Number(v); return Number.isFinite(n) ? Math.min(99999, Math.max(0, n)) : 0; };
function sanitizeDemand(d) {
  d.budget_min = clampBudget(d.budget_min);
  d.budget_max = clampBudget(d.budget_max);
  if (d.budget_max < d.budget_min) d.budget_max = d.budget_min; // 二者同时存在时保证 max>=min
  d.teaching_method = ['online', 'offline'].includes(d.teaching_method) ? d.teaching_method : 'offline';
  return d;
}

export async function handleCreateDemand(db, body, req) {
  const { demand: d } = body;
  const me = await authUser(db, req);
  if (!me || me.role !== 'student') return error(MSG.STUDENT_ONLY, 403);
  const userId = me.id;

  const R = globalThis.SUFE_REGIONS;
  if (!d.province || !R.isValidProvince(d.province)) return error(MSG.PROVINCE_REQUIRED);
  if (d.province !== 'shanghai') d.teaching_method = 'online'; // 业务规则：非上海仅线上
  sanitizeDemand(d);

  const id = await dbCreateDemand(db, userId, d);
  await logEvent(db, { action: 'demand.create', actorUserId: userId, actorRole: 'student',
    entity: 'demand', entityId: id, detail: { province: d.province, method: d.teaching_method }, req });
  return json({ id, message: MSG.DEMAND_SUBMITTED });
}

// 需求列表三视角，scope 显式选择（身份一律凭令牌，自报 id 的查询参数已废除）。
// 联系方式脱敏已下沉到 db.js mapDemandRow 默认出口（单一强制点，任何出口都拿不到），此处不再重复裁剪：
//   （缺省）      公开广场：排除 contracted，访客可用
//   scope=mine        我的需求：含联系方式（mapDemandRowFull），仅本人
//   scope=for-teacher 教师大厅视角：每条附本人 my_intent_status（按钮三态用）
export async function handleGetDemands(db, url, req) {
  const scope = url.searchParams.get('scope') || '';
  if (scope === 'mine') {
    const me = await authUser(db, req);
    if (!me) return error(MSG.LOGIN_REQUIRED, 401);
    return json({ demands: await dbGetDemandsByUser(db, me.id) });
  }
  if (scope === 'for-teacher') {
    const me = await authUser(db, req);
    if (!me) return error(MSG.LOGIN_REQUIRED, 401);
    return json({ demands: await dbGetAllDemands(db, me.id) });
  }
  return json({ demands: await dbGetAllDemands(db) });
}

// 需求写操作关口：404 存在 → 403 归属 → 409 已签约锁定（update/delete 共用；服务端写入路径硬门禁）
async function loadOwnedDemand(db, demandId, userId) {
  const existing = await dbGetDemandById(db, demandId);
  if (!existing) return { err: error(MSG.DEMAND_NOT_FOUND, 404) };
  if (existing.user_id !== userId) return { err: error(MSG.NO_PERMISSION, 403) };
  if (existing.status === STATUS.CONTRACTED) return { err: error(MSG.DEMAND_CONTRACTED_LOCKED, 409) };
  return { existing };
}

export async function handleUpdateDemand(db, demandId, body, req) {
  const { demand: d } = body;
  const me = await authUser(db, req);
  if (!me || me.role !== 'student') return error(MSG.STUDENT_ONLY, 403);
  const g = await loadOwnedDemand(db, demandId, me.id); // 已签约需求锁定，禁改（合同已绑定此需求）
  if (g.err) return g.err;

  const R = globalThis.SUFE_REGIONS;
  if (!d.province || !R.isValidProvince(d.province)) return error(MSG.PROVINCE_REQUIRED);
  if (d.province !== 'shanghai') d.teaching_method = 'online';
  sanitizeDemand(d);

  await dbUpdateDemand(db, demandId, d);
  await logEvent(db, { action: 'demand.update', actorUserId: me.id, actorRole: 'student',
    entity: 'demand', entityId: demandId, detail: { province: d.province, method: d.teaching_method }, req });
  return json({ message: MSG.DEMAND_UPDATED });
}

export async function handleDeleteDemand(db, demandId, body, req) {
  const me = await authUser(db, req);
  if (!me || me.role !== 'student') return error(MSG.STUDENT_ONLY, 403);
  const g = await loadOwnedDemand(db, demandId, me.id); // 已签约需求禁删（会使合同 demand_id 悬空）
  if (g.err) return g.err;
  const ok = await dbDeleteDemand(db, demandId); // 数据层门禁：pending/signing 合同引用时拒绝（防悬空，F-03b）
  if (!ok) return error(MSG.DEMAND_CONTRACTED_LOCKED, 409);
  await logEvent(db, { action: 'demand.delete', actorUserId: me.id, actorRole: 'student',
    entity: 'demand', entityId: demandId, req });
  return json({ message: MSG.DEMAND_DELETED });
}

// POST /api/student/demands/:id/reopen —— 重开「合同已撤销」的需求（仅所有者；revoked→open 重回广场接收意向）
// 撤销合同不自动重开（防锁定扰动），由此处手动触发；条件 UPDATE 赢家模式防并发双触发
export async function handleReopenDemand(db, demandId, body, req) {
  const me = await authUser(db, req);
  if (!me || me.role !== 'student') return error(MSG.STUDENT_ONLY, 403);
  const existing = await dbGetDemandById(db, demandId);
  if (!existing) return error(MSG.DEMAND_NOT_FOUND, 404);
  if (existing.user_id !== me.id) return error(MSG.NO_PERMISSION, 403);
  if (existing.status !== STATUS.REVOKED) return error(MSG.DEMAND_STATE_INVALID, 409);
  const claim = await dbRun(db, `UPDATE student_demands SET status='open' WHERE id=? AND status='revoked'`, [demandId]);
  if (!(claim && claim.meta && claim.meta.changes > 0)) return error(MSG.DEMAND_STATE_INVALID, 409);
  await logEvent(db, { action: 'demand.reopen', actorUserId: me.id, entity: 'demand', entityId: demandId,
    detail: { from: STATUS.REVOKED }, req });
  return json({ message: MSG.DEMAND_REOPENED });
}

// --- 需求意向（后端骨架，前端 UI 下一轮接入） ---
export async function handleCreateIntent(db, demandId, body, req) {
  const me = await authUser(db, req);
  if (!me || me.role !== 'teacher') return error(MSG.TEACHER_ONLY, 403);
  const userId = me.id;
  const demand0 = await dbGetDemandById(db, demandId);
  if (!demand0) return error(MSG.DEMAND_NOT_FOUND, 404);
  if (demand0.status === STATUS.CONTRACTED) return error(MSG.DEMAND_CONTRACTED_CLOSED, 410); // 已签约需求停止接收意向（服务端硬门禁，不靠前端过滤）

  // 档案完整性门槛：必填项（省份/年级/性别/科目/报价）齐全才许接单，
  // 不完整由前端弹窗引导补档案（此处为硬把关，防绕过）；价格 null = 未填（mapper 保留 null）
  const p = await dbGetTeacherProfile(db, userId);
  const subjectsOk = !!(p && Array.isArray(p.subjects) && p.subjects.length > 0);
  // price==null 才是未填（0 是合法报价）；其余必填项空串即不完整
  if (!p || !p.province || !p.grade || !p.gender || !subjectsOk || p.price == null) {
    return error(MSG.PROFILE_INCOMPLETE, 403);
  }

  try {
    const id = await dbCreateIntent(db, demandId, userId);
    return json({ id, message: MSG.INTENT_SUBMITTED }, 201);
  } catch (err) {
    if (String(err?.message || err).includes('UNIQUE')) return error(MSG.INTENT_DUPLICATE, 409);
    throw err;
  }
}

export async function handleGetIntents(db, demandId, req) {
  const me = await authUser(db, req);
  if (!me) return error(MSG.LOGIN_REQUIRED, 401);
  const demand = await dbGetDemandById(db, demandId);
  if (!demand) return error(MSG.DEMAND_NOT_FOUND, 404);
  if (demand.user_id !== me.id) return error(MSG.NO_PERMISSION, 403); // 仅需求所有者可见意向列表
  const teachers = (await dbGetIntentTeachers(db, demandId))
    .map(({ wechat, email, real_name, credential_image, matched, ...rest }) => rest); // 联系方式签约后展示；真实姓名/学信网截图仅双向匹配后按档案端点定点取
  return json({ demandId, count: teachers.length, teachers });
}

// 学生处理意向：accept → 置 accepted 并建立（或复用）师生会话；reject → 置 rejected
export async function handleResolveIntent(db, intentId, body, req) {
  const { action } = body;
  if (!['accept', 'reject'].includes(action)) return error(MSG.INVALID_ROLE);
  const me = await authUser(db, req);
  if (!me || me.role !== 'student') return error(MSG.STUDENT_ONLY, 403);
  const userId = me.id;

  const intent = await dbGetIntentWithDemand(db, intentId);
  if (!intent) return error(MSG.INTENT_NOT_FOUND, 404);
  if (intent.demand_owner !== userId) return error(MSG.NO_PERMISSION, 403);
  if (intent.status !== STATUS.PENDING) return error(MSG.INTENT_ALREADY_RESOLVED, 409);

  const status = action === 'accept' ? STATUS.ACCEPTED : STATUS.REJECTED;
  if (!(await dbResolveIntent(db, intentId, status))) return error(MSG.INTENT_ALREADY_RESOLVED, 409); // 条件 UPDATE 赢家才继续，杜绝并发双通知

  let conversationId = null;
  if (action === 'accept') {
    const dNow = await dbGetDemandById(db, intent.demand_id);
    if (dNow && dNow.status === STATUS.CONTRACTED) return error(MSG.DEMAND_CONTRACTED_CLOSED, 410); // 需求已被别人签约 → 不再建会话
    conversationId = await dbUpsertConversation(db, userId, intent.teacher_user_id, intent.demand_id);
    await notifyUser(db, intent.teacher_user_id, UIC.INTENT_ACCEPTED_NOTIFY);
  } else {
    // 学生拒绝教师意向 → 委婉通知教师
    const d = await dbGetDemandById(db, intent.demand_id);
    await notifyUser(db, intent.teacher_user_id, intentRejectNote(d));
  }
  await logEvent(db, { action: `intent.${action}`, actorUserId: userId, actorRole: 'student',
    entity: 'intent', entityId: intentId,
    detail: { demandId: intent.demand_id, teacherUserId: intent.teacher_user_id, conversationId }, req });
  return json({ message: MSG.INTENT_RESOLVED, status, conversationId });
}

// ============================================================
// 学生主动推送需求给指定教师 / 教师处理推送
// ============================================================
export async function handlePushDemand(db, body, req) {
  const { teacherUserId, demandId } = body;
  const me = await authUser(db, req);
  if (!me || me.role !== 'student') return error(MSG.STUDENT_ONLY, 403);
  const userId = me.id;
  const teacher = await dbFindUserById(db, teacherUserId);
  if (!teacher || teacher.role !== 'teacher') return error(MSG.TEACHER_NOT_FOUND, 404);
  const demand = await dbGetDemandById(db, demandId);
  if (!demand) return error(MSG.DEMAND_NOT_FOUND, 404);
  if (demand.user_id !== userId) return error(MSG.NO_PERMISSION, 403);
  if (demand.status === STATUS.CONTRACTED) return error(MSG.DEMAND_CONTRACTED_CLOSED, 410); // 已签约需求不可再推送

  try {
    const id = await dbCreatePush(db, demandId, userId, teacherUserId);
    await logEvent(db, { action: 'demand.push', actorUserId: userId, actorRole: 'student',
      entity: 'demand_push', entityId: id, detail: { teacherUserId, demandId }, req });
    return json({ id, message: MSG.PUSH_SUBMITTED }, 201);
  } catch (err) {
    if (String(err?.message || err).includes('UNIQUE')) return error(MSG.PUSH_DUPLICATE, 409);
    throw err;
  }
}

// 教师端：本人的待处理推送列表（需求大厅置顶 + 红点计数同源；身份凭令牌）
export async function handleGetTeacherPushes(db, url, req) {
  const me = await authUser(db, req);
  if (!me) return error(MSG.LOGIN_REQUIRED, 401);
  const pushes = await dbGetPendingPushesForTeacher(db, me.id);
  return json({ pushes });
}

// 教师确认 / 拒绝推送。确认 = 写已接受意向 + 建会话；拒绝 = 仅标记 + 委婉通知学生
export async function handleResolvePush(db, pushId, body, req) {
  const { action } = body;
  if (!['accept', 'reject'].includes(action)) return error(MSG.INVALID_ROLE);
  const me = await authUser(db, req);
  if (!me || me.role !== 'teacher') return error(MSG.TEACHER_ONLY, 403);
  const userId = me.id;
  const push = await dbGetPushById(db, pushId);
  if (!push) return error(MSG.INTENT_NOT_FOUND, 404);
  if (push.teacher_user_id !== userId) return error(MSG.NO_PERMISSION, 403);
  if (push.status !== STATUS.PENDING) return error(MSG.INTENT_ALREADY_RESOLVED, 409);

  if (action === 'accept') {
    const dNow = await dbGetDemandById(db, push.demand_id);
    if (dNow && dNow.status === STATUS.CONTRACTED) return error(MSG.DEMAND_CONTRACTED_CLOSED, 410); // 陈旧置顶卡兜底：需求已签约不可再确认
    if (!(await dbResolvePush(db, pushId, STATUS.ACCEPTED))) return error(MSG.INTENT_ALREADY_RESOLVED, 409);
    await dbAcceptPushAsIntent(db, push.demand_id, userId);
    await dbUpsertConversation(db, push.student_user_id, userId, push.demand_id);
    await notifyUser(db, push.student_user_id, UIC.PUSH_ACCEPTED_NOTIFY);
  } else {
    if (!(await dbResolvePush(db, pushId, STATUS.REJECTED))) return error(MSG.INTENT_ALREADY_RESOLVED, 409);
    const d = await dbGetDemandById(db, push.demand_id);
    await notifyUser(db, push.student_user_id, pushRejectNote(d));
  }
  await logEvent(db, { action: `demand_push.${action}`, actorUserId: userId, actorRole: 'teacher',
    entity: 'demand_push', entityId: pushId,
    detail: { demandId: push.demand_id, studentUserId: push.student_user_id }, req });
  return json({ message: 'ok', status: action === 'accept' ? STATUS.ACCEPTED : STATUS.REJECTED });
}
