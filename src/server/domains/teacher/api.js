/**
 * 路由模块：教师（档案读写 / 教师列表 / 学信网核验）
 * 档案可见性（S4-03/06，身份一律凭令牌）：
 *   本人       GET /api/teacher/profile 全字段（含联系方式/真实姓名/学信网截图，供编辑表单预填）；
 *             ?userId= 指向他人一律 403（不再有「双向匹配/已签约」他人可见路径，S4-07 删门禁）
 *   公开        GET /api/teachers/:id/profile 公开详情 + GET /api/teachers 列表——
 *             wechat/email/real_name/credential_image 永不下发
 * 依赖：util / security（requireUser）/ constants（校验文案/限额/门牌守卫）/ db / log。
 */
import { json, errorMsg, sanitizeTimeSlots, parseIdParam } from '../../core/util.js';
import { requireUser, requireAdmin } from '../../core/security.js';
import { MSG } from '../../../shared/codes.js';
import { LIMITS, CONFIG } from '../../../shared/config.js';
import { TEACHING_METHODS, PERSONALITY_TAGS, NONACADEMIC_PROJECTS, SUBJECTS, TEACHER_GRADES, GENDERS } from '../../../shared/enums.js';
import { SUFE_REGIONS } from '../../../shared/region-data.js'; // V-2-4c 地区数据单源
import { dbGetTeacherProfile, dbUpsertTeacherProfile, dbGetUserById, dbGetTeacherVerification, dbUpsertTeacherVerification, dbListTeacherVerifications, dbGetTeacherVerificationById, dbApplyChsiToProfile, dbClearChsiFromProfile, dbSetTeacherVerified, safeJsonArray } from '../../../../server/db.js';
import { GAOKAO_FULL_STAGE_GRADE } from './repo.js'; // PA-1d-F4: full-score derivation grade stage (single source with the mapper)
import { verifyChsiCode } from '../../../../server/chsi.js';
import { logEvent } from '../../core/log.js';
import { decryptField } from '../../core/crypto.js';
import { confirmDangerOtp } from '../../core/danger-ops.js';
import { notifyUser } from '../../core/notify.js';
import { handleGetTeachers } from './list.js'; // S4-09..12 教师广场列表（排序/筛选/匹配度）

// ============================================================
// 接单资格（v1.2.0 T3）：教师能接单 = 学信网核验通过（chsi_verified=1）
// + 资料必填齐全（科目/报价/可授课时间/授课方式）。写路径（意向提交/推送接受/签约创建）统一门禁。
// ============================================================
export function acceptEligibility(profile) {
  if (!profile) return { ok: false, reason: 'PROFILE_INCOMPLETE' };
  if (!profile.chsi_verified) return { ok: false, reason: 'CHSI_UNVERIFIED' };
  const subjects = safeJsonArray(profile.subjects);
  if (!subjects.length) return { ok: false, reason: 'PROFILE_INCOMPLETE' };
  if (profile.price_min == null) return { ok: false, reason: 'PROFILE_INCOMPLETE' };
  // T-6-F3: time_slots arrives as a parsed array from mapTeacherProfileRow (safeJsonArray output);
  // length check keeps the empty-array gate airtight (a truthy [] must not pass) and is idempotent
  // for any legacy string form. Mutation guard: reverting to `!profile.time_slots` turns [] truthy.
  const timeSlots = safeJsonArray(profile.time_slots);
  if (!timeSlots.length) return { ok: false, reason: 'PROFILE_INCOMPLETE' };
  if (!profile.teaching_method) return { ok: false, reason: 'PROFILE_INCOMPLETE' };
  return { ok: true };
}

/** POST /api/teacher/verify-chsi —— 教师提交《学籍在线验证报告》验证码核验（v1.5.0 起仅 manual）
 *  验证码格式通过后进管理员核验队列（pending），管理员在学信网官方页查证后结构化录入。 */
