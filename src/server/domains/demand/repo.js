/**
 * 需求域数据层（S3 单科目新模型）：student_demands 单科目 CRUD + 广场列表 + 状态切换。
 *
 * 定案：①联系方式整列删除（parent_contact/student_contact/address_detail/submitter_type 不存储）
 * ②teaching_method 三态 ③target_type 由 subject 派生 ④display_id 删除 ⑤intents/pushes 归 S2 统一删除
 * ⑥状态收敛 open/closed（删 contracted/revoked）。
 *
 * 联系方式永不落库 → 无 encryptField/decryptField、无 mapDemandRowFull 变体；任何出口都拿不到联系方式。
 * 合同不再绑定需求（S5 独立化方向）→ 删除门禁不再查 signing_contracts 引用。
 */
import { dbAll, dbGet, dbRun } from '../../core/util.js';
import { safeJsonArray } from '../../core/json.js';
import { LIMITS } from '../../../shared/config.js';
import { SUBJECTS, NONACADEMIC_PROJECTS } from '../../../shared/enums.js';
import { SUFE_REGIONS } from '../../../shared/region-data.js';

// 单科目 → target_type 派生（③）：academic 学科 / nonacademic 非学科。
// 白名单单源 = enums SUBJECTS ∪ NONACADEMIC_PROJECTS（sanitizeDemand 同源），派生不会落空。
const SUBJECT_TYPE = (() => {
  const map = {};
  for (const s of SUBJECTS) map[s.id] = 'academic';
  for (const p of NONACADEMIC_PROJECTS) map[p.id] = 'nonacademic';
  return map;
})();
function targetTypeOf(subject) {
  return SUBJECT_TYPE[subject] || 'academic'; // 未知科目保守归 academic（sanitize 白名单已剔除非法值）
}

/**
 * 需求行 mapper（单科目新模型，接口 行形状）：
 * 输出 camelCase 业务形状；联系方式字段不存储故不存在；currentScoreFull 由 region-data 单源派生（防漂移）。
 */
export function mapDemandRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    user_id: r.user_id,
    // 列表/详情出口附学生名与头像（/34/38；与 DB 列无关，JOIN 供给，缺省空）
    studentName: r.student_name || '',
    studentAvatar: r.student_avatar || '',
    studentBanned: !!r.student_banned, // 可见性判定：被处罚学生需求对外 404/不进场（）
    subject: r.subject || '',
    targetType: targetTypeOf(r.subject),
    grade: r.grade || '',
    province: r.province || '',
    teachingMethod: r.teaching_method || 'online',
    currentScore: r.current_score || '',
    currentScoreFull: r.subject ? SUFE_REGIONS.subjectMaxFor(r.province, r.subject, r.grade) : 0,
    addressArea: r.address_area || '',
    expectedTime: r.expected_time || '',
    preferredTags: safeJsonArray(r.preferred_tags),
    preferredGender: r.preferred_gender || '',
    budgetMin: r.budget_min || 0,
    budgetMax: r.budget_max || 0,
    additionalInfo: r.additional_info || '',
    status: r.status || 'open',
    createdAt: r.created_at || '',
  };
}

// 需求列表统一查询：JOIN 学生用户名/头像（广场与我的需求共用；行含 studentName/studentAvatar）
const DEMANDS_SELECT = `SELECT sd.*, u.username AS student_name, u.avatar AS student_avatar
  FROM student_demands sd JOIN users u ON sd.user_id=u.id`;

