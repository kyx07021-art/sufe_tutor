/**
 * 路由模块：教师（档案读写 / 教师列表）
 * 档案可见性三级（身份一律凭令牌）：
 *   本人       全字段（含联系方式/真实姓名/学信网截图，供编辑表单预填）
 *   双向匹配   公开档案 + 真实姓名 + 学信网截图（联系方式仍按「签约后展示」规则不下发）
 *   公开/游客  仅公开档案（列表接口，联系方式与私密认证字段一律剥离）
 * 依赖：util / security（requireUser）/ constants（校验文案/限额/门牌守卫）/ db / log。
 */
import { json, error, sanitizeTimeSlots } from './util.js';
import { authUser, requireUser } from './security.js';
import { MSG, ADDRESS_GUARD, LIMITS } from './constants.js';
import '../region-data.js'; // 副作用导入：globalThis.SUFE_REGIONS
import '../constants.js';   // 副作用导入：globalThis.APP_CONSTANTS（PERSONALITY_TAGS/NONACADEMIC_PROJECTS 白名单单源，与前端共用）
import { dbGetTeacherProfile, dbUpsertTeacherProfile, dbGetTeachers, dbIsMatched, dbIsContracted, dbGetUserById } from './db.js';
import { logEvent } from './log.js';

// ?userId= 缺省 = 本人（编辑预填）；传他人 id：
//   未匹配 → 403（面板数据源是列表接口，不应走到这里）
//   双向匹配 → 公开档案 + 真实姓名 + 学信网截图
//   已签约   → 再追加联系方式（微信/邮箱，「签约后展示」规则的兑现层）
export async function handleGetProfile(db, url, req) {
  const { user: me, err } = await requireUser(db, req);
  if (err) return err;
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
  const { profile: p = {} } = body;
  if (typeof p !== 'object' || p === null) return error(MSG.INVALID_PARAMS); // 空 body 兜底（曾直 500）
  const { user: me, err } = await requireUser(db, req);
  if (err) return err;
  if (me.role !== 'teacher') return error(MSG.NO_PERMISSION, 403); // 仅教师可建档案（防学生/管理员写 teacher_profiles）
  if (!p.province || !globalThis.SUFE_REGIONS.isValidProvince(p.province)) return error(MSG.PROVINCE_REQUIRED);

  // R2-5 报价区间化：price_min/price_max 各自钳制，保留 null=未填语义（不转 0，完整性门槛据此拦截）；
  // 有值夹到 [0, LIMITS.BUDGET_MAX]；max < min 时以 min 为准（同 sanitizeDemand 预算口径）
  const clampPrice = v => {
    if (v === '' || v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(LIMITS.BUDGET_MAX, Math.max(0, n)) : null;
  };
  p.price_min = clampPrice(p.price_min);
  p.price_max = clampPrice(p.price_max);
  if (p.price_max != null && p.price_min != null && p.price_max < p.price_min) p.price_max = p.price_min;

  // R2-1 可授课时间段：与需求 expected_time 同格式、同一 sanitizeTimeSlots 校验（可选，空串合法）
  const ts = sanitizeTimeSlots(p.time_slots);
  if (ts.error) return error(ts.error);
  p.time_slots = ts.value;

  // R2-2 授课方式：白名单读 TEACHING_METHODS 单源（与前端 constants 同源，改 id 服务端不静默失配），非法值回退 ''（未填）
  const methodSet = new Set(((globalThis.APP_CONSTANTS && globalThis.APP_CONSTANTS.TEACHING_METHODS) || []).map(m => m.id));
  p.teaching_method = methodSet.has(p.teaching_method) ? p.teaching_method : '';

  // R2-3 性格关键词：数组、<=PERSONALITY_TAGS_MAX、每项在白名单（服务端经 APP_CONSTANTS 读，与前端同源）
  const P = (globalThis.APP_CONSTANTS && globalThis.APP_CONSTANTS.PERSONALITY_TAGS) || [];
  const personalitySet = new Set(P.map(t => t.id));
  const personalityMax = (globalThis.APP_CONSTANTS.CONFIG && globalThis.APP_CONSTANTS.CONFIG.PERSONALITY_TAGS_MAX) || 3;
  if (p.personality_tags != null) {
    if (!Array.isArray(p.personality_tags)) return error(MSG.INVALID_PARAMS);
    if (p.personality_tags.length > personalityMax) return error(MSG.PERSONALITY_TAGS_TOO_MANY);
    p.personality_tags = [...new Set(p.personality_tags.filter(id => typeof id === 'string' && personalitySet.has(id)))];
  } else {
    p.personality_tags = [];
  }

  // R2-4 擅长非学科类项目 + 报价：projects 白名单去重；prices 每项 project 须在 projects 内、
  // 价格数字且 min<=max、钳制 [0, BUDGET_MAX]
  const N = (globalThis.APP_CONSTANTS && globalThis.APP_CONSTANTS.NONACADEMIC_PROJECTS) || [];
  const nonacademicSet = new Set(N.map(x => x.id));
  if (p.nonacademic_projects != null) {
    if (!Array.isArray(p.nonacademic_projects)) return error(MSG.INVALID_PARAMS);
    p.nonacademic_projects = [...new Set(p.nonacademic_projects.filter(id => typeof id === 'string' && nonacademicSet.has(id)))];
  } else {
    p.nonacademic_projects = [];
  }
  if (p.nonacademic_prices != null) {
    if (!Array.isArray(p.nonacademic_prices)) return error(MSG.INVALID_PARAMS);
    const sel = new Set(p.nonacademic_projects);
    p.nonacademic_prices = p.nonacademic_prices
      .filter(it => it && typeof it === 'object' && typeof it.project === 'string' && sel.has(it.project))
      .map(it => {
        const min = clampPrice(it.price_min);
        const max = clampPrice(it.price_max);
        return { project: it.project, price_min: min, price_max: (max != null && min != null && max < min) ? min : max };
      });
  } else {
    p.nonacademic_prices = [];
  }

  const credential = String(p.credential_image || '');
  // svg 一律拒绝：矢量可内嵌脚本（与 routes-auth 头像口径一致；上限单源 LIMITS.CREDENTIAL_MAX_BYTES）
  if (credential && (!credential.startsWith('data:image/') || credential.startsWith('data:image/svg') || credential.length > LIMITS.CREDENTIAL_MAX_BYTES)) return error(MSG.AVATAR_INVALID);
  if (ADDRESS_GUARD.test(p.address || '')) return error(MSG.ADDRESS_TOO_DETAILED); // 合规红线：详细门牌号不收集
  await dbUpsertTeacherProfile(db, me.id, { ...p, credential_image: credential }); // 只能写自己的档案
  // 留档不带 detail：档案含联系方式 / 真实姓名 / 学信网截图等敏感字段，不落留档库
  await logEvent(db, { action: 'teacher.profile.save', actorUserId: me.id, actorRole: 'teacher',
    entity: 'teacher_profile', entityId: me.id, req });
  return json({ message: MSG.PROFILE_SAVED });
}

// 教师广场列表：联系方式（签约后展示）与私密认证字段（真实姓名/学信网截图，双向匹配后按
// /api/teacher/profile 定点取）永不下发列表；登录态附 matched 标记供前端判定可见性
export async function handleGetTeachers(db, req) {
  const me = await authUser(db, req); // 访客可浏览公开列表，令牌非必需
  const teachers = (await dbGetTeachers(db, { viewerId: me ? me.id : null }))
    .map(({ wechat, email, real_name, credential_image, ...rest }) => rest);
  return json({ teachers });
}
