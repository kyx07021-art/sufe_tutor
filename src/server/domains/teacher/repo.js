/**
 * 教师域数据层（从 server/db.js 提取）：teacher_profiles / 教师列表 / 学信网核验。
 */
import { dbAll, dbGet, dbRun } from '../../core/util.js';
import { encryptField, decryptField } from '../../core/crypto.js';
import { safeJsonArray } from '../../core/json.js'; // safeJsonObject 零引用删除
import { LIMITS } from '../../../shared/config.js'; // INITIAL_RATING/INITIAL_WEIGHT 真正使用方在 auth/repo.js，此处零引用删除
import { SUFE_REGIONS } from '../../../shared/region-data.js'; // provinceName 单源（教师展示地区）
import { mapDemandRow } from '../demand/repo.js'; // 单科目新模型 canonical 需求映射（match 归一器消费 camelCase）

// 教师档案
// ============================================================
// 本人档案（含联系方式，编辑预填用）：与教师列表共用 mapper，反序列化只此一条路径
export async function dbGetTeacherProfile(db, userId) {
  const row = await dbGet(db, 'SELECT * FROM teacher_profiles WHERE user_id=?', [userId]);
  return row ? await mapTeacherProfileRow(row) : null;
}

// 双向匹配判定：两人间存在会话（意向被接受/推送被确认 = 建立联系）→ 真实姓名/学信网截图可见门槛
export async function dbIsMatched(db, userIdA, userIdB) {
  return !!(await dbGet(db,
    'SELECT id FROM conversations WHERE (student_user_id=? AND teacher_user_id=?) OR (student_user_id=? AND teacher_user_id=?)',
    [userIdA, userIdB, userIdB, userIdA]));
}

// Columns written by dbUpsertTeacherProfile, in INSERT order. `price` is the legacy mirror of
// price_min (kept in sync: writing price_min also writes price so a fresh row cannot eat the
// DEFAULT 0 and later be mis-backfilled as "price 0").
const WRITE_COLUMNS = [
  'province', 'grade', 'gender', 'subjects', 'gaokao_scores',
  'price', 'price_min', 'price_max', 'wechat', 'email', 'intro', 'address', 'school',
  'real_name', 'credential_image', 'time_slots', 'teaching_method',
  'personality_tags', 'nonacademic_projects', 'nonacademic_prices',
  'graduation_year', 'teacher_name', 'experience_years', 'philosophy',
];

// Prepare one teacher_profiles column value from the normalized profile object.
// Encryption columns are re-encrypted here; JSON columns serialized; absent/null free-text
// fields fall back to '' / null so a fresh INSERT row never carries undefined.
async function prepareProfileValue(profile, column) {
  switch (column) {
    case 'province': return profile.province || '';
    case 'grade': return profile.grade;
    case 'gender': return profile.gender;
    case 'subjects': return JSON.stringify(profile.subjects);
    case 'gaokao_scores': return JSON.stringify(profile.gaokao_scores);
    case 'price': return profile.price_min != null ? profile.price_min : null;
    case 'price_min': return profile.price_min != null ? profile.price_min : null;
    case 'price_max': return profile.price_max != null ? profile.price_max : null;
    case 'wechat': return await encryptField(profile.wechat || '');
    case 'email': return await encryptField(profile.email || '');
    case 'intro': return (profile.intro || '').slice(0, LIMITS.INTRO_MAX);
    case 'address': return (profile.address || '').slice(0, LIMITS.ADDRESS_FIELD_MAX);
    case 'school': return (profile.school || '').slice(0, LIMITS.SCHOOL_MAX);
    case 'real_name': return await encryptField((profile.real_name || '').slice(0, LIMITS.REAL_NAME_MAX));
    case 'credential_image': return await encryptField(profile.credential_image || '');
    case 'time_slots': return profile.time_slots || '';
    case 'teaching_method': return profile.teaching_method || '';
    case 'personality_tags': return JSON.stringify(Array.isArray(profile.personality_tags) ? profile.personality_tags : []);
    case 'nonacademic_projects': return JSON.stringify(Array.isArray(profile.nonacademic_projects) ? profile.nonacademic_projects : []);
    case 'nonacademic_prices': return JSON.stringify(Array.isArray(profile.nonacademic_prices) ? profile.nonacademic_prices : []);
    case 'graduation_year': return profile.graduation_year != null && profile.graduation_year !== '' ? profile.graduation_year : null;
    case 'teacher_name': return (profile.teacher_name || '').slice(0, LIMITS.REAL_NAME_MAX);
    case 'experience_years': return profile.experience_years != null && profile.experience_years !== '' ? profile.experience_years : null;
    case 'philosophy': return (profile.philosophy || '').slice(0, LIMITS.ADDITIONAL_INFO_MAX);
    default: throw new Error(`Unknown teacher_profile column: ${column}`);
  }
}

