/**
 * 路由模块：学生需求（单科目新模型 CRUD + 广场 + 开放/关闭）。
 *
 * §15 定案：联系方式不存储、teaching_method 三态、target_type 派生、display_id 删除、
 * intents/pushes 归 S2 删、状态收敛 open/closed。接口形状见 interfaces.md §19 I-33..38。
 * 身份一律凭令牌（requireUser）；写操作关口 = 归属校验 → 状态门禁 → 数据层 → logEvent。
 */
import { json, errorMsg, sanitizeTimeSlots, parseIdParam } from '../../core/util.js';
import { requireUser } from '../../core/security.js';
import { MSG } from '../../../shared/codes.js';
import { STATUS, ROLES, STUDENT_GRADES, PERSONALITY_TAGS, SUBJECTS, NONACADEMIC_PROJECTS, TEACHING_METHOD } from '../../../shared/enums.js';
import { LIMITS, CONFIG } from '../../../shared/config.js';
import { SUFE_REGIONS } from '../../../shared/region-data.js';
import {
  dbCreateDemand, dbGetDemands, dbGetDemandsByUser, dbGetDemandById, dbUpdateDemand, dbDeleteDemand,
  dbSetDemandStatus,
} from './repo.js'; // L1：本域直连，不依赖遗留 server/db.js re-export 图（该图随 S1-S6 并行重写易断）
import { logEvent } from '../../core/log.js';

// 单科目白名单（academic ∪ nonacademic）：创建/更新强制命中，否则 INVALID_PARAMS（单值无静默回退）
const SUBJECT_IDS = new Set([
  ...SUBJECTS.map(s => s.id),
  ...NONACADEMIC_PROJECTS.map(p => p.id),
]);
const GRADE_IDS = new Set(STUDENT_GRADES.map(g => g.id));
const PREFERRED_GENDERS = new Set(['', 'male', 'female']);
const TEACHING_METHODS_SET = new Set([TEACHING_METHOD.ONLINE, TEACHING_METHOD.OFFLINE, TEACHING_METHOD.BOTH]);

// 预算钳制（单源 LIMITS.BUDGET_MAX）且 max>=min
const clampBudget = v => { const n = Number(v); return Number.isFinite(n) ? Math.min(LIMITS.BUDGET_MAX, Math.max(0, n)) : 0; };

/**
 * 需求输入硬化（单科目）：预算钳制 / 白名单 / 截断。非法单值（科目/年级/方式）一律拒绝
 * （I-35 单科目提交，非 v2 数组静默回退语义）；偏好类静默回退/截断（高频表单不因超额打回整表）。
 */
function sanitizeDemand(d) {
  d.budgetMin = clampBudget(d.budgetMin);
  d.budgetMax = clampBudget(d.budgetMax);
  if (d.budgetMax < d.budgetMin) d.budgetMax = d.budgetMin; // 倒挂 → 上限抬齐下限（与 v2 同口径，不拒绝整表）

  if (!SUBJECT_IDS.has(d.subject)) return { error: errorMsg('INVALID_PARAMS') };
  if (!GRADE_IDS.has(d.grade)) return { error: errorMsg('INVALID_PARAMS') };
  if (!TEACHING_METHODS_SET.has(d.teachingMethod)) d.teachingMethod = TEACHING_METHOD.ONLINE;

  d.additionalInfo = (typeof d.additionalInfo === 'string' ? d.additionalInfo : '').slice(0, LIMITS.ADDITIONAL_INFO_MAX);

  // 偏好老师性格：白名单、去重、≤PERSONALITY_TAGS_MAX（静默截断不拒绝整表）
  const P = PERSONALITY_TAGS;
  const personalitySet = new Set(P.map(t => t.id));
  if (!Array.isArray(d.preferredTags)) d.preferredTags = [];
  d.preferredTags = [...new Set(d.preferredTags
    .filter(id => typeof id === 'string' && personalitySet.has(id)))].slice(0, CONFIG.PERSONALITY_TAGS_MAX);

  // 偏好老师性别：白名单 ['','male','female']，非法回退 ''（不限）
  d.preferredGender = PREFERRED_GENDERS.has(d.preferredGender) ? d.preferredGender : '';

  // 平时成绩（单科目）：数字 → 钳 [0, subjectMaxFor]（region-data 单源）；等第字母保留原样；空/缺失/纯空白 → ''
  const cs = typeof d.currentScore === 'string' ? d.currentScore.trim() : '';
  if (d.currentScore == null || cs === '') {
    d.currentScore = '';
  } else {
    const max = SUFE_REGIONS.subjectMaxFor(d.province, d.subject, d.grade);
    const n = Number(cs);
    d.currentScore = Number.isFinite(n) && cs !== ''
      ? String(Math.min(max, Math.max(0, n)))
      : cs.slice(0, 4); // 等第制（A/B/C/D 等）非数字串，截断防脏（L4：先 trim 再判定）
  }

  return d;
}