export async function handleVerifyChsi(db, body, req) {
  const { user: me, err } = await requireUser(db, req);
  if (err) return err;
  if (me.role !== 'teacher') return errorMsg('NO_PERMISSION', 403);
  const code = String((body && body.code) || '').trim();
  const v = await verifyChsiCode(code);
  if (!v.ok) return v.code === 'CHSI_PROVIDER_INVALID'
    ? errorMsg('CHSI_UNAVAILABLE', 503)
    : errorMsg('CHSI_CODE_INVALID');
  // I-41/S4-04：已通过核验的教师不得反复提交打回 pending 骚扰队列（与 admission 通道同口径；
  // 学籍变更走管理员撤销后重验，非本通道）
  const existing = await dbGetTeacherVerification(db, me.id);
  if (existing && existing.status === 'approved') return errorMsg('ADMISSION_ALREADY_VERIFIED', 409);
  await dbUpsertTeacherVerification(db, {
    userId: me.id, verifyCode: code, status: 'pending', provider: v.provider,
  });
  await logEvent(db, { action: 'teacher.chsi.submit', actorUserId: me.id, actorUsername: me.username,
    actorRole: 'teacher', entity: 'user', entityId: me.id, detail: { provider: v.provider, status: 'pending' }, req });
  return json({ ok: true, status: 'pending', provider: v.provider });
}

// v1.4.16 大一新生录取通知书验证（学信网大一生未录入时的替代通道）：
// 教师上传录取通知书整页照片 → 加密落库 → 进管理员核验队列（与学信网同一收口，管理员人工核对后开放接单资格）
const ADMISSION_MIME_WHITELIST = { 'image/jpeg': [0xff, 0xd8, 0xff], 'image/png': [0x89, 0x50, 0x4e, 0x47], 'image/webp': [0x52, 0x49, 0x46, 0x46] };

/** 校验录取通知书图片：data URL + MIME 白名单（大小写不敏感）+ magic bytes 校验（防任意数据入库/存储滥用） */
function validateAdmissionImage(image) {
  const m = /^data:(image\/[a-z+.-]+);base64,(.+)$/i.exec(image);
  if (!m) return false;
  const mime = m[1].toLowerCase();
  const magic = ADMISSION_MIME_WHITELIST[mime];
  if (!magic) return false; // 仅 jpeg/png/webp（svg 一律拒，网安全站拒 svg）
  try {
    const bytes = Uint8Array.from(atob(m[2].replace(/\s/g, '')), c => c.charCodeAt(0));
    if (bytes.length < magic.length) return false;
    // webp 是 RIFF....WEBP 容器，magic 前 4 字节 RIFF；特判
    if (mime === 'image/webp') {
      if (String.fromCharCode(...bytes.slice(0, 4)) !== 'RIFF' || String.fromCharCode(...bytes.slice(8, 12)) !== 'WEBP') return false;
      return true;
    }
    return magic.every((b, i) => bytes[i] === b);
  } catch { return false; }
}

export async function handleVerifyAdmission(db, body, req) {
  const { user: me, err } = await requireUser(db, req);
  if (err) return err;
  if (me.role !== 'teacher') return errorMsg('NO_PERMISSION', 403);
  const image = String((body && body.image) || '').trim();
  if (!image.startsWith('data:image/')) return errorMsg('ADMISSION_IMAGE_INVALID');
  if (image.length > LIMITS.CREDENTIAL_MAX_BYTES) return errorMsg('ADMISSION_IMAGE_TOO_LARGE');
  if (!validateAdmissionImage(image)) return errorMsg('ADMISSION_IMAGE_INVALID'); // 审计修复：MIME 白名单 + magic bytes（svg 大小写变体也被白名单拒）
  // 审计修复：已通过核验的教师不得反复提交打回 pending 骚扰队列（学籍变更走学信网重新验证，非本通道）
  const existing = await dbGetTeacherVerification(db, me.id);
  if (existing && existing.status === 'approved') return errorMsg('ADMISSION_ALREADY_VERIFIED', 409);
  await dbUpsertTeacherVerification(db, {
    userId: me.id, verifyCode: '', status: 'pending', provider: 'manual',
    verifyType: 'admission', admissionImage: image,
  });
  await logEvent(db, { action: 'teacher.admission.submit', actorUserId: me.id, actorUsername: me.username,
    actorRole: 'teacher', entity: 'user', entityId: me.id, detail: { status: 'pending', imageBytes: image.length }, req });
  return json({ ok: true, status: 'pending', verifyType: 'admission' });
}


