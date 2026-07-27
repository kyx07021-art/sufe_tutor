/**
 * 路由模块：学生需求（增删改查）+ 需求意向
 */
import { json, error, MSG } from './core.js';
import {
  dbFindUserById, dbCreateDemand, dbGetAllDemands, dbGetDemandsByUser,
  dbGetDemandById, dbUpdateDemand, dbDeleteDemand, dbCreateIntent, dbGetIntentTeachers,
} from './db.js';

export async function handleCreateDemand(db, body) {
  const { userId, demand: d } = body;
  const user = await dbFindUserById(db, userId);
  if (!user || user.role !== 'student') return error(MSG.STUDENT_ONLY, 403);

  const id = await dbCreateDemand(db, userId, d);
  return json({ id, message: MSG.DEMAND_SUBMITTED });
}

export async function handleGetDemands(db, url) {
  const raw = url.searchParams.get('userId');
  const demands = raw ? await dbGetDemandsByUser(db, parseInt(raw)) : await dbGetAllDemands(db);
  return json({ demands });
}

export async function handleUpdateDemand(db, demandId, body) {
  const { userId, demand: d } = body;
  const user = await dbFindUserById(db, userId);
  if (!user || user.role !== 'student') return error(MSG.STUDENT_ONLY, 403);
  const existing = await dbGetDemandById(db, demandId);
  if (!existing) return error(MSG.DEMAND_NOT_FOUND, 404);
  if (existing.user_id !== userId) return error(MSG.NO_PERMISSION, 403);

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