// 写路径（handleSaveProfile 调用）：`provided` = Set of DB columns the client explicitly supplied.
//   - existing row  → merge UPDATE: only provided columns are written; omitted columns keep their
// stored value (partial save = keep old). `price` mirrors `price_min` when the latter is written.
//   - fresh row     → INSERT every writable column; absent fields fall back to empty/null defaults
//     (JSON arrays '[]', time_slots/teaching_method '', prices null) — matches the legacy full-write shape.
// 网安 F-06/wechat/email/real_name/credential_image 加密落库（D1 泄露/备份不暴露教师私密信息）。
export async function dbUpsertTeacherProfile(db, userId, profile, provided) {
  const existing = await dbGet(db, 'SELECT id FROM teacher_profiles WHERE user_id=?', [userId]);
  const has = k => !provided || provided.has(k);

  if (existing) {
    const columns = [];
    for (const col of WRITE_COLUMNS) {
      if (col === 'price') { if (has('price_min')) columns.push('price'); continue; }
      if (has(col)) columns.push(col);
    }
    if (columns.length === 0) return; // empty partial update = no-op
    const values = [];
    for (const col of columns) values.push(await prepareProfileValue(profile, col));
    const setSql = columns.map(c => `${c}=?`).join(', ');
    await dbRun(db, `UPDATE teacher_profiles SET ${setSql}, updated_at=datetime('now') WHERE user_id=?`,
      [...values, userId]);
  } else {
    const values = [];
    for (const col of WRITE_COLUMNS) values.push(await prepareProfileValue(profile, col));
    const placeholders = WRITE_COLUMNS.map(() => '?').join(', ');
    await dbRun(db, `INSERT INTO teacher_profiles (user_id, ${WRITE_COLUMNS.join(', ')}) VALUES (?, ${placeholders})`,
      [userId, ...values]);
  }
}

// subject rows: { subject, score, full, awards[] } per teacher subject id.
// `subject` is the academic subject id; `score` is the teacher's recorded gaokao score
// for that subject (gaokao_scores row) when present, else null; `full` is the gaokao
// full score for the subject; `awards` stays an empty placeholder (no award data yet).
// The full score follows the senior-high gaokao convention (chinese/math/english 150,
// others 100) via region-data subjectMaxFor's senior branch — a university teacher grade
// would otherwise fall through to the conservative 100 fallback for every subject.
export const GAOKAO_FULL_STAGE_GRADE = 'senior3';
function teacherSubjectRows(p, gaokaoScores) {
  const raw = safeJsonArray(p.subjects);
  // (): subjects stored as the object-array shape the mapper emits —
  // [{subject, score, full, awards}] — read the rows back directly (the write path normalizes
  // score to a number and derives `full` from region/grade, so a stored row is already canonical).
  if (Array.isArray(raw) && raw.length && raw.every(x => x && typeof x === 'object' && !Array.isArray(x))) {
    return raw
      .filter(x => typeof x.subject === 'string' && x.subject)
      .map(x => ({
        subject: x.subject,
        score: x.score != null && Number.isFinite(Number(x.score)) ? Number(x.score) : null,
        full: x.full != null && Number.isFinite(Number(x.full))
          ? Number(x.full)
          : (SUFE_REGIONS.subjectMaxFor(p.province, x.subject, GAOKAO_FULL_STAGE_GRADE) || 0),
        awards: Array.isArray(x.awards) ? x.awards : [],
      }));
  }
  // v2 legacy shape: string id array — merge with gaokao_scores (existing behavior).
  const ids = raw.filter(x => typeof x === 'string' && x);
  const gkBySubject = new Map();
  for (const g of Array.isArray(gaokaoScores) ? gaokaoScores : []) {
    if (g && typeof g.subject === 'string') gkBySubject.set(g.subject, g);
  }
  return ids.map(id => {
    const gk = gkBySubject.get(id);
    const score = gk && gk.score != null ? Number(gk.score) : null;
    const full = gk && gk.full != null
      ? Number(gk.full)
      : (SUFE_REGIONS.subjectMaxFor(p.province, id, GAOKAO_FULL_STAGE_GRADE) || 0);
    return { subject: id, score, full, awards: [] };
  });
}