// I-39 / S4-03：只返回本人档案（全字段，含联系方式/真实姓名/学信网截图，供编辑表单预填）。
// ?userId= 若存在且非本人 → 403（联系方式与私密认证字段仅本人可见；他人可见路径已由
// GET /api/teachers/:id/profile 公开详情取代，S4-07 删匹配/签约可见性门禁）。
export async function handleGetProfile(db, url, req) {
  const { user: me, err } = await requireUser(db, req);
  if (err) return err;
  const paramUserId = url.searchParams.get('userId');
  if (paramUserId && Number(paramUserId) !== me.id) return errorMsg('NO_PERMISSION', 403);
  const profile = await dbGetTeacherProfile(db, me.id);
  if (!profile) return json({ profile: null });
  return json({ profile }); // 本人：全字段（mapper 出门即解密）
}

// I-40 (PA-1d-F4): camelCase field aliases -> DB snake_case columns. A body key present in either
// form marks the DB column as explicitly provided (merge semantics: partial save = keep old value).
const PROFILE_FIELD_ALIASES = {
  region: 'province',
  teacherName: 'teacher_name',
  priceMin: 'price_min',
  priceMax: 'price_max',
  experienceYears: 'experience_years',
  graduationYear: 'graduation_year',
  timeSlots: 'time_slots',
  personalityTags: 'personality_tags',
  teachingMethod: 'teaching_method',
  gaokaoScores: 'gaokao_scores',
  nonacademicProjects: 'nonacademic_projects',
  nonacademicPrices: 'nonacademic_prices',
  bio: 'intro',
  addressArea: 'address',
  realName: 'real_name',
  credentialImage: 'credential_image',
};
// Columns dbUpsertTeacherProfile can write; stray/unknown body keys are ignored (C3/C4 defensiveness).
const WRITABLE_PROFILE_COLUMNS = new Set([
  'province', 'grade', 'gender', 'subjects', 'gaokao_scores', 'price_min', 'price_max',
  'wechat', 'email', 'intro', 'address', 'school', 'real_name', 'credential_image',
  'time_slots', 'teaching_method', 'personality_tags', 'nonacademic_projects', 'nonacademic_prices',
  'graduation_year', 'teacher_name', 'experience_years', 'philosophy',
]);

