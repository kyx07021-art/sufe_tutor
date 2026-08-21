/**
 * 需求域数据层（V-1-4 从 server/db.js 提取）：demands / pushes / intents。
 */
import { dbAll, dbGet, dbRun } from '../../core/util.js';
import { encryptField, decryptField } from '../../core/crypto.js';
import { safeJsonArray } from '../../core/json.js'; // Z-3-F3：safeJsonObject 零引用删除
import { mapTeacherProfileRow } from '../teacher/repo.js';
import { LIMITS } from '../../../shared/config.js';

// 学生需求
// ============================================================
export async function dbCreateDemand(db, userId, demand) {
  // address_detail（详细门牌号）已因合规原因停用：不再收集、不再写入，列保留但恒为空
  // display_id：对外需求编号（四位，按生成顺序自 0001 起），子查询取号保证顺序单调
  // 网安报告 F-06：parent_contact/student_contact 加密落库（联系方式是需求最高敏字段）
  const [parentContact, studentContact] = await Promise.all([encryptField(demand.parent_contact), encryptField(demand.student_contact)]);
  const result = await dbRun(db, `INSERT INTO student_demands
    (user_id,province,student_grade,student_gender,target_subjects,current_scores,
     teaching_method,address,expected_time,budget_min,budget_max,
     submitter_type,parent_contact,student_contact,additional_info,display_id,
     target_type,preferred_personality_tags,preferred_teacher_gender,teaching_goal,skill_notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, (SELECT COALESCE(MAX(display_id),0)+1 FROM student_demands),
      ?,?,?,?,?)`, [
    userId, demand.province || '', demand.student_grade, demand.student_gender,
    JSON.stringify(demand.target_subjects), JSON.stringify(demand.current_scores),
    demand.teaching_method || 'offline', demand.address || '', demand.expected_time || '',
    demand.budget_min || 0, demand.budget_max || 0,
    demand.submitter_type, parentContact, studentContact, demand.additional_info || '',
    demand.target_type || 'academic',
    JSON.stringify(Array.isArray(demand.preferred_personality_tags) ? demand.preferred_personality_tags : []),
    demand.preferred_teacher_gender || '',
    JSON.stringify(Array.isArray(demand.teaching_goal) ? demand.teaching_goal : []),
    JSON.stringify(Array.isArray(demand.skill_notes) ? demand.skill_notes : []),
  ]);
  return Number(result.meta.last_row_id);
}

// 需求列表统一查询：JOIN 用户名 + LEFT JOIN 聚合出意向计数（向后兼容的附加字段）
const DEMANDS_SELECT = `SELECT sd.*, u.username, u.avatar, COALESCE(ic.cnt, 0) AS intent_count,
    COALESCE(ic.pending, 0) AS pending_intents
  FROM student_demands sd JOIN users u ON sd.user_id=u.id
  LEFT JOIN (SELECT demand_id, COUNT(*) AS cnt,
      SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending
    FROM demand_intents GROUP BY demand_id) ic
    ON ic.demand_id=sd.id`;

// 需求行默认脱敏出口：parent_contact/student_contact（产品规则：签约后才向对方展示，服务端硬把关）、
// address_detail（详细门牌号，合规停用）一律在此剥除，任何走 mapper 的出口都拿不到联系方式。
// 需要联系方式的场景（本人「我的需求」、管理员全量）显式用 mapDemandRowFull。
export function mapDemandRow(r) {
  // 警示：...rest 透传 student_demands 全部其余列——未来新增敏感列必须在此显式剥除，否则默认外泄
  const { parent_contact, student_contact, address_detail, ...rest } = r;
  return {
    ...rest,
    target_subjects: safeJsonArray(r.target_subjects),
    current_scores: safeJsonArray(r.current_scores),
    // R2-b：偏好老师性格 JSON 列单点反序列化（target_type/preferred_teacher_gender 随 rest 透传）
    preferred_personality_tags: safeJsonArray(r.preferred_personality_tags),
    // 教学目标 / 技能现状 JSON 列单点反序列化（mapper 出口同口径）
    teaching_goal: safeJsonArray(r.teaching_goal),
    skill_notes: safeJsonArray(r.skill_notes),
  };
}