// 教师行映射器：教师列表 / 意向教师列表 / 本人档案共用，返回形状永远一致
// （JOIN 来的 username/avatar 在裸档案行上缺省为 undefined，JSON 序列化时自动略去）
// 网安报告 F-06：wechat/email/real_name 是加密列，出门即解密（调用方均为 async，Promise.all 收敛）
// 网安 credential_image 同款加密列，出门解密
// 数据最小化：private:false 时私密字段不解密、置空——广场列表一律裁剪（无论 viewer 是否匹配），
// 服务端硬把关；私密字段仅经 /api/teacher/profile 定点门控取回（matched 标记已从列表移除）
export async function mapTeacherProfileRow(p, { private: includePrivate = true } = {}) {
  const [wechat, email, realName, credentialImage] = includePrivate
    ? await Promise.all([
        decryptField(p.wechat), decryptField(p.email), decryptField(p.real_name), decryptField(p.credential_image),
      ])
    : ['', '', '', ''];
  return {
    id: p.id, user_id: p.user_id, username: p.username,
    province: p.province || '', grade: p.grade, gender: p.gender || '', intro: p.intro || '', address: p.address || '',
    school: p.school || '', real_name: realName || '', credential_image: credentialImage || '',
    verified: p.verified ? true : false, // 学籍认证（管理员审核通过）
    award_count: p.award_count != null ? Number(p.award_count) : 0, // 已审核荣誉奖项数（公开）
    subjects: teacherSubjectRows(p, safeJsonArray(p.gaokao_scores)),
    gaokao_scores: safeJsonArray(p.gaokao_scores),
    // R2-5 报价区间化：price_min/price_max 保留 null=未填（完整性门槛据此拦截）；price 保留供历史兼容，前端不再用
    price_min: p.price_min != null ? p.price_min : null,
    price_max: p.price_max != null ? p.price_max : null,
    price: p.price != null ? p.price : null,
    // R2-1/R2-2/R2-3/R2-4：教师档案扩展字段
    // time_slots 走 safeJsonArray（与 subjects/gaokao 同批 JSON 列对齐，服务端单点反序列化零例外）
    time_slots: safeJsonArray(p.time_slots),
    teaching_method: p.teaching_method || '',
    personality_tags: safeJsonArray(p.personality_tags),
    nonacademic_projects: safeJsonArray(p.nonacademic_projects),
    nonacademic_prices: safeJsonArray(p.nonacademic_prices),
    // R2-12 毕业年份（null = 未填，前端按最新政策渲染赋分组件）。
    // 网安审计 决策：公开模式不裁剪——毕业年份仅能粗推成人教师年龄（远弱于联系方式/门牌），
    // 且是学生判断「该教师高考分按哪套政策」的必读信息（2c 需求），刻意公开；不仿 real_name 门控。
    graduation_year: p.graduation_year != null ? p.graduation_year : null,
    // v1.2.0 T1：学信网核验自动填入字段（只读，禁手动改；chsi_verified=1 才开放接单资格）
    chsi_school: p.chsi_school || '', chsi_level: p.chsi_level || '', chsi_major: p.chsi_major || '',
    chsi_status: p.chsi_status || '', chsi_enroll_year: p.chsi_enroll_year || '',
    chsi_verified: p.chsi_verified ? true : false,
    wechat, email, avatar: p.avatar || '',
    rating: p.rating, rating_count: p.rating_count,
    // 公开字段（列表 / 档案）：驼峰命名，供前端消费；蛇形字段保留兼容旧渲染。
    // 缺列兜底用 != null / || '' —— teacher_name/experience_years 由并行 schema 基元落库，落库前 undefined 不炸。
    teacher_name: p.teacher_name || '',
    name: (p.teacher_name && p.teacher_name.trim()) || p.username || '',
    teacherId: p.user_id != null ? Number(p.user_id) : null,
    experience_years: p.experience_years != null ? Number(p.experience_years) : null,
    experienceYears: p.experience_years != null ? Number(p.experience_years) : null,
    priceMin: p.price_min != null ? p.price_min : null,
    priceMax: p.price_max != null ? p.price_max : null,
    teachingMethod: p.teaching_method || '',
    timeSlots: safeJsonArray(p.time_slots),
    personalityTags: safeJsonArray(p.personality_tags),
    bio: p.intro || '',
    philosophy: p.philosophy || '',
    region: SUFE_REGIONS.provinceName(p.province),
    reviewCount: p.rating_count != null ? Number(p.rating_count) : 0,
    chsiVerified: p.chsi_verified ? true : false,
  };
}

