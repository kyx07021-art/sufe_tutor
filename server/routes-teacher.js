/**
 * 路由模块：教师（档案读写 / 教师列表）
 */
import { json, error, MSG } from './core.js';
import '../region-data.js'; // 副作用导入：globalThis.SUFE_REGIONS
import { dbGetTeacherProfile, dbUpsertTeacherProfile, dbGetAllTeachers } from './db.js';

export async function handleGetProfile(db, url) {
  const userId = parseInt(url.searchParams.get('userId'));
  const profile = await dbGetTeacherProfile(db, userId);
  return json({ profile: profile || null });
}

export async function handleSaveProfile(db, body) {
  const { userId, profile: p } = body;
  if (!p.province || !globalThis.SUFE_REGIONS.isValidProvince(p.province)) return error(MSG.PROVINCE_REQUIRED);
  await dbUpsertTeacherProfile(db, userId, p);
  return json({ message: MSG.PROFILE_SAVED });
}

export async function handleGetTeachers(db) {
  const teachers = await dbGetAllTeachers(db);
  return json({ teachers });
}