// ============================================================
// 创建 / 更新 / 单条
// ============================================================
export async function dbCreateDemand(db, userId, d) {
  // d 字段为 camelCase（与 interfaces API 契约 + sanitizeDemand 产出一致；形状不 split 双套）
  const result = await dbRun(db, `INSERT INTO student_demands
    (user_id, subject, grade, province, teaching_method, current_score, address_area,
     expected_time, preferred_tags, preferred_gender, budget_min, budget_max, additional_info)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
    userId, d.subject, d.grade, d.province || '', d.teachingMethod || 'online', d.currentScore || '',
    d.addressArea || '', d.expectedTime || '',
    JSON.stringify(Array.isArray(d.preferredTags) ? d.preferredTags : []),
    d.preferredGender || '', d.budgetMin || 0, d.budgetMax || 0, d.additionalInfo || '',
  ]);
  return Number(result.meta.last_row_id);
}

export async function dbUpdateDemand(db, id, d) {
  // d 字段为 camelCase（与 dbCreateDemand 同口径；更新 = 覆盖式，全字段重写）。
  // A3/写前重查闭合：WHERE 带 status='open' 守卫——并发「编辑提交 vs 关闭」下已 closed 需求不命中，
  // 返回 false 由调用方判 409（closed 不可改）；并发删除下不命中 → 调用方 404（E2 防假成功）。
  const r = await dbRun(db, `UPDATE student_demands SET
    subject=?, grade=?, province=?, teaching_method=?, current_score=?, address_area=?,
    expected_time=?, preferred_tags=?, preferred_gender=?, budget_min=?, budget_max=?, additional_info=?
    WHERE id=? AND status='open'`, [
    d.subject, d.grade, d.province || '', d.teachingMethod || 'online', d.currentScore || '',
    d.addressArea || '', d.expectedTime || '',
    JSON.stringify(Array.isArray(d.preferredTags) ? d.preferredTags : []),
    d.preferredGender || '', d.budgetMin || 0, d.budgetMax || 0, d.additionalInfo || '', id,
  ]);
  return !!(r && r.meta && r.meta.changes > 0);
}

export async function dbGetDemandById(db, id) {
  // 详情行含 studentName/studentAvatar + owner banned 标记（可见性判定用）；mapper 输出业务形状
  const row = await dbGet(db,
    `SELECT sd.*, u.username AS student_name, u.avatar AS student_avatar, u.banned AS student_banned
     FROM student_demands sd JOIN users u ON u.id=sd.user_id WHERE sd.id=?`, [id]);
  return row ? mapDemandRow(row) : null;
}

// ============================================================
// 列表
// ============================================================
/**
 * 广场列表（）：status='open' + 已注销用户数据不进广场；可选筛选
 * （subjects[] 单科目白名单 / gender→preferred_gender / priceMin·priceMax 报价区间重叠）
 * 与排序（price→中间价；match→created_at 时间序——matchScore 计算在 api.js 处理器按
 * S4 匹配度单源执行（），本层时间序作为同分稳定排序基线）。
 * 出口 = mapDemandRow（无联系方式）+ studentName/studentAvatar。
 */
export async function dbGetDemands(db, {
  admin = false, cursor = null, filters = null, sort = '', order = 'desc', studentUserId = null,
} = {}) {
  if (admin) {
    // 管理端全量（含已关闭；keyset 游标分页）；新模型无联系方式，不需要 full 变体
    const params = [];
    let where = '';
    if (cursor) {
      const [cCreated, cId] = String(cursor).split('|');
      if (cCreated && cId) {
        where = ' WHERE (sd.created_at < ? OR (sd.created_at = ? AND sd.id < ?))';
        params.push(cCreated, cCreated, parseInt(cId, 10) || 0);
      }
    }
    const rows = await dbAll(db, `${DEMANDS_SELECT}${where}
       ORDER BY sd.created_at DESC, sd.id DESC LIMIT ${LIMITS.PAGE_HAS_MORE}`, params);
    const hasMore = rows.length > LIMITS.PAGE_SIZE;
    const page = hasMore ? rows.slice(0, LIMITS.PAGE_SIZE) : rows;
    const last = page.length ? page[page.length - 1] : null;
    return {
      demands: page.map(mapDemandRow),
      nextCursor: hasMore && last ? `${last.created_at}|${last.id}` : null,
    };
  }

  const cond = [], params = [];
  cond.push("sd.status='open'", 'u.deactivated=0', 'u.banned=0'); // 被处罚学生需求不进广场（对齐教师侧口径）
  if (studentUserId) { cond.push('sd.user_id=?'); params.push(studentUserId); }
  const f = filters || {};
  if (Array.isArray(f.subjects) && f.subjects.length) {
    cond.push(`sd.subject IN (${f.subjects.map(() => '?').join(',')})`);
    params.push(...f.subjects);
  }
  if (f.gender === 'male' || f.gender === 'female') { cond.push("sd.preferred_gender IN ('', ?)"); params.push(f.gender); }
  const priceMin = Number(f.priceMin);
  const priceMax = Number(f.priceMax);
  if (Number.isFinite(priceMin) && priceMin > 0) { cond.push('sd.budget_max >= ?'); params.push(priceMin); }
  if (Number.isFinite(priceMax) && priceMax > 0) { cond.push('sd.budget_min <= ?'); params.push(priceMax); }

  const dir = order === 'asc' ? 'ASC' : 'DESC';
  const orderBy = sort === 'price'
    ? `ORDER BY (COALESCE(sd.budget_min,0)+COALESCE(sd.budget_max,0))/2 ${dir}, sd.created_at DESC`
    : `ORDER BY sd.created_at ${dir}, sd.id ${dir}`; // match 排序在 api.js 处理器（接 S4），此处时间序作同分稳定基线
  const rows = await dbAll(db, `${DEMANDS_SELECT} WHERE ${cond.join(' AND ')} ${orderBy} LIMIT ?`,
    [...params, LIMITS.PUBLIC_LIST_MAX]);
  return rows.map(mapDemandRow);
}

/** 我的需求（）：本人全部（含已关闭，按创建倒序）——无联系方式需解密，纯 mapper */
export async function dbGetDemandsByUser(db, userId) {
  const rows = await dbAll(db, `${DEMANDS_SELECT} WHERE sd.user_id=? ORDER BY sd.created_at DESC, sd.id DESC`, [userId]);
  return rows.map(mapDemandRow);
}

// ============================================================
// 删除 / 状态切换
// ============================================================
/**
 * 删除需求（）：无「已签约禁删」门禁（合同不绑定需求，S5 独立化；无悬空 demand_id 事故面）。
 * 归属校验由路由层 loadOwnedDemand 把关。
 */
export async function dbDeleteDemand(db, id) {
  const r = await dbRun(db, 'DELETE FROM student_demands WHERE id=?', [id]);
  return !!(r && r.meta && r.meta.changes > 0);
}

/** 管理员强制删除需求（S6 管理面）：同普通删除——合同不绑需求，无需清 signing_contracts 引用 */
export async function dbAdminForceDeleteDemand(db, id) {
  const r = await dbRun(db, 'DELETE FROM student_demands WHERE id=?', [id]);
  return !!(r && r.meta && r.meta.changes > 0);
}

/**
 * 状态切换（）：条件 UPDATE 赢家模式（open→closed / closed→open）。
 * 归属/状态合法性由路由层校验；并发双切换仅一个 changes>0。
 */
export async function dbSetDemandStatus(db, id, fromStatus, toStatus) {
  const r = await dbRun(db, 'UPDATE student_demands SET status=? WHERE id=? AND status=?', [toStatus, id, fromStatus]);
  return !!(r && r.meta && r.meta.changes > 0);
}