// 地址校验：线上清空；线下/均可（offline/both）必须合法「区·镇/街道」（仅线下许可省可用，region-data 数据驱动）
function validateAddress(d) {
  if (d.teachingMethod === TEACHING_METHOD.ONLINE) { d.addressArea = ''; return null; }
  if (!SUFE_REGIONS.isValidShanghaiAddr(d.addressArea)) return errorMsg('ADDRESS_REQUIRED');
  return null;
}

// ============================================================
// 创建 / 我的 / 广场 / 详情 / 更新 / 删除 / 状态切换
// ============================================================
// I-35 创建需求：单科目提交，body 直传（无 v2 {demand} 包装）
export async function handleCreateDemand(db, body, req) {
  const d = body || {};
  if (typeof d !== 'object' || Array.isArray(d)) return errorMsg('INVALID_PARAMS');
  const { user: me, err } = await requireUser(db, req, 'student');
  if (err) return err;
  const userId = me.id;

  const R = SUFE_REGIONS;
  if (!d.province || !R.isValidProvince(d.province)) return errorMsg('PROVINCE_REQUIRED');
  if (!R.allowsOffline(d.province)) d.teachingMethod = TEACHING_METHOD.ONLINE; // 线下许可省才可线下

  const s = sanitizeDemand(d);
  if (s && s.error instanceof Response) return s.error; // 仅失败哨兵是 Response；防 body 用户可控 error 字段冒充（C4）
  const aErr = validateAddress(d);
  if (aErr) return aErr;

  const ts = sanitizeTimeSlots(d.expectedTime);
  if (ts.error) return errorMsg('INVALID_TIME_SLOTS');
  d.expectedTime = ts.value;

  const id = await dbCreateDemand(db, userId, d);
  await logEvent(db, { action: 'demand.create', actorUserId: userId, actorRole: 'student',
    entity: 'demand', entityId: id, detail: { province: d.province, method: d.teachingMethod, subject: d.subject }, req });
  return json({ id, message: MSG.DEMAND_SUBMITTED });
}

// I-33 我的需求（学生本人；含已关闭）
export async function handleGetMyDemands(db, req) {
  const { user: me, err } = await requireUser(db, req, 'student');
  if (err) return err;
  // I-33 envelope: { items } — frontend useDemands reads data.items (interfaces.md §19 I-33)
  return json({ items: await dbGetDemandsByUser(db, me.id) });
}

// I-34 需求广场（B1 教师视角）：登录可见；排序 match（S3-15 占位）/price；筛选 subjects[]/gender/price 区间
export async function handleGetDemands(db, url, req) {
  const { user: me, err } = await requireUser(db, req);
  if (err) return err;
  const sort = url.searchParams.get('sort') || '';
  const order = url.searchParams.get('order') === 'asc' ? 'asc' : 'desc';
  let filters = null;
  const fRaw = url.searchParams.get('filters');
  if (fRaw) { try { filters = JSON.parse(fRaw); } catch { filters = null; } }
  const demands = await dbGetDemands(db, { filters, sort, order });
  // S3-15：matchScore/matchCount 依赖 S4 新匹配度，未接入前占位 null（前端按 null 回落不显示）
  // I-34 envelope: { items, total } — frontend demands-service reads json.items + json.total
  return json({ items: demands.map(x => ({ ...x, matchScore: null, matchCount: null })), total: demands.length });
}

// I-38 需求详情：可见性规则（interfaces §19）——owner（学生本人）任意状态可看；
// teacher 角色仅 OPEN 可看（广场浏览）；其他角色/无归属 → 404 DEMAND_NOT_FOUND（不泄漏存在性）。
export async function handleGetDemandDetail(db, demandId, req) {
  const { user: me, err } = await requireUser(db, req);
  if (err) return err;
  const demand = await dbGetDemandById(db, demandId);
  if (!demand) return errorMsg('DEMAND_NOT_FOUND', 404);
  const isOwner = demand.user_id === me.id;
  if (!isOwner && (me.role !== ROLES.TEACHER || demand.status !== STATUS.OPEN || demand.studentBanned)) {
    return errorMsg('DEMAND_NOT_FOUND', 404); // 非 owner 教师看不到 closed/被处罚学生需求；其余一律视同不存在
  }
  return json({ demand });
}

// 写操作关口：404 存在 → 403 归属
async function loadOwnedDemand(db, demandId, userId) {
  const existing = await dbGetDemandById(db, demandId);
  if (!existing) return { err: errorMsg('DEMAND_NOT_FOUND', 404) };
  if (existing.user_id !== userId) return { err: errorMsg('NO_PERMISSION', 403) };
  return { existing };
}

