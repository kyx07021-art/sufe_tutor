/**
 * 路由模块：教师（档案读写 / 教师列表）
 */
import { json, error, authUser, MSG } from './core.js';
import '../region-data.js'; // 副作用导入：globalThis.SUFE_REGIONS
import { dbGetTeacherProfile, dbUpsertTeacherProfile, dbGetAllTeachers } from './db.js';

// 档案仅本人可读（含联系方式，供编辑表单预填）
export async function handleGetProfile(db, url, req) {
  const me = await authUser(db, req);
  if (!me) return error(MSG.LOGIN_REQUIRED, 401);
  if (parseInt(url.searchParams.get('userId')) !== me.id) return error(MSG.NO_PERMISSION, 403);
  const profile = await dbGetTeacherProfile(db, me.id);
  return json({ profile: profile || null });
}

export async function handleSaveProfile(db, body, req) {
  const { profile: p } = body;
  const me = await authUser(db, req);
  if (!me) return error(MSG.LOGIN_REQUIRED, 401);
  if (!p.province || !globalThis.SUFE_REGIONS.isValidProvince(p.province)) return error(MSG.PROVINCE_REQUIRED);
  await dbUpsertTeacherProfile(db, me.id, p); // 只能写自己的档案
  return json({ message: MSG.PROFILE_SAVED });
}

// 教师广场列表：联系方式（微信/邮箱）签约前不下发——前端早已脱敏展示，此处后端硬把关
export async function handleGetTeachers(db) {
  const teachers = (await dbGetAllTeachers(db)).map(({ wechat, email, ...rest }) => rest);
  return json({ teachers });
}