// build the public-plaza WHERE / ORDER BY from the filter conditions and
// SQL-expressible sorts. Everything is applied BEFORE the PUBLIC_LIST_MAX LIMIT (the caller
// appends it), so global sort/filter semantics survive a table larger than the cap — the
// old in-handler JS sort/filter ran over the truncated "most recent PUBLIC_LIST_MAX" set,
// which silently dropped older rows from every sort/filter result.
//
// - filters: subjects / gender / personalities (JSON-array columns, matched exactly via
//   json_each — the parse-then-compare equivalent of safeJsonArray, NOT substring LIKE)
//   and price range overlap (teacher [price_min, price_max], null = unbounded). A teacher
// with no price at all is excluded when a price filter is active (contract).
// - sort: price (midpoint, single-side uses the present side, both-null LAST), rating,
//   experience. All three use a null-last flag so missing keys sort to the end regardless
//   of asc/desc — the same semantics as list.js makeComparator. sort='match' is NOT
//   expressible here (needs the student's open demand + per-row match/profile data); the
//   handler passes sort=null and ranks the capped set in JS (documented boundary).
function buildTeacherPublicQuery(filters, sort, order) {
  const cond = ["u.role='teacher'", 'u.banned=0', 'u.deactivated=0'];
  const params = [];
  const f = filters || {};
  const subjectIds = Array.isArray(f.subjects) ? f.subjects.filter(x => typeof x === 'string' && x) : [];
  if (subjectIds.length) {
    // json_valid() short-circuits the EXISTS so a malformed cell cannot 5xx the whole list
    // (C4: a corrupt row must not take down every request; safeJsonArray tolerates it in JS).
    cond.push(`EXISTS (SELECT 1 FROM json_each(tp.subjects) je WHERE json_valid(tp.subjects) AND je.value IN (${subjectIds.map(() => '?').join(',')}))`);
    params.push(...subjectIds);
  }
  if (typeof f.gender === 'string' && f.gender) {
    cond.push('tp.gender = ?');
    params.push(f.gender);
  }
  const personalityIds = Array.isArray(f.personalities) ? f.personalities.filter(x => typeof x === 'string' && x) : [];
  if (personalityIds.length) {
    cond.push(`EXISTS (SELECT 1 FROM json_each(tp.personality_tags) je WHERE json_valid(tp.personality_tags) AND je.value IN (${personalityIds.map(() => '?').join(',')}))`);
    params.push(...personalityIds);
  }
  const pmin = f.priceMin != null ? Number(f.priceMin) : null;
  const pmax = f.priceMax != null ? Number(f.priceMax) : null;
  if (pmin != null || pmax != null) {
    cond.push('(tp.price_min IS NOT NULL OR tp.price_max IS NOT NULL)'); // 报价完全未填教师不参与报价筛选
    if (pmax != null) { cond.push('(tp.price_min IS NULL OR tp.price_min <= ?)'); params.push(pmax); }
    if (pmin != null) { cond.push('(tp.price_max IS NULL OR tp.price_max >= ?)'); params.push(pmin); }
  }
  const dir = order === 'asc' ? 'ASC' : 'DESC';
  let orderBy = 'ORDER BY tp.updated_at DESC'; // 默认 / sort=match 回退时间序
  if (sort === 'price') {
    orderBy = `ORDER BY
      CASE WHEN tp.price_min IS NULL AND tp.price_max IS NULL THEN 1 ELSE 0 END ASC,
      (COALESCE(tp.price_min, tp.price_max) + COALESCE(tp.price_max, tp.price_min)) / 2.0 ${dir},
      tp.updated_at DESC`;
  } else if (sort === 'rating') {
    orderBy = `ORDER BY CASE WHEN tp.rating IS NULL THEN 1 ELSE 0 END ASC, tp.rating ${dir}, tp.updated_at DESC`;
  } else if (sort === 'exp') {
    orderBy = `ORDER BY CASE WHEN tp.experience_years IS NULL THEN 1 ELSE 0 END ASC, tp.experience_years ${dir}, tp.updated_at DESC`;
  }
  return { where: cond.join(' AND '), params, orderBy };
}