// I-36 更新需求（归属；closed 不可改）
export async function handleUpdateDemand(db, demandId, body, req) {
  const d = body || {};
  if (typeof d !== 'object' || Array.isArray(d)) return errorMsg('INVALID_PARAMS');
  const { user: me, err } = await requireUser(db, req, 'student');
  if (err) return err;
  const g = await loadOwnedDemand(db, demandId, me.id);
  if (g.err) return g.err;
  if (g.existing.status === STATUS.CLOSED) return errorMsg('DEMAND_STATE_INVALID', 409); // I-36：closed 不可改

  const R = SUFE_REGIONS;
  if (!d.province || !R.isValidProvince(d.province)) return errorMsg('PROVINCE_REQUIRED');
  if (!R.allowsOffline(d.province)) d.teachingMethod = TEACHING_METHOD.ONLINE;
  const s = sanitizeDemand(d);
  if (s && s.error instanceof Response) return s.error; // 仅失败哨兵是 Response；防 body 用户可控 error 字段冒充（C4）
  const aErr = validateAddress(d);
  if (aErr) return aErr;
  const ts = sanitizeTimeSlots(d.expectedTime);
  if (ts.error) return errorMsg('INVALID_TIME_SLOTS');
  d.expectedTime = ts.value;

  // L2/L3：条件 UPDATE（status='open' 守卫）changes 判定——并发关闭/删除下不命中 → 404/409 而非假成功
  if (!(await dbUpdateDemand(db, demandId, d))) {
    const cur = await dbGetDemandById(db, demandId);
    if (!cur) return errorMsg('DEMAND_NOT_FOUND', 404);
    return errorMsg('DEMAND_STATE_INVALID', 409); // closed（并发窗口内被关）→ I-36 不可改
  }
  await logEvent(db, { action: 'demand.update', actorUserId: me.id, actorRole: 'student',
    entity: 'demand', entityId: demandId, detail: { province: d.province, method: d.teachingMethod, subject: d.subject }, req });
  return json({ message: MSG.DEMAND_UPDATED });
}

// I-37 删除需求（归属；无「已签约禁删」门禁——合同不绑定需求）
export async function handleDeleteDemand(db, demandId, body, req) {
  const { user: me, err } = await requireUser(db, req, 'student');
  if (err) return err;
  const g = await loadOwnedDemand(db, demandId, me.id);
  if (g.err) return g.err;
  if (!(await dbDeleteDemand(db, demandId))) return errorMsg('DEMAND_NOT_FOUND', 404);
  await logEvent(db, { action: 'demand.delete', actorUserId: me.id, actorRole: 'student',
    entity: 'demand', entityId: demandId, req });
  return json({ message: MSG.DEMAND_DELETED });
}

// S3-13 开放/关闭切换（归属；条件 UPDATE 赢家模式防并发双切）
async function toggleStatus(db, demandId, body, req, targetStatus) {
  const { user: me, err } = await requireUser(db, req, 'student');
  if (err) return err;
  const g = await loadOwnedDemand(db, demandId, me.id);
  if (g.err) return g.err;
  if (g.existing.status === targetStatus) return errorMsg('DEMAND_STATE_INVALID', 409); // 已处目标态
  const from = targetStatus === STATUS.CLOSED ? STATUS.OPEN : STATUS.CLOSED;
  if (!(await dbSetDemandStatus(db, demandId, from, targetStatus))) return errorMsg('DEMAND_STATE_INVALID', 409);
  await logEvent(db, { action: `demand.${targetStatus}`, actorUserId: me.id, actorRole: 'student',
    entity: 'demand', entityId: demandId, detail: { from, to: targetStatus }, req });
  return json({ message: targetStatus === STATUS.CLOSED ? MSG.DEMAND_CLOSED : MSG.DEMAND_OPENED, status: targetStatus });
}

export const handleCloseDemand = (db, demandId, body, req) => toggleStatus(db, demandId, body, req, STATUS.CLOSED);
export const handleOpenDemand = (db, demandId, body, req) => toggleStatus(db, demandId, body, req, STATUS.OPEN);

// ============================================================
// demand 域路由表（S3 新模型：I-33..38 + 开放/关闭；intents/pushes 归 S2 删）
// ============================================================
const S = (method, path, handler) => ({ method, path, handler });
export const routes = [
  S('POST', '/api/demands', c => handleCreateDemand(c.db, c.body, c.req)),
  S('GET', '/api/demands/mine', c => handleGetMyDemands(c.db, c.req)),
  S('GET', '/api/demands', c => handleGetDemands(c.db, c.url, c.req)),
  S('GET', '/api/demands/:id', c => handleGetDemandDetail(c.db, parseIdParam(c.params.id), c.req)),
  S('PUT', '/api/demands/:id', c => handleUpdateDemand(c.db, parseIdParam(c.params.id), c.body, c.req)),
  S('DELETE', '/api/demands/:id', c => handleDeleteDemand(c.db, parseIdParam(c.params.id), c.body, c.req)),
  S('POST', '/api/demands/:id/close', c => handleCloseDemand(c.db, parseIdParam(c.params.id), c.body, c.req)),
  S('POST', '/api/demands/:id/open', c => handleOpenDemand(c.db, parseIdParam(c.params.id), c.body, c.req)),
];
