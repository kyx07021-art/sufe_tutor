/**
 * 教师域数据层（V-1-4 从 server/db.js 提取）：teacher_profiles / 教师列表 / 学信网核验。
 */
import { dbAll, dbGet, dbRun } from '../../core/util.js';
import { encryptField, decryptField } from '../../core/crypto.js';
import { safeJsonArray, safeJsonObject } from '../../core/json.js';
import { INITIAL_RATING, INITIAL_WEIGHT, LIMITS } from '../../../shared/config.js';
import { STATUS } from '../../../shared/enums.js';

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

export async function dbUpsertTeacherProfile(db, userId, profile) {
  const existing = await dbGet(db, 'SELECT id FROM teacher_profiles WHERE user_id=?', [userId]);
  const subjects = JSON.stringify(profile.subjects);
  const gaokao = JSON.stringify(profile.gaokao_scores);
  // 网安报告 F-06：wechat/email/real_name 加密落库（D1 泄露/备份不暴露教师私密信息；real_name 截断先于加密）
  // 网安 N-05：credential_image（学信网截图 dataURL）同款加密——D1 泄露/备份不暴露证件图
  const [wechat, email, realName, credentialImage] = await Promise.all([
    encryptField(profile.wechat || ''), encryptField(profile.email || ''),
    encryptField((profile.real_name || '').slice(0, LIMITS.REAL_NAME_MAX)), encryptField(profile.credential_image || ''),
  ]);

  // R2-5 报价区间化：price_min/price_max 保留 null=未填语义（完整性门槛据此拦截，勿落 0）；0 是合法报价
  const priceMin = profile.price_min != null ? profile.price_min : null;
  const priceMax = profile.price_max != null ? profile.price_max : null;
  const timeSlots = profile.time_slots || ''; // R2-1 结构化时间段 JSON（空串 = 未填）
  const teachingMethod = profile.teaching_method || ''; // R2-2 授课方式白名单（routes 已校验）
  const personalityTags = JSON.stringify(Array.isArray(profile.personality_tags) ? profile.personality_tags : []); // R2-3 JSON 数组
  const nonacademicProjects = JSON.stringify(Array.isArray(profile.nonacademic_projects) ? profile.nonacademic_projects : []); // R2-4 JSON 数组
  const nonacademicPrices = JSON.stringify(Array.isArray(profile.nonacademic_prices) ? profile.nonacademic_prices : []); // R2-4 JSON 数组
  // R2-12 毕业年份：''/null/非法（routes 已回 ''）一律归一为 null 落库（null = 未填，按最新政策）
  const gradYear = profile.graduation_year != null && profile.graduation_year !== '' ? profile.graduation_year : null;

  // price 列保留 = price_min 同步镜像：INSERT/UPDATE 显式写 price=priceMin，
  // 防新行吃 DEFAULT 0 后，被存量回填 `WHERE price_min IS NULL AND price IS NOT NULL` 误抓成「报价 0」。
  // 语义：price 为只读残留（历史迁移用），业务读写一律走 price_min/price_max。
  if (existing) {
    await dbRun(db, `UPDATE teacher_profiles SET province=?,grade=?,gender=?,subjects=?,gaokao_scores=?,
      price=?,price_min=?,price_max=?,wechat=?,email=?,intro=?,address=?,school=?,real_name=?,credential_image=?,
      time_slots=?,teaching_method=?,personality_tags=?,nonacademic_projects=?,nonacademic_prices=?,
      graduation_year=?,
      updated_at=datetime('now','localtime') WHERE user_id=?`,
      [profile.province || '', profile.grade, profile.gender, subjects, gaokao, priceMin, priceMin, priceMax, wechat, email, (profile.intro || '').slice(0, LIMITS.INTRO_MAX), (profile.address || '').slice(0, LIMITS.ADDRESS_FIELD_MAX), (profile.school || '').slice(0, LIMITS.SCHOOL_MAX), realName, credentialImage,
        timeSlots, teachingMethod, personalityTags, nonacademicProjects, nonacademicPrices, gradYear, userId]);
  } else {
    await dbRun(db, `INSERT INTO teacher_profiles (user_id,province,grade,gender,subjects,gaokao_scores,
        price,price_min,price_max,wechat,email,intro,address,school,real_name,credential_image,
        time_slots,teaching_method,personality_tags,nonacademic_projects,nonacademic_prices,graduation_year)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [userId, profile.province || '', profile.grade, profile.gender, subjects, gaokao, priceMin, priceMin, priceMax, wechat, email, (profile.intro || '').slice(0, LIMITS.INTRO_MAX), (profile.address || '').slice(0, LIMITS.ADDRESS_FIELD_MAX), (profile.school || '').slice(0, LIMITS.SCHOOL_MAX), realName, credentialImage,
        timeSlots, teachingMethod, personalityTags, nonacademicProjects, nonacademicPrices, gradYear]);
  }
}

// 教师行映射器：教师列表 / 意向教师列表 / 本人档案共用，返回形状永远一致
// （JOIN 来的 username/avatar 在裸档案行上缺省为 undefined，JSON 序列化时自动略去）
// 网安报告 F-06：wechat/email/real_name 是加密列，出门即解密（调用方均为 async，Promise.all 收敛）
// 网安 N-05：credential_image 同款加密列，出门解密
// 数据最小化：private:false 时私密字段不解密、置空——广场列表非匹配行（viewerId 缺省或未匹配）
// 一律裁剪，服务端硬把关（前端仅按 matched/signed 门控显示，但数据此前已随列表发给所有人）
export async function mapTeacherProfileRow(p, { private: includePrivate = true } = {}) {
  const [wechat, email, realName, credentialImage] = includePrivate
    ? await Promise.all([
        decryptField(p.wechat), decryptField(p.email), decryptField(p.real_name), decryptField(p.credential_image),
      ])
    : ['', '', '', ''];
  return {
    id: p.id, user_id: p.user_id, username: p.username,
    province: p.province || '', grade: p.grade, gender: p.gender, intro: p.intro || '', address: p.address || '',
    school: p.school || '', real_name: realName || '', credential_image: credentialImage || '',
    verified: p.verified ? true : false, // 学籍认证（管理员审核通过）
    award_count: p.award_count != null ? Number(p.award_count) : 0, // 已审核荣誉奖项数（公开）
    subjects: safeJsonArray(p.subjects),
    gaokao_scores: safeJsonArray(p.gaokao_scores),
    // R2-5 报价区间化：price_min/price_max 保留 null=未填（完整性门槛据此拦截）；price 保留供历史兼容，前端不再用
    price_min: p.price_min != null ? p.price_min : null,
    price_max: p.price_max != null ? p.price_max : null,
    price: p.price != null ? p.price : null,
    // R2-1/R2-2/R2-3/R2-4：教师档案扩展字段
    time_slots: p.time_slots || '',
    teaching_method: p.teaching_method || '',
    personality_tags: safeJsonArray(p.personality_tags),
    nonacademic_projects: safeJsonArray(p.nonacademic_projects),
    nonacademic_prices: safeJsonArray(p.nonacademic_prices),
    // R2-12 毕业年份（null = 未填，前端按最新政策渲染赋分组件）。
    // 网安审计 M1 决策：公开模式不裁剪——毕业年份仅能粗推成人教师年龄（远弱于联系方式/门牌），
    // 且是学生判断「该教师高考分按哪套政策」的必读信息（2c 需求），刻意公开；不仿 real_name 门控。
    graduation_year: p.graduation_year != null ? p.graduation_year : null,
    // v1.2.0 T1：学信网核验自动填入字段（只读，禁手动改；chsi_verified=1 才开放接单资格）
    chsi_school: p.chsi_school || '', chsi_level: p.chsi_level || '', chsi_major: p.chsi_major || '',
    chsi_status: p.chsi_status || '', chsi_enroll_year: p.chsi_enroll_year || '',
    chsi_verified: p.chsi_verified ? true : false,
    wechat, email, avatar: p.avatar || '',
    rating: p.rating, rating_count: p.rating_count, matched: p.matched ? true : false,
  };
}

// 教师列表统一出口（合并 dbGetAllTeachers / dbGetTeacherUsersAdmin 双胞胎）：
// 广场视图（默认）：viewerId 有值（登录态）时附 matched 标记（双向匹配 = 与该教师已建立会话），
//   前端据此决定是否拉取真实姓名/学信网截图等仅匹配可见字段；
// adminView：管理端教师管理列表——LEFT JOIN（无档案教师也显示）+ 附 role/banned/created_at
export async function dbGetTeachers(db, { adminView = false, viewerId = null } = {}) {
  if (adminView) {
    const rows = await dbAll(db, `SELECT u.id AS user_id, u.username, u.role, u.banned, u.created_at,
        tp.id, tp.grade, tp.gender, tp.subjects, tp.gaokao_scores, tp.price, tp.price_min, tp.price_max,
        tp.wechat, tp.email, tp.time_slots, tp.teaching_method,
        tp.personality_tags, tp.nonacademic_projects, tp.nonacademic_prices,
        tp.graduation_year,
        tp.rating, tp.rating_count, tp.province, tp.intro, tp.address, tp.updated_at
      FROM users u LEFT JOIN teacher_profiles tp ON tp.user_id=u.id
      WHERE u.role='teacher' ORDER BY u.created_at DESC`);
    return await Promise.all(rows.map(async r => ({ ...(await mapTeacherProfileRow(r)), role: r.role, banned: r.banned, created_at: r.created_at })));
  }
  const matchedSel = viewerId
    ? `EXISTS(SELECT 1 FROM conversations cv WHERE (cv.student_user_id=? AND cv.teacher_user_id=tp.user_id) OR (cv.student_user_id=tp.user_id AND cv.teacher_user_id=?)) AS matched`
    : '0 AS matched';
  const params = viewerId ? [viewerId, viewerId] : [];
  // 访客可见性——游客只看 allow_guest_profile=1 的教师（无 user_settings 行=默认可见）
  const joinUs = viewerId ? '' : ' LEFT JOIN user_settings us ON us.user_id=tp.user_id';
  const privWhere = viewerId ? '' : ' AND COALESCE(us.allow_guest_profile, 1) = 1';
  const profiles = await dbAll(db, `SELECT tp.*, u.username, u.avatar, ${matchedSel},
    (SELECT COUNT(*) FROM teacher_awards a WHERE a.teacher_user_id=tp.user_id AND a.status='approved') AS award_count
    FROM teacher_profiles tp JOIN users u ON tp.user_id=u.id${joinUs}
    WHERE u.role='teacher' AND u.banned=0 AND u.deactivated=0${privWhere}
    ORDER BY tp.updated_at DESC`, params);
  // 广场列表一律裁剪私密字段（real_name/credential_image/wechat/email 置空不解密）——
  // 对齐前端文档化契约「列表接口永不下发」（app-teachers.js:171 注释），私密字段仅经
  // /api/teacher/profile 定点取回（该端点按 本人/双向匹配 门控，未匹配 403）。
  // 收益：列表免逐行 AES 解密 + payload 瘦身（含 base64 学信网截图）+ 数据最小化。
  // award_count：已通过审核的荣誉奖项数（教师卡荣誉徽章；公开信息，无需解密）
  return await Promise.all(profiles.map(p => mapTeacherProfileRow(p, { private: false })));
}

async function dbUpdateTeacherRating(db, teacherUserId, rating, count, sum) {
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
 *  安全审计 M1：verify_code 加密落库（学信网报告访问凭证，同 wechat/email 口径）——库泄露不暴露明文。 */
export async function dbUpsertTeacherVerification(db, v) {
  const verifyCode = await encryptField(String(v.verifyCode || ''));
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
  // 安全审计 M1：verify_code 加密落库，管理端列表解密（管理员核验需明文查证，同 wechat 管理端解密口径）。
  // v1.4.16：admission_image（录取通知书）同样加密，管理端列表解密供预览。
  // map 返回新对象（不改原 row——D1 返回行可能只读，ESM 严格模式赋值抛 TypeError → 列表 500 生产实证）
  return Promise.all(rows.map(async r => ({
    ...r,
    verify_code: (await decryptField(r.verify_code)) || '',
    admission_image: r.admission_image ? (await decryptField(r.admission_image)) || '' : '',
  })));
}

// v1.2.0 T6：管理员按 id 查核验记录
export async function dbGetTeacherVerificationById(db, id) {
  return await dbGet(db, 'SELECT * FROM teacher_verifications WHERE id=?', [id]);
}