// 教师列表统一出口（合并 dbGetAllTeachers / dbGetTeacherUsersAdmin 双胞胎）：
// 广场视图（默认）：viewerId 有值（登录态）时跳过 allow_guest_profile 访客过滤（已登录用户可看全部可见教师）；
// matched EXISTS 子查询已移除（列表不再下发双向匹配标记，仅匹配可见字段改经 /api/teacher/profile 定点门控）；
// adminView：管理端教师管理列表——LEFT JOIN（无档案教师也显示）+ 附 role/banned/created_at。
// 公开分支接收 filters / sort / order 并在 SQL 层应用（）——sort='match' 由调用方以 null 传入。
export async function dbGetTeachers(db, { adminView = false, viewerId = null, filters = null, sort = '', order = 'desc' } = {}) {
  if (adminView) {
    const rows = await dbAll(db, `SELECT u.id AS user_id, u.username, u.role, u.banned, u.created_at,
        tp.id, tp.grade, tp.gender, tp.subjects, tp.gaokao_scores, tp.price, tp.price_min, tp.price_max,
        tp.wechat, tp.email, tp.time_slots, tp.teaching_method,
        tp.personality_tags, tp.nonacademic_projects, tp.nonacademic_prices,
        tp.graduation_year,
        tp.rating, tp.rating_count, tp.province, tp.intro, tp.address, tp.school, tp.real_name,
        tp.verified, tp.chsi_school, tp.chsi_level, tp.chsi_major, tp.chsi_status, tp.chsi_enroll_year, tp.chsi_verified,
        tp.updated_at
      FROM users u LEFT JOIN teacher_profiles tp ON tp.user_id=u.id
      WHERE u.role='teacher' ORDER BY u.created_at DESC`);
    return await Promise.all(rows.map(async r => ({ ...(await mapTeacherProfileRow(r)), role: r.role, banned: r.banned, created_at: r.created_at })));
  }
  // 访客可见性（allow_guest_profile / user_settings JOIN）已删——S6 「无访客浏览」，
  // user_settings 表随之移除，保留访客过滤会让本查询依赖已删表；matched EXISTS 亦已删除。
  // award_count 子查询（teacher_awards）同步移除（S6 awards 不上线），mapper 对缺列兜底 0。
  // viewerId 参数保留（调用方仍传），此处不再消费。
  // DoS guard: the public plaza list is capped at the same PUBLIC_LIST_MAX
  // as the demand square (demand/repo.js) so a growing teacher_profiles table cannot
  // force every request to load the whole table + per-row match computation.
  // filters + SQL-expressible sorts are pushed into the SELECT (buildTeacherPublicQuery)
  // and applied before the LIMIT — the truncation never breaks global sort/filter semantics.
  const { where, params, orderBy } = buildTeacherPublicQuery(filters, sort, order);
  const profiles = await dbAll(db, `SELECT tp.*, u.username, u.avatar
    FROM teacher_profiles tp JOIN users u ON tp.user_id=u.id
    WHERE ${where}
    ${orderBy}
    LIMIT ${LIMITS.PUBLIC_LIST_MAX}`, params);
  // 广场列表一律裁剪私密字段（real_name/credential_image/wechat/email 置空不解密）——
  // 对齐前端文档化契约「列表接口永不下发」（app-teachers.js:171 注释），私密字段仅经
  // /api/teacher/profile 定点取回（该端点按 本人/双向匹配 门控，未匹配 403）。
  // 收益：列表免逐行 AES 解密 + payload 瘦身（含 base64 学信网截图）+ 数据最小化。
  // award_count：已通过审核的荣誉奖项数（教师卡荣誉徽章；公开信息，无需解密）
  return await Promise.all(profiles.map(p => mapTeacherProfileRow(p, { private: false })));
}