// 含联系方式变体：仅「本人需求」与「管理员全量」两处显式调用（归属/角色已由调用方校验）。
// 网安报告 F-06：联系方式加密列，出门即解密（调用方均为 async）
async function mapDemandRowFull(r) {
  const [parentContact, studentContact] = await Promise.all([decryptField(r.parent_contact), decryptField(r.student_contact)]);
  return { ...mapDemandRow(r), parent_contact: parentContact || '', student_contact: studentContact || '' };
}

// 需求列表统一出口（合并 dbGetAllDemands / dbGetAllDemandsAdmin）：
// 广场（默认）：status NOT IN (contracted,revoked)，传 teacherUserId 时附该教师的意向状态
// （my_intent_status，供前端按钮三态渲染）；admin：管理员全量（含已签约，管理端查看联系方式）
export async function dbGetDemands(db, { admin = false, cursor = null, teacherUserId = null, forGuest = false } = {}) {
  if (admin) {
    // 网安报告 F-09：keyset 游标分页（created_at,id 复合倒序；游标=末行编码，前端以 nextCursor 翻页）。
    // LIMIT 取 PAGE_HAS_MORE 判 hasMore，不额外查询；页大小单源自 constants.LIMITS
    const params = [];
    let where = '';
    if (cursor) {
      const [cCreated, cId] = String(cursor).split('|');
      if (cCreated && cId) {
        where = ' WHERE (sd.created_at < ? OR (sd.created_at = ? AND sd.id < ?))';
        params.push(cCreated, cCreated, parseInt(cId, 10) || 0);
      }
    }
    const rows = await dbAll(db,
      `SELECT sd.*, u.username, u.avatar FROM student_demands sd JOIN users u ON u.id=sd.user_id${where}
       ORDER BY sd.created_at DESC, sd.id DESC LIMIT ${LIMITS.PAGE_HAS_MORE}`, params);
    const hasMore = rows.length > LIMITS.PAGE_SIZE;
    const page = hasMore ? rows.slice(0, LIMITS.PAGE_SIZE) : rows;
    const last = page.length ? page[page.length - 1] : null;
    return {
      demands: await Promise.all(page.map(mapDemandRowFull)), // 管理员：管理端查看联系方式；F-06 解密为 async
      nextCursor: hasMore && last ? `${last.created_at}|${last.id}` : null,
    };
  }
  let sel = DEMANDS_SELECT, extra = '', params = [], where = ` WHERE sd.status='open' AND u.deactivated=0`;
  if (teacherUserId) {
    sel = DEMANDS_SELECT.replace('COALESCE(ic.cnt, 0) AS intent_count',
      'COALESCE(ic.cnt, 0) AS intent_count, mi.status AS my_intent_status');
    extra = ' LEFT JOIN demand_intents mi ON mi.demand_id=sd.id AND mi.teacher_user_id=?';
    params = [teacherUserId];
  }
  // 访客可见性——未登录游客只看 allow_guest_demand=1 的需求（无 user_settings 行=默认可见）
  if (forGuest) {
    extra += ' LEFT JOIN user_settings us ON us.user_id=sd.user_id';
    where += ' AND COALESCE(us.allow_guest_demand, 1) = 1';
  }
  // 广场只展示活跃需求（统一口径 status='open'，排除式 NOT IN ('contracted','revoked')
  // 会把未来新增状态/NULL 当活跃，与 dbCreatePush/dbCreateIntent 的原子守卫（WHERE status='open'）口径漂移）
  // 广场门控——已注销用户数据严禁入场（不依赖 purge 完整性，双保险）
  const rows = await dbAll(db, sel + extra + where + ' ORDER BY sd.created_at DESC LIMIT ?',
    [...params, LIMITS.PUBLIC_LIST_MAX]);
  return rows.map(mapDemandRow);
}

export async function dbGetDemandsByUser(db, userId) {
  // 我的需求已签约沉底——contract 需求不再与开放需求按时间穿插，
  // 活跃需求优先（可按创建时间排），已签约的堆列表最下；revoked 仍可重开，归活跃侧。
  const rows = await dbAll(db, DEMANDS_SELECT +
    ` WHERE sd.user_id=? ORDER BY CASE WHEN sd.status='contracted' THEN 1 ELSE 0 END, sd.created_at DESC`, [userId]);
  return await Promise.all(rows.map(mapDemandRowFull)); // 本人「我的需求」：编辑回填需要联系方式；F-06 解密为 async
}

