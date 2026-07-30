/**
 * 路由模块：教师（档案读写 / 教师列表）
 * 档案可见性三级（身份一律凭令牌）：
 *   本人       全字段（含联系方式/真实姓名/学信网截图，供编辑表单预填）
 *   双向匹配   公开档案 + 真实姓名 + 学信网截图（联系方式仍按「签约后展示」规则不下发）
 *   公开/游客  仅公开档案（列表接口，联系方式与私密认证字段一律剥离）
 */
import { json, error, authUser, MSG } from './core.js';
import '../region-data.js'; // 副作用导入：globalThis.SUFE_REGIONS
import { dbGetTeacherProfile, dbUpsertTeacherProfile, dbGetAllTeachers, dbIsMatched, dbIsContracted, dbGetUserById } from './db.js';

// 学信网截图 dataURL 上限（前端已压缩至最长边 1000px，此处兜底防异常大串）
const CREDENTIAL_MAX = 500000;

// ?userId= 缺省 = 本人（编辑预填）；传他人 id：
//   未匹配 → 403（面板数据源是列表接口，不应走到这里）
//   双向匹配 → 公开档案 + 真实姓名 + 学信网截图
//   已签约   → 再追加联系方式（微信/邮箱，「签约后展示」规则的兑现层）
export async function handleGetProfile(db, url, req) {
  const me = await authUser(db, req);
  if (!me) return error(MSG.LOGIN_REQUIRED, 401);
  const targetId = parseInt(url.searchParams.get('userId')) || me.id;
  // 被封禁且未注销的账户视同不存在（与 handleGetUserPublic 口径一致，不泄露封禁态）；本人不受影响（authUser 已拦封禁者）
  if (targetId !== me.id) {
    const target = await dbGetUserById(db, targetId);
    if (target && target.banned && !target.deactivated) return error(MSG.USER_NOT_FOUND, 404);
  }
  const profile = await dbGetTeacherProfile(db, targetId);
  if (!profile) return json({ profile: null });
  if (me.id === targetId) return json({ profile }); // 本人：全字段
  const { wechat, email, real_name, credential_image, ...publicPart } = profile;
  if (!(await dbIsMatched(db, me.id, targetId))) return error(MSG.NO_PERMISSION, 403);
  const signed = me.role === 'student' && (await dbIsContracted(db, me.id, targetId));
  return json({ profile: { ...publicPart, real_name, credential_image, ...(signed ? { wechat, email } : {}), matched: true } });
}

export async function handleSaveProfile(db, body, req) {
  const { profile: p } = body;
  const me = await authUser(db, req);
  if (!me) return error(MSG.LOGIN_REQUIRED, 401);
  if (me.role !== 'teacher') return error(MSG.NO_PERMISSION, 403); // 仅教师可建档案（防学生/管理员写 teacher_profiles）
  if (!p.province || !globalThis.SUFE_REGIONS.isValidProvince(p.province)) return error(MSG.PROVINCE_REQUIRED);
  // 报价钳制：保留 null=未填语义（不转 0，档案完整性门槛据此拦截）；有值则夹到 [0,99999]，非法值回落未填
  if (p.price != null) {
    const n = Number(p.price);
    p.price = Number.isFinite(n) ? Math.min(99999, Math.max(0, n)) : null;
  }
  const credential = String(p.credential_image || '');
  if (credential && (!credential.startsWith('data:image/') || credential.length > CREDENTIAL_MAX)) return error(MSG.AVATAR_INVALID);
  await dbUpsertTeacherProfile(db, me.id, { ...p, credential_image: credential }); // 只能写自己的档案
  return json({ message: MSG.PROFILE_SAVED });
}

// 教师广场列表：联系方式（签约后展示）与私密认证字段（真实姓名/学信网截图，双向匹配后按
// /api/teacher/profile 定点取）永不下发列表；登录态附 matched 标记供前端判定可见性
export async function handleGetTeachers(db, req) {
  const me = await authUser(db, req);
  const teachers = (await dbGetAllTeachers(db, me ? me.id : null))
    .map(({ wechat, email, real_name, credential_image, ...rest }) => rest);
  return json({ teachers });
}