// 最接近的一个 OPEN 需求（匹配上下文；D1 契约）。
// 经 demand 域 canonical mapper 映射（S3 单科目新模型 camelCase：subject/addressArea/
// preferredTags/preferredGender/budgetMin/budgetMax）——匹配归一器直接消费；无开放需求返回 null。
export async function dbGetStudentOpenDemand(db, userId) {
  const row = await dbGet(db,
    `SELECT * FROM student_demands WHERE user_id=? AND status='open' ORDER BY created_at DESC, id DESC LIMIT 1`,
    [userId]);
  if (!row) return null;
  return mapDemandRow(row);
}

export async function dbUpdateTeacherRating(db, teacherUserId, rating, count, sum) {
  await dbRun(db,
    'UPDATE teacher_profiles SET rating=?, rating_count=?, rating_sum=? WHERE user_id=?',
    [rating, count, sum, teacherUserId]);
}

// 学籍认证：管理员审核通过/撤销教师认证（运营建议——「真实可验证在校生」信任锚点）
export async function dbSetTeacherVerified(db, userId, verified) {
  await dbRun(db, 'UPDATE teacher_profiles SET verified=? WHERE user_id=?', [verified ? 1 : 0, userId]);
}

// ============================================================
// 学信网核验（v1.2.0 T1/T3）：teacher_verifications 记录 + teacher_profiles chsi_* 字段
// ============================================================
export async function dbGetTeacherVerification(db, userId) {
  return await dbGet(db,
    'SELECT * FROM teacher_verifications WHERE user_id=?', [userId]);
}

/** 插入/更新核验记录（一人一条，UNIQUE(user_id)；approved/rejected 覆写旧状态）。
 * 安全审计 verify_code 加密落库（学信网报告访问凭证，同 wechat/email 口径）——库泄露不暴露明文。 */