// 单条需求也走 mapper（与列表同形状；调用方统一拿数组字段，裸行分叉已消灭）
// 单条需求：出口经 mapDemandRow（与开放列表 dbGetDemands 同 mapper，形状一致：路由层零 JSON.parse、
// mapper 出口剥私密字段 parent_contact/student_contact；price 保留 null 语义）。
// 跨出口契约：需要联系方式的单条场景（本人「我的需求」编辑回填）显式用 mapDemandRowFull
// （dbGetDemandsByUser 同款，解密为 async）；当前 dbGetDemandById 调用方（admin 删除/内容审核、
// 合同门禁/reopen）均不需要联系方式，走剥私密字段的 mapDemandRow 为正确设计。
export async function dbGetDemandById(db, id) {
  const row = await dbGet(db, 'SELECT * FROM student_demands WHERE id=?', [id]);
  return row ? mapDemandRow(row) : null;
}

export async function dbUpdateDemand(db, id, d) {
  // 网安报告 F-06：联系方式加密落库（与 dbCreateDemand 同款加密）
  const [parentContact, studentContact] = await Promise.all([encryptField(d.parent_contact), encryptField(d.student_contact)]);
  await dbRun(db, `UPDATE student_demands SET province=?,student_grade=?,student_gender=?,
    target_subjects=?,current_scores=?,teaching_method=?,address=?,expected_time=?,address_detail='',
    budget_min=?,budget_max=?,submitter_type=?,parent_contact=?,student_contact=?,
    additional_info=?,target_type=?,preferred_personality_tags=?,preferred_teacher_gender=?,
    teaching_goal=?,skill_notes=? WHERE id=?`, [
    d.province || '', d.student_grade, d.student_gender,
    JSON.stringify(d.target_subjects), JSON.stringify(d.current_scores),
    d.teaching_method || 'offline', d.address || '', d.expected_time || '',
    d.budget_min || 0, d.budget_max || 0,
    d.submitter_type, parentContact, studentContact, d.additional_info || '',
    d.target_type || 'academic',
    JSON.stringify(Array.isArray(d.preferred_personality_tags) ? d.preferred_personality_tags : []),
    d.preferred_teacher_gender || '',
    JSON.stringify(Array.isArray(d.teaching_goal) ? d.teaching_goal : []),
    JSON.stringify(Array.isArray(d.skill_notes) ? d.skill_notes : []), id,
  ]);
}

// 删除需求：数据层强制保护——只要存在 pending/signing/signed 合同引用该需求，即返回 false（调用方拒绝删除）。
// 悬空 demand_id 会导致签约 410 后合同仍 signed 的线上事故（F-03b），此门禁在 db.js 单点收口。
export async function dbDeleteDemand(db, id) {
  // 原子守卫（替代 check-then-delete）：DELETE 携带 NOT EXISTS(活跃合同引用)，
  // 并发起草窗口内合同先落库则本删除不命中→false，杜绝悬空 demand_id（F-03b）
  const r = await dbRun(db,
    `DELETE FROM student_demands WHERE id=? AND NOT EXISTS (
      SELECT 1 FROM signing_contracts WHERE demand_id=? AND stage='contract' AND contract_status IN ('pending','signing','signed'))`, [id, id]);
  if (!(r && r.meta && r.meta.changes > 0)) return false;
  // demand_intents 经外键 ON DELETE CASCADE 级联清理，无需显式删（原冗余 DELETE 已删，避免误导读者以为级联不存在）
  return true;
}

// 管理员强制删除需求（含已签约 contracted）。
// 与 dbDeleteDemand 的常规门禁（有 pending/signing/signed 合同引用即拒）并列——管理员路径
// 放行全部状态，但 F-03b 不变量（demand_id 不悬空）仍需守住：signing_contracts 的
// demand_id 为裸 INTEGER 无外键，悬空会致线上事故（F-03b），故同一事务内先清引用再删需求；
// demand_intents / demand_pushes 经 FK ON DELETE CASCADE 级联。db.batch 隐式单事务。
export async function dbAdminForceDeleteDemand(db, id) {
  const res = await db.batch([
    db.prepare('UPDATE signing_contracts SET demand_id=NULL WHERE demand_id=?').bind(id),
    db.prepare('DELETE FROM student_demands WHERE id=?').bind(id),
  ]);
  return !!(res && res[1] && res[1].meta && res[1].meta.changes > 0);
}

