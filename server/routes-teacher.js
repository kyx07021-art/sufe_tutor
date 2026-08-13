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
import { MSG, LIMITS } from './constants.js';
import { auditFreeText } from './text-audit.js';
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

  // R2-12 毕业年份：空/null 合法（null=未填，前端按最新政策渲染赋分组件）；否则须为严格四位数字
  // （网安 L1：拒 Number() 宽松强转——' '→1980、'0x7e4'→2020、[2020]→2020、true→1980 等误写），
  // 钳制到 [1980, 2030]（同前端 CONFIG.GRAD_YEAR_MIN/MAX 单源值）；非法回 ''（db 层归一 null）。
  const clampGradYear = v => {
    if (v === '' || v == null) return null;
    const s = typeof v === 'number' && Number.isInteger(v) ? String(v) : v;
    if (typeof s !== 'string' || !/^\d{4}$/.test(s)) return '';
    const n = +s;
    return Math.min(LIMITS.GRAD_YEAR_MAX, Math.max(LIMITS.GRAD_YEAR_MIN, n));
  };
  p.graduation_year = clampGradYear(p.graduation_year);

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

  // R2-6 擅长科目 / 高考成绩白名单（网安纵深防御，与需求侧 target_subjects 同款口径）：
  //   科目池 = constants SUBJECTS + region-data subjectNames 全量 id（含浙江技术等地区科目），
  //   与前端 teacherSubjectPool 同源；注入串/未知 id 一律丢弃，去重 + 按池大小封顶防铺量 DoS。
  const R = globalThis.SUFE_REGIONS || {};
  const subjPool = new Set([
    ...((globalThis.APP_CONSTANTS && globalThis.APP_CONSTANTS.SUBJECTS) || []).map(s => s.id),
    ...Object.keys(R.subjectNames || {}),
  ]);
  if (p.subjects != null) {
    if (!Array.isArray(p.subjects)) return error(MSG.INVALID_PARAMS);
    p.subjects = [...new Set(p.subjects.filter(id => typeof id === 'string' && subjPool.has(id)))].slice(0, subjPool.size);
  } else {
    p.subjects = [];
  }

  // 教师年级/性别白名单（同 teaching_method 静默回退口径）：非法回 ''（未填）；性别含历史 nonbinary 兼容
  const gradeSet = new Set(((globalThis.APP_CONSTANTS && globalThis.APP_CONSTANTS.TEACHER_GRADES) || []).map(g => g.id));
  if (p.grade != null && !gradeSet.has(p.grade)) p.grade = '';
  const genderSet = new Set(((globalThis.APP_CONSTANTS && globalThis.APP_CONSTANTS.GENDERS) || []).map(g => g.id));
  genderSet.add('nonbinary'); // 存量兼容：历史 nonbinary 保留，展示层已视同未填
  if (p.gender != null && !genderSet.has(p.gender)) p.gender = '';

  // 高考成绩：数组、≤科目池封顶；每项 subject 在白名单；score 数值且钳到 [0, GAOKAO_SCORE_MAX]
  // （全政策单科最高 = 海南标准分 300，语数英 150/其他 100/旧综合 300 均在界内；分政策精度属前端按
  // 地区+毕业年份渲染职责，服务端只做纵深防御）；grade 等第 id 白名单（region-data 全档位并集）。
  // 非法项丢弃（成绩填错不该打回整张档案，同需求侧静默过滤语义）。
  const GS = R.gradeSystems || {};
  const gradeIds = new Set();
  for (const g of Object.values(GS)) if (g && Array.isArray(g.levels)) for (const lv of g.levels) gradeIds.add(lv.id);
  const GAOKAO_SCORE_MAX = LIMITS.GAOKAO_SCORE_MAX;
  if (p.gaokao_scores != null) {
    if (!Array.isArray(p.gaokao_scores)) return error(MSG.INVALID_PARAMS);
    p.gaokao_scores = p.gaokao_scores
      .filter(it => it && typeof it === 'object' && typeof it.subject === 'string' && subjPool.has(it.subject))
      .map(it => {
        const out = { subject: it.subject };
        if (it.score != null) {
          const n = Number(it.score);
          if (Number.isFinite(n)) out.score = Math.min(GAOKAO_SCORE_MAX, Math.max(0, n));
        }
        if (typeof it.grade === 'string' && gradeIds.has(it.grade)) out.grade = it.grade;
        return out;
      })
      .filter(it => it.score != null || it.grade != null)
      .slice(0, subjPool.size);
  } else {
    p.gaokao_scores = [];
  }

  const credential = String(p.credential_image || '');
  // svg 一律拒绝：矢量可内嵌脚本（与 routes-auth 头像口径一致；上限单源 LIMITS.CREDENTIAL_MAX_BYTES）
  if (credential && (!credential.startsWith('data:image/') || credential.startsWith('data:image/svg') || credential.length > LIMITS.CREDENTIAL_MAX_BYTES)) return error(MSG.AVATAR_INVALID);
  // 2026-08-09 审计 F-1/F-4：自由文本（intro/school）同守门牌红线；联系方式统一截断（db 层仅 real_name/intro/address/school 有切片）
  // 需求五（2026-08-13）：address 改结构化「上海常住地」（区·镇/街道 picker），不再自由文本 → 移出门牌审核；
  //   intro/school 仍为自由文本，保留 text-audit 咽喉（合规红线：详细门牌号不收集不因字段绕行）
  for (const f of ['intro', 'school']) {
    const audit = await auditFreeText(p[f]);
    if (!audit.ok) return error(MSG.ADDRESS_TOO_DETAILED); // 合规红线：详细门牌号/可定位住址不收集
  }
  // 需求五：上海常住地结构化校验——非空则必须合法「区·镇/街道」；空 = 未填（不参与距离匹配）
  {
    const R = globalThis.SUFE_REGIONS;
    const addr = typeof p.address === 'string' ? p.address.trim() : '';
    if (addr && R && !R.isValidShanghaiAddr(addr)) return error(MSG.ADDRESS_REQUIRED);
    p.address = addr;
  }
  if (typeof p.wechat === 'string') p.wechat = p.wechat.slice(0, LIMITS.CONTACT_MAX);
  if (typeof p.email === 'string') p.email = p.email.slice(0, LIMITS.CONTACT_MAX);
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
