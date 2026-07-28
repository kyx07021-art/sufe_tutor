/**
 * 路由模块：学生需求（增删改查）+ 需求意向
 */
import { json, error, MSG } from './core.js';
import '../region-data.js'; // 副作用导入：globalThis.SUFE_REGIONS（省份校验单源）
import {
  dbFindUserById, dbCreateDemand, dbGetAllDemands, dbGetDemandsByUser,
  dbGetDemandById, dbUpdateDemand, dbDeleteDemand, dbCreateIntent, dbGetIntentTeachers,
  dbGetIntentWithDemand, dbResolveIntent, dbUpsertConversation, dbGetTeacherProfile,
} from './db.js';
import { logEvent } from './log.js';

export async function handleCreateDemand(db, body) {
  const { userId, demand: d } = body;
  const user = await dbFindUserById(db, userId);
  if (!user || user.role !== 'student') return error(MSG.STUDENT_ONLY, 403);

  const R = globalThis.SUFE_REGIONS;
  if (!d.province || !R.isValidProvince(d.province)) return error(MSG.PROVINCE_REQUIRED);
  if (d.province !== 'shanghai') d.teaching_method = 'online'; // 业务规则：非上海仅线上

  const id = await dbCreateDemand(db, userId, d);
  return json({ id, message: MSG.DEMAND_SUBMITTED });
}

export async function handleGetDemands(db, url) {
  const raw = url.searchParams.get('userId');
  if (raw) return json({ demands: await dbGetDemandsByUser(db, parseInt(raw)) });
  // 教师大厅视角可带 teacherUserId：每条需求附 my_intent_status（该教师的意向状态）
  const tRaw = url.searchParams.get('teacherUserId');
  return json({ demands: await dbGetAllDemands(db, tRaw ? parseInt(tRaw) : null) });
}

export async function handleUpdateDemand(db, demandId, body) {
  const { userId, demand: d } = body;
  const user = await dbFindUserById(db, userId);
  if (!user || user.role !== 'student') return error(MSG.STUDENT_ONLY, 403);
  const existing = await dbGetDemandById(db, demandId);
  if (!existing) return error(MSG.DEMAND_NOT_FOUND, 404);
  if (existing.user_id !== userId) return error(MSG.NO_PERMISSION, 403);

  const R = globalThis.SUFE_REGIONS;
  if (!d.province || !R.isValidProvince(d.province)) return error(MSG.PROVINCE_REQUIRED);
  if (d.province !== 'shanghai') d.teaching_method = 'online';

  await dbUpdateDemand(db, demandId, d);
  return json({ message: MSG.DEMAND_UPDATED });
}

export async function handleDeleteDemand(db, demandId, body) {
  const { userId } = body;
  const user = await dbFindUserById(db, userId);
  if (!user || user.role !== 'student') return error(MSG.STUDENT_ONLY, 403);
  const existing = await dbGetDemandById(db, demandId);
  if (!existing) return error(MSG.DEMAND_NOT_FOUND, 404);
  if (existing.user_id !== userId) return error(MSG.NO_PERMISSION, 403);

  await dbDeleteDemand(db, demandId);
  return json({ message: MSG.DEMAND_DELETED });
}

// --- 需求意向（后端骨架，前端 UI 下一轮接入） ---
export async function handleCreateIntent(db, demandId, body) {
  const { userId } = body;
  const user = await dbFindUserById(db, userId);
  if (!user || user.role !== 'teacher') return error(MSG.TEACHER_ONLY, 403);
  if (!(await dbGetDemandById(db, demandId))) return error(MSG.DEMAND_NOT_FOUND, 404);

  // 档案完整性门槛：必填项（省份/年级/性别/科目/报价）齐全才许接单，
  // 不完整由前端弹窗引导补档案（此处为硬把关，防绕过）
  // 注意 dbGetTeacherProfile 已把 subjects/gaokao_scores 解析成数组，此处勿再 JSON.parse
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

export async function handleGetIntents(db, demandId) {
  const teachers = await dbGetIntentTeachers(db, demandId);
  return json({ demandId, count: teachers.length, teachers });
}

// 学生处理意向：accept → 置 accepted 并建立（或复用）师生会话；reject → 置 rejected
export async function handleResolveIntent(db, intentId, body, req) {
  const { userId, action } = body;
  if (!['accept', 'reject'].includes(action)) return error(MSG.INVALID_ROLE);
  const user = await dbFindUserById(db, userId);
  if (!user || user.role !== 'student') return error(MSG.STUDENT_ONLY, 403);

  const intent = await dbGetIntentWithDemand(db, intentId);
  if (!intent) return error(MSG.INTENT_NOT_FOUND, 404);
  if (intent.demand_owner !== userId) return error(MSG.NO_PERMISSION, 403);
  if (intent.status !== 'pending') return error(MSG.INTENT_ALREADY_RESOLVED, 409);

  const status = action === 'accept' ? 'accepted' : 'rejected';
  await dbResolveIntent(db, intentId, status);

  let conversationId = null;
  if (action === 'accept') {
    conversationId = await dbUpsertConversation(db, userId, intent.teacher_user_id, intent.demand_id);
  }
  logEvent(db, { action: `intent.${action}`, actorUserId: userId, actorRole: 'student',
    entity: 'intent', entityId: intentId,
    detail: { demandId: intent.demand_id, teacherUserId: intent.teacher_user_id, conversationId }, req });
  return json({ message: MSG.INTENT_RESOLVED, status, conversationId });
}
