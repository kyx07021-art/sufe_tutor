/**
 * 路由模块：教师（档案读写 / 教师列表）
 * 档案可见性三级（身份一律凭令牌）：
 *   本人       全字段（含联系方式/真实姓名/学信网截图，供编辑表单预填）
 *   双向匹配   公开档案 + 真实姓名 + 学信网截图（联系方式仍按「签约后展示」规则不下发）
 *   公开/游客  仅公开档案（列表接口，联系方式与私密认证字段一律剥离）
 * 依赖：util / security（requireUser）/ constants（校验文案/限额/门牌守卫）/ db / log。
 */
import { json, errorMsg, sanitizeTimeSlots, parseIdParam} from "../../core/util.js";
import { authUser, requireUser, requireAdmin } from '../../core/security.js';
import { MSG } from '../../../shared/codes.js';
import { LIMITS, CONFIG } from '../../../shared/config.js';
import { TEACHING_METHODS, PERSONALITY_TAGS, NONACADEMIC_PROJECTS, SUBJECTS, TEACHER_GRADES, GENDERS, VERIFY_TYPES } from '../../../shared/enums.js';
import { SUFE_REGIONS } from '../../../shared/region-data.js'; // V-2-4c 地区数据单源
import { dbGetTeacherProfile, dbUpsertTeacherProfile, dbGetTeachers, dbIsMatched, dbIsContracted, dbGetUserById, dbGetTeacherVerification, dbUpsertTeacherVerification, dbListTeacherVerifications, dbGetTeacherVerificationById, dbApplyChsiToProfile, dbClearChsiFromProfile, dbSetTeacherVerified, safeJsonArray } from '../../../../server/db.js';
import { verifyChsiCode } from '../../../../server/chsi.js';
import { logEvent } from '../../core/log.js';
import { decryptField } from '../../core/crypto.js';
import { confirmDangerOtp } from '../../core/danger-ops.js';
import { notifyUser } from '../../core/notify.js';

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
  if (!profile.time_slots) return { ok: false, reason: 'PROFILE_INCOMPLETE' };
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
    if (target && target.banned && !target.deactivated) return errorMsg('USER_NOT_FOUND', 404);
  }
  const profile = await dbGetTeacherProfile(db, targetId);
  if (!profile) return json({ profile: null });
  if (me.id === targetId) return json({ profile }); // 本人：全字段
  const { wechat, email, real_name, credential_image, ...publicPart } = profile;
  if (!(await dbIsMatched(db, me.id, targetId))) return errorMsg('NO_PERMISSION', 403);
  // v1.4.14 用户拍板：联系方式统一按「已签约」（dbIsContracted = signing_request signed）开放；
  // signed 字段随响应下发（前端展示/写评价判定的单一事实源，不再自算）
  const signed = me.role === 'student' && (await dbIsContracted(db, me.id, targetId));
  return json({ profile: { ...publicPart, real_name, credential_image, ...(signed ? { wechat, email } : {}), signed, matched: true } });
}

export async function handleSaveProfile(db, body, req) {
  const { profile: p = {} } = body;
  if (typeof p !== 'object' || p === null) return errorMsg('INVALID_PARAMS'); // 空 body 兜底
  const { user: me, err } = await requireUser(db, req);
  if (err) return err;
  if (me.role !== 'teacher') return errorMsg('NO_PERMISSION', 403); // 仅教师可建档案（防学生/管理员写 teacher_profiles）
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

  // R2-1 可授课时间段：与需求 expected_time 同格式、同一 sanitizeTimeSlots 校验（可选，空串合法）
  const ts = sanitizeTimeSlots(p.time_slots);
  if (ts.error) return errorMsg('INVALID_TIME_SLOTS');
  p.time_slots = ts.value;

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
    p.subjects = [...new Set(p.subjects.filter(id => typeof id === 'string' && subjPool.has(id)))].slice(0, subjPool.size);
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

/** GET /api/teacher/verify-status —— 学信网核验状态（none 未提交 / pending 待管理员核验 / approved 已通过） */
export async function handleChsiStatus(db, req) {
  const { user: me, err } = await requireUser(db, req);
  if (err) return err;
  if (me.role !== 'teacher') return errorMsg('NO_PERMISSION', 403);
  const v = await dbGetTeacherVerification(db, me.id);
  if (!v) return json({ status: 'none' });
  // Q-2c-F7 BUG-I：回传 verify_type——前端需区分 chsi（验证码核验）与 admission（录取通知书）通道渲染对应 UI
  return json({ status: v.status, provider: v.provider, verify_type: v.verify_type });
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

// v1.2.0 T6：学信网核验队列（manual provider：管理员查证后结构化录入）
export async function handleListVerifications(db, url, req) {
  const { err } = await requireAdmin(db, req);
  if (err) return err;
  const status = url.searchParams.get('status') || 'all';
  const list = await dbListTeacherVerifications(db, status) || [];
  return json({ verifications: list });
}

// POST /api/admin/verifications/:id/action { action:'approve'|'reject', school, level, major, enrollment_status, enroll_year }
// approve：结构化录入学信网字段 + 自动填入教师档案 + 通知教师；reject：通知教师
export async function handleVerificationAction(db, id, body, req) {
  const { admin, err } = await requireAdmin(db, req);
  if (err) return err;
  const v = await dbGetTeacherVerificationById(db, id);
  if (!v) return errorMsg('USER_NOT_FOUND', 404);
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
  S('POST', '/api/teacher/verify-chsi', c => handleVerifyChsi(c.db, c.body, c.req)),
  S('POST', '/api/teacher/verify-admission', c => handleVerifyAdmission(c.db, c.body, c.req)),
  S('GET', '/api/teacher/verify-status', c => handleChsiStatus(c.db, c.req)),
  S('GET', '/api/teachers', c => handleGetTeachers(c.db, c.req)),
  S('POST', '/api/admin/teachers/:id/verify', c => handleVerifyTeacher(c.db, parseIdParam(c.params.id), c.body, c.req)),
  S('GET', '/api/admin/verifications', c => handleListVerifications(c.db, c.url, c.req)),
  S('POST', '/api/admin/verifications/:id/action', c => handleVerificationAction(c.db, parseIdParam(c.params.id), c.body, c.req)),
];