// 需求重开（revoked→open）：条件 UPDATE 赢家模式，返回是否命中（防并发双触发）。
// Q-2c-F6（回滚重做）：删 intent_locked 死列引用（恒 0，无读写路径；并发赢家由 dbResolveIntent 的
// status='pending' 条件 UPDATE 承担，意向锁早已废弃）。
export async function dbReopenDemand(db, id) {
  const r = await dbRun(db, `UPDATE student_demands SET status='open' WHERE id=? AND status='revoked'`, [id]);
  return !!(r && r.meta && r.meta.changes > 0);
}

// 合同撤销后释放绑定需求：contracted→revoked（待所有者手动重开，与 STATUS.REVOKED 契约对齐）。
// 撤销/管理员删合同路径调用；条件 UPDATE 赢家模式，无命中（非 contracted/已释放）幂等返回 false。
// 签约成交后需求恒 contracted 且一需求一份成交合同（dbCreateContract 硬校验），释放无歧义。
export async function dbReleaseDemandAfterRevoke(db, demandId) {
  if (!demandId) return false;
  const r = await dbRun(db, `UPDATE student_demands SET status='revoked' WHERE id=? AND status='contracted'`, [demandId]);
  return !!(r && r.meta && r.meta.changes > 0);
}

// ============================================================
// 需求主动推送（学生 → 指定教师）
// ============================================================
// 推送创建原子化（同 dbCreateIntent，仅当需求 status='open' 才插入；changes=0 返回 0）
// message = 学生打招呼消息（自我介绍+为什么选这位老师）
export async function dbCreatePush(db, demandId, studentUserId, teacherUserId, message = '') {
  // Q-2c-F7 BUG-N：同 dbCreateIntent——message 类型归一纵深防御（防对象落库 [object Object]）
  const msg = String(message ?? '').slice(0, LIMITS.GREETING_MSG_MAX);
  const r = await dbRun(db,
    `INSERT INTO demand_pushes (demand_id, student_user_id, teacher_user_id, message)
     SELECT ?, ?, ?, ? FROM student_demands WHERE id=? AND status='open'`,
    [demandId, studentUserId, teacherUserId, msg, demandId]);
  return (r && r.meta && r.meta.changes > 0) ? Number(r.meta.last_row_id) : 0;
}

// 某教师待处理推送（含需求全字段 + 学生用户名 + 打招呼消息），供需求大厅置顶 + 红点计数
export async function dbGetPendingPushesForTeacher(db, teacherUserId) {
  const rows = await dbAll(db, `SELECT dp.id AS push_id, dp.status AS push_status, dp.created_at AS push_created_at,
      dp.message AS push_message, sd.*, u.username
    FROM demand_pushes dp
    JOIN student_demands sd ON sd.id=dp.demand_id
    JOIN users u ON u.id=sd.user_id
    WHERE dp.teacher_user_id=? AND dp.status='pending' AND u.deactivated=0 -- 门控：已注销学生推送不进场
    ORDER BY dp.created_at DESC`, [teacherUserId]);
  return rows.map(mapDemandRow); // push_* 字段随 rest 透传
}

export async function dbGetPushById(db, pushId) {
  return await dbGet(db, 'SELECT * FROM demand_pushes WHERE id=?', [pushId]);
}

// 条件 UPDATE + changes 判定：并发双触发时仅一个请求 changes>0（赢家），副作用只由赢家执行
export async function dbResolvePush(db, pushId, status) {
  const res = await dbRun(db, `UPDATE demand_pushes SET status=? WHERE id=? AND status='pending'`, [status, pushId]);
  return !!(res && res.meta && res.meta.changes > 0);
}

// 某需求的全部待处理推送（签约自动下架时系统批量拒绝用；逐条留档在调用方循环内）
export async function dbGetPendingPushesForDemand(db, demandId) {
  return await dbAll(db,
    `SELECT id, teacher_user_id FROM demand_pushes WHERE demand_id=? AND status='pending'`, [demandId]);
}