export async function dbUpsertTeacherVerification(db, v) {
  const verifyCode = await encryptField(String(v.verifyCode || ''));
  // 入参 v.admissionImage 语义 = 明文（调用方已 decryptField——approve/reject/revoke 三处对称）。
  // 原实现直接再 encryptField → 调用方透传库中密文 enc1 二次加密 enc2，每次 admin 动作叠层（审核链数据腐坏）。
  const admissionImage = v.admissionImage ? await encryptField(String(v.admissionImage)) : '';
  await dbRun(db, `INSERT INTO teacher_verifications
      (user_id, verify_code, status, school, level, major, enrollment_status, enroll_year, provider, verify_type, admission_image, verified_by, verified_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET
      verify_code=excluded.verify_code, status=excluded.status,
      school=excluded.school, level=excluded.level, major=excluded.major,
      enrollment_status=excluded.enrollment_status, enroll_year=excluded.enroll_year,
      provider=excluded.provider, verify_type=excluded.verify_type, admission_image=excluded.admission_image,
      verified_by=excluded.verified_by, verified_at=excluded.verified_at`,
    [v.userId, verifyCode, v.status, v.school || '', v.level || '', v.major || '',
     v.enrollmentStatus || '', v.enrollYear || '', v.provider || 'manual', v.verifyType || 'chsi', admissionImage,
     v.verifiedBy || null, v.verifiedAt || null]);
}

/** 安全审计 H2：撤销接单资格（reject/revoke）——清空学信网字段与展示（chsi_verified=0、chsi_* 清空、
 *  school 还原为空——school 在 approved 时被学信网覆盖，撤销后不再展示学信网来源值） */
export async function dbClearChsiFromProfile(db, userId) {
  await dbRun(db, `UPDATE teacher_profiles SET
      chsi_school='', chsi_level='', chsi_major='', chsi_status='', chsi_enroll_year='', chsi_verified=0,
      school=CASE WHEN school=chsi_school THEN '' ELSE school END
      WHERE user_id=?`, [userId]);
}

/** 核验通过后把学信网字段自动填入教师档案（chsi_* 只读，禁手动改）。
 *  教师可能无档案行（注册不建 teacher_profiles）——INSERT 兜底（其他列默认/空，随档案编辑补齐）。 */
export async function dbApplyChsiToProfile(db, userId, info) {
  await dbRun(db, `INSERT INTO teacher_profiles (user_id, chsi_school, chsi_level, chsi_major, chsi_status, chsi_enroll_year, chsi_verified, school)
      VALUES (?,?,?,?,?,?,1,?)
    ON CONFLICT(user_id) DO UPDATE SET
      chsi_school=excluded.chsi_school, chsi_level=excluded.chsi_level, chsi_major=excluded.chsi_major,
      chsi_status=excluded.chsi_status, chsi_enroll_year=excluded.chsi_enroll_year, chsi_verified=1,
      school=CASE WHEN teacher_profiles.school='' OR teacher_profiles.school IS NULL THEN excluded.school ELSE teacher_profiles.school END`,
    [userId, info.school || '', info.level || '', info.major || '', info.enrollmentStatus || '',
     info.enrollYear || '', info.school || '']);
}

/** 管理员核验队列：全部记录（pending 优先） */
export async function dbListTeacherVerifications(db, status) {
  const where = status && status !== 'all' ? ' WHERE v.status=?' : '';
  const args = status && status !== 'all' ? [status] : [];
  const rows = await dbAll(db, `SELECT v.*, u.username FROM teacher_verifications v
      JOIN users u ON u.id=v.user_id${where} ORDER BY v.created_at DESC`, args);
  // 安全审计 verify_code 加密落库，管理端列表解密（管理员核验需明文查证，同 wechat 管理端解密口径）。
  // v1.4.16：admission_image（录取通知书）同样加密，管理端列表解密供预览。
  // map 返回新对象（不改原 row——D1 返回行可能只读，ESM 严格模式赋值抛 TypeError → 列表 500 生产实证）
  return Promise.all(rows.map(async r => ({
    ...r,
    verify_code: (await decryptField(r.verify_code)) || '',
    admission_image: r.admission_image ? (await decryptField(r.admission_image)) || '' : '',
  })));
}

export async function dbGetTeacherVerificationById(db, id) {
  return await dbGet(db, 'SELECT * FROM teacher_verifications WHERE id=?', [id]);
}