export async function handleSaveProfile(db, body, req) {
  const { profile: raw = {} } = body;
  if (typeof raw !== 'object' || raw === null) return errorMsg('INVALID_PARAMS'); // 空 body 兜底
  const { user: me, err } = await requireUser(db, req);
  if (err) return err;
  if (me.role !== 'teacher') return errorMsg('NO_PERMISSION', 403); // 仅教师可建档案（防学生/管理员写 teacher_profiles）

  // I-40 dual-receive: normalize camelCase aliases to DB snake_case columns; keep v2 keys as-is.
  // `provided` tracks which DB columns were explicitly supplied so the repo can merge (UPDATE only
  // provided columns) instead of a full overwrite — omitted fields keep their stored value.
  const p = { ...raw };
  const provided = new Set();
  for (const key of Object.keys(raw)) {
    const col = PROFILE_FIELD_ALIASES[key] || key;
    if (!WRITABLE_PROFILE_COLUMNS.has(col)) continue; // stray/unknown key: ignore, don't 5xx (C4)
    provided.add(col);
    if (col !== key) p[col] = raw[key];
  }
  if (provided.size === 0) return errorMsg('INVALID_PARAMS'); // nothing to update

  if (!p.province || !SUFE_REGIONS.isValidProvince(p.province)) return errorMsg('PROVINCE_REQUIRED');

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

  // R2-1 可授课时间段：与需求 expected_time 同格式、同一 sanitizeTimeSlots 校验（可选，空串合法）。
  // I-40 双收：对象数组 shape（JSON.stringify 后校验）或既有序列化 JSON 串；缺省 = 保留原值（merge）。
  if (provided.has('time_slots')) {
    const rawTs = Array.isArray(p.time_slots) ? JSON.stringify(p.time_slots) : p.time_slots;
    const ts = sanitizeTimeSlots(rawTs);
    if (ts.error) return errorMsg('INVALID_TIME_SLOTS');
    p.time_slots = ts.value;
  }

  // R2-2 授课方式：白名单读 TEACHING_METHODS 单源（与前端 constants 同源，改 id 服务端不静默失配），非法值回退 ''（未填）
  const methodSet = new Set(TEACHING_METHODS.map(m => m.id));
  p.teaching_method = methodSet.has(p.teaching_method) ? p.teaching_method : '';

  // R2-3 性格关键词：数组、<=PERSONALITY_TAGS_MAX、每项在白名单（服务端直接读共享枚举，与前端同源）
  const P = PERSONALITY_TAGS;
  const personalitySet = new Set(P.map(t => t.id));
  const personalityMax = CONFIG.PERSONALITY_TAGS_MAX;
  if (p.personality_tags != null) {
    if (!Array.isArray(p.personality_tags)) return errorMsg('INVALID_PARAMS');
    if (p.personality_tags.length > personalityMax) return errorMsg('PERSONALITY_TAGS_TOO_MANY');
    p.personality_tags = [...new Set(p.personality_tags.filter(id => typeof id === 'string' && personalitySet.has(id)))];
  } else {
    p.personality_tags = [];
  }

  // R2-4 擅长非学科类项目 + 报价：projects 白名单去重；prices 每项 project 须在 projects 内、
  // 价格数字且 min<=max、钳制 [0, BUDGET_MAX]
  const N = NONACADEMIC_PROJECTS;
  const nonacademicSet = new Set(N.map(x => x.id));
  if (p.nonacademic_projects != null) {
    if (!Array.isArray(p.nonacademic_projects)) return errorMsg('INVALID_PARAMS');
    p.nonacademic_projects = [...new Set(p.nonacademic_projects.filter(id => typeof id === 'string' && nonacademicSet.has(id)))];
  } else {
    p.nonacademic_projects = [];
  }
  if (p.nonacademic_prices != null) {
    if (!Array.isArray(p.nonacademic_prices)) return errorMsg('INVALID_PARAMS');
    const sel = new Set(p.nonacademic_projects);
    const seen = new Set(); // Q-2c-F7 BUG-M：同一项目重复报价行只保留首条（防铺量/展示重复）
    p.nonacademic_prices = p.nonacademic_prices
      .filter(it => it && typeof it === 'object' && typeof it.project === 'string' && sel.has(it.project) && !seen.has(it.project) && (seen.add(it.project), true))
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
  //   与前端科目池同源（Z-11-F4 删 teacherSubjectPool 后此注释不再指前端函数）；注入串/未知 id 一律丢弃，去重 + 按池大小封顶防铺量 DoS。
  const R = SUFE_REGIONS;
  const subjPool = new Set([
    ...SUBJECTS.map(s => s.id),
    ...Object.keys(R.subjectNames || {}),
  ]);
  if (p.subjects != null) {
    if (!Array.isArray(p.subjects)) return errorMsg('INVALID_PARAMS');
    if (p.subjects.length === 0) {
      p.subjects = [];
    } else if (typeof p.subjects[0] === 'string') {
      // v2 legacy shape: string id array — filter to the subject pool + dedupe (existing behavior)
      p.subjects = [...new Set(p.subjects.filter(id => typeof id === 'string' && subjPool.has(id)))].slice(0, subjPool.size);
    } else if (typeof p.subjects[0] === 'object' && p.subjects[0] !== null) {
      // I-40 new shape: object rows [{subject, score?, full?}] — subject id must be in the pool;
      // `score` normalized to a finite number (clamped to [0, GAOKAO_SCORE_MAX]); `full` derived by
      // region/grade (frontend value ignored); stored as the same object-array shape the mapper emits
      // (teacherSubjectRows), so read-back is consistent (PA-1d-F4).
      const seen = new Set();
      p.subjects = p.subjects
        .filter(it => it && typeof it === 'object' && typeof it.subject === 'string' && subjPool.has(it.subject) && !seen.has(it.subject) && (seen.add(it.subject), true))
        .slice(0, subjPool.size)
        .map(it => {
          let score = null;
          if (it.score != null) {
            const n = Number(it.score);
            if (Number.isFinite(n)) score = Math.min(LIMITS.GAOKAO_SCORE_MAX, Math.max(0, n));
          }
          const full = SUFE_REGIONS.subjectMaxFor(p.province, it.subject, GAOKAO_FULL_STAGE_GRADE) || 0;
          return { subject: it.subject, score, full, awards: [] };
        });
    } else {
      return errorMsg('INVALID_PARAMS'); // mixed/foreign element type — reject, don't guess (C5)
    }
  } else {
    p.subjects = [];
  }

  // 教师年级/性别白名单（同 teaching_method 静默回退口径）：非法/缺省回 ''（未填）；性别含历史 nonbinary 兼容
  // Q-2c-F2（回滚重做）：undefined/null 穿透白名单（原 `p.x != null` 只拦非空非法值）→ repo 裸绑 undefined → 500
  // （V-4-1d 同型在 teacher 侧未修）。统一 `!set.has(p.x || '')` 归一空串。
  const gradeSet = new Set(TEACHER_GRADES.map(g => g.id));
  if (!gradeSet.has(p.grade || '')) p.grade = '';
  const genderSet = new Set(GENDERS.map(g => g.id));
  genderSet.add('nonbinary'); // 存量兼容：历史 nonbinary 保留，展示层已视同未填
  if (!genderSet.has(p.gender || '')) p.gender = '';

  // S4-08/I-40 教师公开展示名（teacher_name 列，空时回退 username）：trim + 截断到 REAL_NAME_MAX
  // （展示名上限，同 real_name 口径）；缺省保留原值（部分省略 = 不改该字段）
  if (p.teacher_name != null) p.teacher_name = String(p.teacher_name).trim().slice(0, LIMITS.REAL_NAME_MAX);

  // S4-10/I-40 教学年限（experience_years 列，公开）：''/null/undefined → null（未填）；
  // 否则必须为非负整数（严格校验，宽松强转被拒——' 3'、'3.0'、'3abc' 一律 400；小整数不钳制）
  const expYears = p.experience_years;
  if (expYears == null || expYears === '') {
    p.experience_years = null;
  } else {
    const expN = Number(expYears);
    if (!Number.isInteger(expN) || expN < 0) return errorMsg('INVALID_PARAMS', 400);
    p.experience_years = expN;
  }

  // I-40 教学理念（philosophy 列，公开）：trim + 截断到 ADDITIONAL_INFO_MAX（教学理念是较长自由文本）。
  // 缺省 = 保留原值（merge 由 repo 按 provided 落）；显式 ''/null 允许清空。
  if (provided.has('philosophy') && p.philosophy != null) {
    p.philosophy = String(p.philosophy).trim().slice(0, LIMITS.ADDITIONAL_INFO_MAX);
  }

  // 高考成绩：数组、≤科目池封顶；每项 subject 在白名单；score 数值且钳到 [0, GAOKAO_SCORE_MAX]
  // （全政策单科最高 = 海南标准分 300，语数英 150/其他 100/旧综合 300 均在界内；分政策精度属前端按
  // 地区+毕业年份渲染职责，服务端只做纵深防御）；grade 等第 id 白名单（region-data 全档位并集）。
  // 非法项丢弃（成绩填错不该打回整张档案，同需求侧静默过滤语义）。
  const GS = R.gradeSystems || {};
  const gradeIds = new Set();
  for (const g of Object.values(GS)) if (g && Array.isArray(g.levels)) for (const lv of g.levels) gradeIds.add(lv.id);
  const GAOKAO_SCORE_MAX = LIMITS.GAOKAO_SCORE_MAX;
  if (p.gaokao_scores != null) {
    if (!Array.isArray(p.gaokao_scores)) return errorMsg('INVALID_PARAMS');
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
  // svg 一律拒绝：矢量可内嵌脚本（与 auth 域头像口径一致；上限单源 LIMITS.CREDENTIAL_MAX_BYTES）
  if (credential && (!credential.startsWith('data:image/') || credential.startsWith('data:image/svg') || credential.length > LIMITS.CREDENTIAL_MAX_BYTES)) return errorMsg('AVATAR_INVALID');
  // Q-2c-F5（回滚重做）：自由文本（intro/school）门牌红线审计已由 _worker 全局断点 auditBeforeWrite
  // 统一接管（AUDIT_MAP /api/teacher/profile → profile.intro/profile.school，POST/PUT 全覆盖），
  // 域内不再重复调用 text-audit（原双审致 DeepSeek 调用翻倍）。合规红线不因字段绕行仍有效。
  // 需求五：上海常住地结构化校验——非空则必须合法「区·镇/街道」；空 = 未填（不参与距离匹配）
  {
    const R = SUFE_REGIONS;
    const addr = typeof p.address === 'string' ? p.address.trim() : '';
    if (addr && R && !R.isValidShanghaiAddr(addr)) return errorMsg('ADDRESS_REQUIRED');
    p.address = addr;
  }
  if (typeof p.wechat === 'string') p.wechat = p.wechat.slice(0, LIMITS.CONTACT_MAX);
  if (typeof p.email === 'string') p.email = p.email.slice(0, LIMITS.CONTACT_MAX);
  await dbUpsertTeacherProfile(db, me.id, { ...p, credential_image: credential }, provided); // 只能写自己的档案；provided 驱动 merge UPDATE
  // 留档不带 detail：档案含联系方式 / 真实姓名 / 学信网截图等敏感字段，不落留档库
  await logEvent(db, { action: 'teacher.profile.save', actorUserId: me.id, actorRole: 'teacher',
    entity: 'teacher_profile', entityId: me.id, req });
  return json({ message: MSG.PROFILE_SAVED });
}

/** GET /api/teachers/:id/profile —— 教师公开详情（I-30 / S4-06）。
 *  登录可见（requireUser，与 I-29 列表同级门禁）；dbGetTeacherProfile 返回全字段（mapper 出门解密），
 *  这里剥离四个私密字段——wechat/email/real_name/credential_image 永不下发（仅本人经 /api/teacher/profile 取回）。 */
export async function handleGetTeacherPublic(db, id, req) {
  const { user: me, err } = await requireUser(db, req);
  if (err) return err;
  const profile = await dbGetTeacherProfile(db, id);
  if (!profile) return errorMsg('USER_NOT_FOUND', 404);
  // I-30 / S4-06：联系方式 / 真实姓名 / 学信网截图永不公开
  const { wechat, email, real_name, credential_image, ...publicPart } = profile;
  return json({ profile: publicPart });
}

/** GET /api/teacher/verify-status —— 学信网核验状态（none 未提交 / pending 待管理员核验 / approved 已通过） */
export async function handleChsiStatus(db, req) {
  const { user: me, err } = await requireUser(db, req);
  if (err) return err;
  if (me.role !== 'teacher') return errorMsg('NO_PERMISSION', 403);
  const v = await dbGetTeacherVerification(db, me.id);
  if (!v) return json({ status: 'none' });
  // Q-2c-F7 BUG-I：回传 verify_type——前端需区分 chsi（验证码核验）与 admission（录取通知书）通道渲染对应 UI。
  // I-43：同时下发 camelCase verifyType（新前端契约）与 snake_case verify_type（v2 契约），双键兼容。
  return json({ status: v.status, provider: v.provider, verify_type: v.verify_type, verifyType: v.verify_type });
}

// ============================================================
// 管理员：教师认证审核（V-1-4c 迁入，teacher 域自持）
// ============================================================
// POST /api/admin/teachers/:id/verify { verified } —— 学籍认证审核（运营建议：管理员核对学信网截图后置 1）
export async function handleVerifyTeacher(db, userId, body, req) {
  const { admin, err } = await requireAdmin(db, req);
  if (err) return err;
  const target = await dbGetUserById(db, userId);
  if (!target) return errorMsg('USER_NOT_FOUND', 404);
  if (target.role !== 'teacher') return errorMsg('TEACHER_ONLY', 403);
  // 学籍认证 = 信任锚点操作（影响学生对教师的信任判断），须 capToken 二次认证
  if (!(await confirmDangerOtp(db, req, body))) return errorMsg('REAUTH_FAILED', 403);
  const verified = body.verified ? 1 : 0;
  await dbSetTeacherVerified(db, userId, verified);
  await logEvent(db, { action: verified ? 'admin.teacher.verify' : 'admin.teacher.unverify', actorUserId: admin.id,
    actorUsername: admin.username, actorRole: 'admin', entity: 'user', entityId: userId,
    detail: { targetUsername: target.username, verified }, req });
  return json({ ok: true, verified });
}

// 学信网核验队列（manual provider：管理员查证后结构化录入）
export async function handleListVerifications(db, url, req) {
  const { err } = await requireAdmin(db, req);
  if (err) return err;
  const status = url.searchParams.get('status') || 'all';
  const list = await dbListTeacherVerifications(db, status) || [];
  return json({ verifications: list });
}

// POST /api/admin/verifications/:id/action { action:'approve'|'reject'|'revoke', school, level, major, enrollment_status, enroll_year, reason }
// approve：结构化录入学信网字段 + 自动填入教师档案 + 通知教师；reject：通知教师
export async function handleVerificationAction(db, id, body, req) {
  const { admin, err } = await requireAdmin(db, req);
  if (err) return err;
  const v = await dbGetTeacherVerificationById(db, id);
  if (!v) return errorMsg('USER_NOT_FOUND', 404);
  // P12 危险操作二次认证：批准/拒绝/撤销学籍核验资格均可逆影响接单资格，须 capToken
  // （与 handleVerifyTeacher 同口径；U-3e 补齐此前缺口）
  if (!(await confirmDangerOtp(db, req, body))) return errorMsg('REAUTH_FAILED', 403);
  const action = body.action;
  // 状态机（安全审计 H2 修复）：pending 才能 approve/reject；approved 才能 revoke（撤销已通过资格）
  if (action === 'approve' && v.status !== 'pending') return errorMsg('INVALID_ACTION', 409);
  if (action === 'reject' && v.status !== 'pending') return errorMsg('INVALID_ACTION', 409);
  if (action === 'revoke' && v.status !== 'approved') return errorMsg('INVALID_ACTION', 409);
  if (action === 'approve') {
    const school = String(body.school || '').trim().slice(0, LIMITS.SCHOOL_MAX);
    const level = String(body.level || '').trim().slice(0, 20);
    const major = String(body.major || '').trim().slice(0, 60);
    const enrollmentStatus = String(body.enrollment_status || '').trim().slice(0, 20);
    const enrollYear = String(body.enroll_year || '').trim().slice(0, 10);
    if (!school || !level) return errorMsg('INVALID_PARAMS', 400); // 院校/层次必填（结构化输入）
    const now = new Date().toISOString();
    // Q-2c-F1（回滚重做，审计 FINDING 修正）：approve/reject/revoke 三处透传链 admission_image
    // 必须先 decryptField 再交 repo（repo 会再 encryptField）——透传库中密文 enc1 会二次加密 enc2，
    // 每次 admin 动作叠层（审核链数据腐坏，decrypt 得到 enc1 密文串）。verifyCode 分支早已解密，本函数补对称。
    await dbUpsertTeacherVerification(db, {
      userId: v.user_id, verifyCode: await decryptField(v.verify_code), status: 'approved', provider: v.provider || 'manual',
      verifyType: v.verify_type || 'chsi', admissionImage: v.admission_image ? await decryptField(v.admission_image) : '',
      school, level, major, enrollmentStatus, enrollYear, verifiedBy: admin.id, verifiedAt: now,
    });
    await dbApplyChsiToProfile(db, v.user_id, { school, level, major, enrollmentStatus, enrollYear });
    await notifyUser(db, v.user_id, 'VERIFY_APPROVED', {
      verifyType: v.verify_type || 'chsi',
      detail: `${school} · ${level}${major ? ' · ' + major : ''}`,
    });
    await logEvent(db, { action: 'admin.chsi.approve', actorUserId: admin.id, actorUsername: admin.username,
      actorRole: 'admin', entity: 'user', entityId: v.user_id, detail: { school, level, major, verifyType: v.verify_type }, req });
    return json({ ok: true });
  }
  if (action === 'reject' || action === 'revoke') {
    const reason = String(body.reason || '').trim().slice(0, 200);
    // Q-2c-F1（回滚重做）：reject/revoke 同款解密再重加密（与 approve 对称），防 enc2 叠层
    await dbUpsertTeacherVerification(db, {
      userId: v.user_id, verifyCode: await decryptField(v.verify_code), status: 'rejected', provider: v.provider || 'manual',
      verifyType: v.verify_type || 'chsi', admissionImage: v.admission_image ? await decryptField(v.admission_image) : '',
      verifiedBy: admin.id, verifiedAt: new Date().toISOString(),
    });
    // 安全审计 H2：reject/revoke 同步撤销接单资格 + 清空学信网展示字段（误批/欺诈核验可回收）
    await dbClearChsiFromProfile(db, v.user_id);
    // Q-2c-F7 BUG-H：revoke（撤销已通过资格）与 reject（拒绝待审）语义不同，
    // 不再复用 VERIFY_REJECTED（「学信网核验未通过」对已通过用户是误导），revoke 用专用类型。
    await notifyUser(db, v.user_id, action === 'revoke' ? 'VERIFY_REVOKED' : 'VERIFY_REJECTED', { reason: reason || '' });
    await logEvent(db, { action: action === 'revoke' ? 'admin.chsi.revoke' : 'admin.chsi.reject',
      actorUserId: admin.id, actorUsername: admin.username,
      actorRole: 'admin', entity: 'user', entityId: v.user_id, detail: { reason }, req });
    return json({ ok: true });
  }
  return errorMsg('INVALID_ACTION', 400);
}

// ============================================================
// teacher 域路由表（V-1-4c：含管理员教师认证审核）
// ============================================================
const S = (method, path, handler) => ({ method, path, handler });
export const routes = [
  S('GET', '/api/teacher/profile', c => handleGetProfile(c.db, c.url, c.req)),
  S('POST', '/api/teacher/profile', c => handleSaveProfile(c.db, c.body, c.req)),
  S('PUT', '/api/teacher/profile', c => handleSaveProfile(c.db, c.body, c.req)), // I-40：与 POST 同 handler（部分省略=保留原值）
  S('POST', '/api/teacher/verify-chsi', c => handleVerifyChsi(c.db, c.body, c.req)),
  S('POST', '/api/teacher/verify-admission', c => handleVerifyAdmission(c.db, c.body, c.req)),
  S('GET', '/api/teacher/verify-status', c => handleChsiStatus(c.db, c.req)),
  S('GET', '/api/teachers', c => handleGetTeachers(c.db, c.req)),
  S('GET', '/api/teachers/:id/profile', c => handleGetTeacherPublic(c.db, parseIdParam(c.params.id), c.req)), // I-30：公开详情，私密字段永不下发
  S('POST', '/api/admin/teachers/:id/verify', c => handleVerifyTeacher(c.db, parseIdParam(c.params.id), c.body, c.req)),
  S('GET', '/api/admin/verifications', c => handleListVerifications(c.db, c.url, c.req)),
  S('POST', '/api/admin/verifications/:id/action', c => handleVerificationAction(c.db, parseIdParam(c.params.id), c.body, c.req)),
];