// 推送被教师确认：写一条「已接受」意向（复用学生端意向/会话视图）+ 由路由层建立会话。
// DO UPDATE 覆写守卫：学生对意向的明确拒绝（status='rejected'）不可被推送确认静默撤销
export async function dbAcceptPushAsIntent(db, demandId, teacherUserId) {
  await dbRun(db, `INSERT INTO demand_intents (demand_id,teacher_user_id,status,resolved_at)
      VALUES (?,?,'accepted',datetime('now'))
    ON CONFLICT(demand_id,teacher_user_id) DO UPDATE SET status='accepted', resolved_at=datetime('now')
      WHERE demand_intents.status <> 'rejected'`,
    [demandId, teacherUserId]);
}

// ============================================================
// 意向
// ============================================================
// 意向创建原子化（路由层先查需求状态再 INSERT 存在窗口——查询与插入之间需求被签约/撤销，
// 意向会落在已关闭需求上。改为条件 INSERT：仅当需求 status='open' 才插入，changes=0 即需求非开放，
// 调用方据返回 0 判定 410）。UNIQUE(demand_id, teacher_user_id) 冲突仍抛错由路由转 409
export async function dbCreateIntent(db, demandId, teacherUserId, message = '') {
  // Q-2c-F7 BUG-N：message 类型归一纵深防御——调用方已 String().trim()，此处兜底任何边界/未来调用方误传对象（[object Object] 落库）
  const msg = String(message ?? '').slice(0, LIMITS.GREETING_MSG_MAX);
  const result = await dbRun(db,
    `INSERT INTO demand_intents (demand_id, teacher_user_id, message)
     SELECT ?, ?, ? FROM student_demands WHERE id=? AND status='open'`,
    [demandId, teacherUserId, msg, demandId]);
  return (result && result.meta && result.meta.changes > 0) ? Number(result.meta.last_row_id) : 0;
}

export async function dbGetIntentTeachers(db, demandId) {
  const rows = await dbAll(db, `SELECT tp.*, di.teacher_user_id AS user_id, u.username, u.avatar,
      di.id AS intent_id, di.status AS intent_status, di.created_at AS intent_created_at,
      di.message AS intent_message
    FROM demand_intents di
    JOIN users u ON u.id=di.teacher_user_id
    LEFT JOIN teacher_profiles tp ON tp.user_id=di.teacher_user_id
    WHERE di.demand_id=? AND u.deactivated=0 AND u.banned=0 -- 门控：已注销/已封禁教师意向不进场（Q-2c-F3 补 banned，对齐 handlePushDemand 口径）
    ORDER BY di.created_at DESC`, [demandId]);
  // 附加意向自身字段（id/状态/时间），供学生端同意/拒绝按钮使用
  // 出口剥私密字段（mapper 出口剥私密字段契约）：
  // 联系方式签约后展示；真实姓名/学信网截图仅双向匹配后按档案端点定点取
  // Z-3-F2：private:false 免逐行 AES 解密（出口本就剥私密字段，解密纯浪费——对照 dbGetTeachers 同口径）
  return (await Promise.all(rows.map(async r => ({
    ...(await mapTeacherProfileRow(r, { private: false })),
    intent_id: r.intent_id, intent_status: r.intent_status, intent_created_at: r.intent_created_at,
    intent_message: r.intent_message || '', // 教师打招呼消息（SELECT 已取，出口透传；空串统一）
  })))).map(({ wechat, email, real_name, credential_image, matched, ...rest }) => rest);
}

export async function dbGetIntentWithDemand(db, intentId) {
  return await dbGet(db, `SELECT di.*, sd.user_id AS demand_owner
    FROM demand_intents di JOIN student_demands sd ON sd.id=di.demand_id
    WHERE di.id=?`, [intentId]);
}

export async function dbResolveIntent(db, intentId, status) {
  const res = await dbRun(db,
    "UPDATE demand_intents SET status=?, resolved_at=datetime('now') WHERE id=? AND status='pending'",
    [status, intentId]);
  return !!(res && res.meta && res.meta.changes > 0); // 仅赢家（changes>0）执行建会话/通知等副作用
}

// 某需求的全部待处理意向（签约自动下架时系统批量拒绝用；逐条留档在调用方循环内）
export async function dbGetPendingIntentsForDemand(db, demandId) {
  return await dbAll(db,
    `SELECT id, teacher_user_id FROM demand_intents WHERE demand_id=? AND status='pending'`, [demandId]);
}
