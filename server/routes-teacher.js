/**
 * 路由模块：教师（档案读写 / 教师列表）
 */
import { json, MSG } from './core.js';
import { dbGetTeacherProfile, dbUpsertTeacherProfile, dbGetAllTeachers } from './db.js';

export async function handleGetProfile(db, url) {
  const userId = parseInt(url.searchParams.get('userId'));
  const profile = await dbGetTeacherProfile(db, userId);
  return json({ profile: profile || null });
}

export async function handleSaveProfile(db, body) {
  const { userId, profile: p } = body;
  await dbUpsertTeacherProfile(db, userId, p);
  return json({ message: MSG.PROFILE_SAVED });
}

export async function handleGetTeachers(db) {
  const teachers = await dbGetAllTeachers(db);
  return json({ teachers });
}
