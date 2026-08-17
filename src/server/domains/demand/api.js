/**
 * 路由模块：学生需求（增删改查）+ 需求意向 + 学生→教师主动推送
 * 依赖：util（响应构造/钳制）、security（requireUser 守卫）、constants（MSG/STATUS/LIMITS）、
 *       db（数据层）、log（留档）、notify（通知）。身份一律凭令牌（requireUser）。
 * 关口模式：requireUser → 归属校验 → 状态机（条件 UPDATE 赢家）→ 副作用（logEvent/notifyUser）。
 */
import { json, error, sanitizeTimeSlots, isUniqueConflict } from '../../core/util.js';
import { authUser, requireUser } from '../../core/security.js';
import { MSG, STATUS, LIMITS } from '../../../../server/constants.js';
import { auditFreeText } from '../../core/text-audit.js';
import '../../../../region-data.js'; // 副作用导入：globalThis.SUFE_REGIONS（省份校验单源）
import '../../../../constants.js';   // 副作用导入：globalThis.APP_CONSTANTS（系统通知文案单源，与前端共用）
import {
  dbGetUserById, dbCreateDemand, dbGetDemands, dbGetDemandsByUser,
  dbGetDemandById, dbUpdateDemand, dbDeleteDemand, dbReopenDemand,
  dbCreateIntent, dbGetIntentTeachers, dbGetIntentWithDemand, dbResolveIntent,
  dbUpsertConversation, dbGetTeacherProfile,
  dbCreatePush, dbGetPendingPushesForTeacher, dbGetPushById, dbResolvePush, dbAcceptPushAsIntent,
} from '../../../../server/db.js';
import { logEvent } from '../../core/log.js';
import { notifyUser } from '../../core/notify.js';
import { acceptEligibility } from '../teacher/api.js'; // v1.2.0 T3：接单资格统一判定（chsi 核验 + 必填齐全）

const UIC = globalThis.APP_CONSTANTS.UI; // 接受/拒绝通知文案（constants.js 收口）

// 委婉通知文案：拒绝/退回时给对方一个体面的交代（科目名经 region-data 解码；
// R2-b 非学科需求显示 NONACADEMIC_PROJECTS 项目名，未知 id 回退通用文案）
function demandSubjectsText(d) {
  const R = globalThis.SUFE_REGIONS;
  const UI = globalThis.APP_CONSTANTS.UI;
  const AC = globalThis.APP_CONSTANTS;
  const ids = Array.isArray(d && d.target_subjects) ? d.target_subjects : [];
  const names = ids.map(id => {
    if (d && d.target_type === (globalThis.APP_CONSTANTS.DEMAND_TYPES || {}).NONACADEMIC) {
      const p = (AC.NONACADEMIC_PROJECTS || []).find(x => x.id === id);
      return p ? p.name : '';
    }
    return R.subjectNames[id] || '';
  }).filter(Boolean).join('、');
  return names || UI.NOTIFY_SUBJECTS_FALLBACK;
}
const pushRejectNote = d => globalThis.APP_CONSTANTS.UI.NOTIFY_PUSH_REJECT.replace('{subjects}', demandSubjectsText(d));
const intentRejectNote = d => globalThis.APP_CONSTANTS.UI.NOTIFY_INTENT_REJECT.replace('{subjects}', demandSubjectsText(d));

// 需求输入硬化：预算钳到 [0, LIMITS.BUDGET_MAX] 且 max>=min；授课方式白名单（address 已改结构化
// 「区·镇/街道」校验，不再自由文本门牌守卫——见 handleCreateDemand 内 isValidShanghaiAddr 分支）
const clampBudget = v => { const n = Number(v); return Number.isFinite(n) ? Math.min(LIMITS.BUDGET_MAX, Math.max(0, n)) : 0; };
// 需求类型白名单（R2-b）：academic 学科 / nonacademic 非学科，非法回退 academic（静默不拒需求）。
// 取值单源 constants DEMAND_TYPES（与前端同文件，禁止散落字面量）
const TARGET_TYPES = (() => {
  const DT = (globalThis.APP_CONSTANTS && globalThis.APP_CONSTANTS.DEMAND_TYPES) || {};
  return [DT.ACADEMIC || 'academic', DT.NONACADEMIC || 'nonacademic'];
})();
// 学生性别白名单（R2-11）：'' = 不愿透露（需求侧合法空串，default）；male/female/nonbinary 兼容存量数据
const DEMAND_GENDERS = new Set(['', 'male', 'female', 'nonbinary']);
// 偏好老师性别白名单（R2-b）：'' = 不限 / male / female
const PREFERRED_GENDERS = new Set(['', 'male', 'female']);
// 目标 id 白名单按需求类型分流（网安审计：target_subjects 未校验即原样入库，DISP.subjectNames 对未知科目回显原值 →
// 学生账号可注入 <img onerror> 触发管理员统计页存储型 XSS。academic → SUBJECTS；nonacademic → NONACADEMIC_PROJECTS）
function targetIdSetForType(type) {
  const AC = globalThis.APP_CONSTANTS || {};
  const list = type === (AC.DEMAND_TYPES || {}).NONACADEMIC ? (AC.NONACADEMIC_PROJECTS || []) : (AC.SUBJECTS || []);
  return new Set(list.map(x => x.id));
}
function sanitizeDemand(d) {
  d.budget_min = clampBudget(d.budget_min);
  d.budget_max = clampBudget(d.budget_max);
  if (d.budget_max < d.budget_min) d.budget_max = d.budget_min;
  d.teaching_method = ['online', 'offline'].includes(d.teaching_method) ? d.teaching_method : 'offline';
  // v1.3.1 修复：student_grade 白名单（此前无校验——生产脏数据 'grade7' 入库泄漏到卡片）；
  // 非法回退空串（需求创建高频动作，静默回退不拒绝整表——与 target_type 非法回退 academic 同口径）
  const gradeSet = new Set(((globalThis.APP_CONSTANTS && globalThis.APP_CONSTANTS.STUDENT_GRADES) || []).map(g => g.id));
  if (!gradeSet.has(d.student_grade)) d.student_grade = '';
  d.address = (typeof d.address === 'string' ? d.address : '').slice(0, LIMITS.ADDRESS_FIELD_MAX);
  // 2026-08-09 审计 F-1/F-4：补充说明是自由文本——上限截断；门牌守卫由调用方 auditFreeText 单独执行
  // （address 已结构化不再走守卫，仅 additional_info 保留咽喉——合规红线不因字段绕行）
  d.additional_info = (typeof d.additional_info === 'string' ? d.additional_info : '').slice(0, LIMITS.ADDITIONAL_INFO_MAX);
  d.parent_contact = (typeof d.parent_contact === 'string' ? d.parent_contact : '').slice(0, LIMITS.CONTACT_MAX);
  d.student_contact = (typeof d.student_contact === 'string' ? d.student_contact : '').slice(0, LIMITS.CONTACT_MAX);
  // R2-b 需求类型：白名单，非法回退 'academic'
  d.target_type = TARGET_TYPES.includes(d.target_type) ? d.target_type : 'academic';
  // 目标科目/项目按类型分流白名单过滤，注入串被丢弃；去重 + 按池大小封顶（网安 M1：防重复 id
  // 铺量放大存储与广场列表响应体积 DoS）；非数组（字符串等）强制归空数组（网安 L1，与教师侧口径一致）
  const idSet = targetIdSetForType(d.target_type);
  if (Array.isArray(d.target_subjects)) {
    d.target_subjects = [...new Set(d.target_subjects.filter(sid => typeof sid === 'string' && idSet.has(sid)))].slice(0, idSet.size);
  } else {
    d.target_subjects = [];
  }
  // 非学科需求无成绩概念：current_scores 强制置空
  if (d.target_type === (globalThis.APP_CONSTANTS.DEMAND_TYPES || {}).NONACADEMIC) d.current_scores = [];
  // R2-b 偏好老师性格：数组、≤PERSONALITY_TAGS_MAX、白名单、去重。
  // 门禁语义：需求侧刻意「静默回退/静默截断」不拒绝整个需求（与 routes-teacher 档案侧的 400 拒绝不同——
  // 需求创建是用户高频动作，超限偏好不值得打回整张表单；测试 demand-type-guard.test.js 钉死该语义）
  const P = (globalThis.APP_CONSTANTS && globalThis.APP_CONSTANTS.PERSONALITY_TAGS) || [];
  const personalitySet = new Set(P.map(t => t.id));
  const personalityMax = (globalThis.APP_CONSTANTS.CONFIG && globalThis.APP_CONSTANTS.CONFIG.PERSONALITY_TAGS_MAX) || 3;
  if (!Array.isArray(d.preferred_personality_tags)) d.preferred_personality_tags = [];
  d.preferred_personality_tags = [...new Set(d.preferred_personality_tags
    .filter(id => typeof id === 'string' && personalitySet.has(id)))].slice(0, personalityMax);
  // R2-b 偏好老师性别：白名单 ['','male','female']，非法回退 ''（不限）
  d.preferred_teacher_gender = PREFERRED_GENDERS.has(d.preferred_teacher_gender) ? d.preferred_teacher_gender : '';
  // 教学目标白名单（≤TEACHING_GOALS_MAX、TEACHING_GOALS 池、去重；静默截断不拒绝整表）
  const TG = (globalThis.APP_CONSTANTS && globalThis.APP_CONSTANTS.TEACHING_GOALS) || [];
  const goalSet = new Set(TG.map(t => t.id));
  const goalMax = (globalThis.APP_CONSTANTS.CONFIG && globalThis.APP_CONSTANTS.CONFIG.TEACHING_GOALS_MAX) || 2;
  if (!Array.isArray(d.teaching_goal)) d.teaching_goal = [];
  d.teaching_goal = [...new Set(d.teaching_goal.filter(id => typeof id === 'string' && goalSet.has(id)))].slice(0, goalMax);
  // 非学科技能现状 [{project, note}]——project 白名单（NONACADEMIC_PROJECTS）+ note 截断；
  // 仅非学科类型保留（学科需求强制清空，同 current_scores 口径）。非法项剔除。
  if (d.target_type === (globalThis.APP_CONSTANTS.DEMAND_TYPES || {}).NONACADEMIC) {
    const NP = (globalThis.APP_CONSTANTS.NONACADEMIC_PROJECTS) || [];
    const projectSet = new Set(NP.map(p => p.id));
    const noteMax = (globalThis.APP_CONSTANTS.CONFIG && globalThis.APP_CONSTANTS.CONFIG.SKILL_NOTE_MAX) || 300;
    if (!Array.isArray(d.skill_notes)) d.skill_notes = [];
    // 上限 = 非学科项目池大小（去重后每项目至多一条，与成绩行上限语义不同）
    d.skill_notes = d.skill_notes.slice(0, NP.length)
      .map(sn => {
        if (!sn || typeof sn !== 'object' || typeof sn.project !== 'string' || !projectSet.has(sn.project)) return null;
        return { project: sn.project, note: (typeof sn.note === 'string' ? sn.note : '').slice(0, noteMax) };
      })
      .filter(Boolean);
  } else {
    d.skill_notes = [];
  }
  // R2-11 学生性别：白名单 ['','male','female','nonbinary']，非法回退 ''（'' = 不愿透露）
  d.student_gender = DEMAND_GENDERS.has(d.student_gender) ? d.student_gender : '';
  // 平时成绩满分按省+年级钳制（region-data 政策单源）——
  // 前端输入 max 已按 subjectMaxFor（省+年级，region-data 单源），服务端同口径兜底（防绕过前端直传 150）。
  // 只钳制分数模式（mode='score' 或 legacy scale>0）；等第模式无数值不改。非法项剔除。
  if (Array.isArray(d.current_scores)) {
    const R = globalThis.SUFE_REGIONS;
    d.current_scores = d.current_scores
      .slice(0, (globalThis.APP_CONSTANTS.CONFIG && globalThis.APP_CONSTANTS.CONFIG.DEMAND_SCORE_MAX) || 12)
      .map(cs => {
        if (!cs || typeof cs !== 'object' || typeof cs.subject !== 'string' || !R.subjectNames[cs.subject]) return null;
        if (cs.mode === 'score' || Number(cs.scale) > 0) {
          const max = R.subjectMaxFor(d.province, cs.subject, d.student_grade);
          const n = Number(cs.score);
          if (!isFinite(n) || n < 0) { cs.score = ''; }
          else if (n > max) { cs.score = String(max); }
          cs.scale = max; // 满分随学段（前端同源）
        }
        return cs;
      })
      .filter(Boolean);
  }
  return d;
}

export async function handleCreateDemand(db, body, req) {
  const { demand: d = {} } = body;
  if (typeof d !== 'object' || d === null) return error(MSG.INVALID_PARAMS); // 空 body 兜底
  const { user: me, err } = await requireUser(db, req, 'student');
  if (err) return err;
  const userId = me.id;

  const R = globalThis.SUFE_REGIONS;
  if (!d.province || !R.isValidProvince(d.province)) return error(MSG.PROVINCE_REQUIRED);
  if (!R.allowsOffline(d.province)) d.teaching_method = 'online'; // 业务规则：线下许可省才可线下（region-data 数据驱动）
  const ts = sanitizeTimeSlots(d.expected_time);
  if (ts.error) return error(ts.error);
  d.expected_time = ts.value;
  sanitizeDemand(d); // 字段清理（预算钳制/白名单/截断）
  // 需求五（2026-08-13）：address 改结构化（区·镇/街道 picker）→ 不再自由文本，移出门牌审核；
  //   additional_info 仍为自由文本，保留 text-audit 咽喉（合规红线：详细门牌号不收集不因字段绕行）
  const audit = await auditFreeText(d.additional_info);
  if (!audit.ok) return error(audit.layer === 'error' ? MSG.TEXT_AUDIT_UNAVAILABLE : MSG.ADDRESS_TOO_DETAILED);
  // 需求五：地址结构化校验——线上不收集地址（清空）；线下（仅上海 allowed）必须合法「区·镇/街道」
  {
    const R = globalThis.SUFE_REGIONS;
    if (d.teaching_method === 'online') {
      d.address = '';
    } else if (!R || !R.isValidShanghaiAddr(d.address)) {
      return error(MSG.ADDRESS_REQUIRED);
    }
  }
  if (!d.target_subjects || !d.target_subjects.length) return error(MSG.INVALID_PARAMS); // 白名单过滤后为空：无有效科目

  const id = await dbCreateDemand(db, userId, d);
  await logEvent(db, { action: 'demand.create', actorUserId: userId, actorRole: 'student',
    entity: 'demand', entityId: id, detail: { province: d.province, method: d.teaching_method }, req });
  return json({ id, message: MSG.DEMAND_SUBMITTED });
}

// 需求列表三视角，scope 显式选择（身份一律凭令牌，自报 id 的查询参数已废除）。
// 联系方式脱敏已下沉 db.js mapDemandRow 默认出口（任何出口都拿不到），此处不再重复裁剪：
//   （缺省）      公开广场：排除 contracted/revoked，访客可用
//   scope=mine        我的需求：含联系方式（mapDemandRowFull），仅本人
//   scope=for-teacher 教师大厅视角：每条附本人 my_intent_status（按钮三态用）
export async function handleGetDemands(db, url, req) {
  const scope = url.searchParams.get('scope') || '';
  if (scope === 'mine') {
    const { user: me, err } = await requireUser(db, req);
    if (err) return err;
    return json({ demands: await dbGetDemandsByUser(db, me.id) });
  }
  if (scope === 'for-teacher') {
    const { user: me, err } = await requireUser(db, req, 'teacher'); // 角色门（只验登录会被学生冒充教师视角）
    if (err) return err;
    return json({ demands: await dbGetDemands(db, { teacherUserId: me.id }) });
  }
  // 默认视图同时服务登录学生与游客——游客（无令牌）只见 allow_guest_demand=1 的需求
  const me = await authUser(db, req);
  return json({ demands: await dbGetDemands(db, { forGuest: !me }) });
}

// 需求写操作关口：404 存在 → 403 归属 → 409 已签约锁定（update/delete 共用；服务端写入路径硬门禁）
async function loadOwnedDemand(db, demandId, userId) {
  const existing = await dbGetDemandById(db, demandId);
  if (!existing) return { err: error(MSG.DEMAND_NOT_FOUND, 404) };
  if (existing.user_id !== userId) return { err: error(MSG.NO_PERMISSION, 403) };
  if (existing.status === STATUS.CONTRACTED) return { err: error(MSG.DEMAND_CONTRACTED_LOCKED, 409) };
  return { existing };
}

export async function handleUpdateDemand(db, demandId, body, req) {
  const { demand: d = {} } = body;
  if (typeof d !== 'object' || d === null) return error(MSG.INVALID_PARAMS);
  const { user: me, err } = await requireUser(db, req, 'student');
  if (err) return err;
  const g = await loadOwnedDemand(db, demandId, me.id); // 已签约需求锁定，禁改（合同已绑定此需求）
  if (g.err) return g.err;

  const R = globalThis.SUFE_REGIONS;
  if (!d.province || !R.isValidProvince(d.province)) return error(MSG.PROVINCE_REQUIRED);
  if (!R.allowsOffline(d.province)) d.teaching_method = 'online';
  const ts = sanitizeTimeSlots(d.expected_time);
  if (ts.error) return error(ts.error);
  d.expected_time = ts.value;
  sanitizeDemand(d);
  // 需求五：地址结构化校验（同 handleCreateDemand）——线上清空；线下（上海）必须合法「区·镇/街道」
  if (d.teaching_method === 'online') {
    d.address = '';
  } else if (!R.isValidShanghaiAddr(d.address)) {
    return error(MSG.ADDRESS_REQUIRED);
  }
  if (!d.target_subjects || !d.target_subjects.length) return error(MSG.INVALID_PARAMS); // 白名单过滤后为空

  await dbUpdateDemand(db, demandId, d);
  await logEvent(db, { action: 'demand.update', actorUserId: me.id, actorRole: 'student',
    entity: 'demand', entityId: demandId, detail: { province: d.province, method: d.teaching_method }, req });
  return json({ message: MSG.DEMAND_UPDATED });
}

export async function handleDeleteDemand(db, demandId, body, req) {
  const { user: me, err } = await requireUser(db, req, 'student');
  if (err) return err;
  const g = await loadOwnedDemand(db, demandId, me.id); // 已签约需求禁删（会使合同 demand_id 悬空）
  if (g.err) return g.err;
  const ok = await dbDeleteDemand(db, demandId); // 数据层门禁：pending/signing 合同引用时拒绝（防悬空，F-03b）
  if (!ok) return error(MSG.DEMAND_CONTRACTED_LOCKED, 409);
  await logEvent(db, { action: 'demand.delete', actorUserId: me.id, actorRole: 'student',
    entity: 'demand', entityId: demandId, req });
  return json({ message: MSG.DEMAND_DELETED });
}

// POST /api/student/demands/:id/reopen —— 重开「合同已撤销」的需求（仅所有者；revoked→open 重回广场接收意向）
// 撤销合同不自动重开（防锁定扰动），由此处手动触发；条件 UPDATE 赢家模式防并发双触发
export async function handleReopenDemand(db, demandId, body, req) {
  const { user: me, err } = await requireUser(db, req, 'student');
  if (err) return err;
  const existing = await dbGetDemandById(db, demandId);
  if (!existing) return error(MSG.DEMAND_NOT_FOUND, 404);
  if (existing.user_id !== me.id) return error(MSG.NO_PERMISSION, 403);
  if (existing.status !== STATUS.REVOKED) return error(MSG.DEMAND_STATE_INVALID, 409);
  if (!(await dbReopenDemand(db, demandId))) return error(MSG.DEMAND_STATE_INVALID, 409); // 条件 UPDATE 赢家模式
  await logEvent(db, { action: 'demand.reopen', actorUserId: me.id, entity: 'demand', entityId: demandId,
    detail: { from: STATUS.REVOKED }, req });
  return json({ message: MSG.DEMAND_REOPENED });
}

// --- 需求意向（前端四态按钮 UI：my_intent_status 三态 + 撤销重提） ---
export async function handleCreateIntent(db, demandId, body, req) {
  // 教师打招呼消息（Airbnb 租客对房东式；自我介绍+为什么关注此需求）；可选，trim 后超限拒绝
  const message = String(body.message ?? '').trim();
  if (message.length > LIMITS.GREETING_MSG_MAX) return error(MSG.GREETING_TOO_LONG, 400);
  const { user: me, err } = await requireUser(db, req, 'teacher');
  if (err) return err;
  const userId = me.id;
  const demand0 = await dbGetDemandById(db, demandId);
  if (!demand0) return error(MSG.DEMAND_NOT_FOUND, 404);
  if (demand0.status === STATUS.CONTRACTED || demand0.status === STATUS.REVOKED) return error(MSG.DEMAND_CONTRACTED_CLOSED, 410); // 已签约/已撤销需求停止接收意向（服务端硬门禁；撤销后须重开）

  // 接单资格门槛（v1.2.0 T3 升级）：学信网核验通过 + 资料必填齐全（科目/报价/时间/方式）——统一 acceptEligibility 判定
  const p = await dbGetTeacherProfile(db, userId);
  const el = acceptEligibility(p);
  if (!el.ok) {
    return error(el.reason === 'CHSI_UNVERIFIED' ? MSG.CHSI_VERIFY_REQUIRED : MSG.PROFILE_COMPLETE_REQUIRED, 403, el.reason);
  }

  try {
    const id = await dbCreateIntent(db, demandId, userId, message); // 条件 INSERT 原子化：0 = 检查与插入之间需求被签/撤
    if (!id) return error(MSG.DEMAND_CONTRACTED_CLOSED, 410);
    await logEvent(db, { action: 'intent.create', actorUserId: userId, actorUsername: me.username,
      actorRole: 'teacher', entity: 'demand', entityId: demandId, detail: { intentId: id }, req });
    return json({ id, message: MSG.INTENT_SUBMITTED }, 201);
  } catch (err2) {
    if (isUniqueConflict(err2)) return error(MSG.INTENT_DUPLICATE, 409);
    throw err2;
  }
}

export async function handleGetIntents(db, demandId, req) {
  const { user: me, err } = await requireUser(db, req);
  if (err) return err;
  const demand = await dbGetDemandById(db, demandId);
  if (!demand) return error(MSG.DEMAND_NOT_FOUND, 404);
  if (demand.user_id !== me.id) return error(MSG.NO_PERMISSION, 403); // 仅需求所有者可见意向列表
  const teachers = await dbGetIntentTeachers(db, demandId);
  return json({ demandId, count: teachers.length, teachers });
}

// 学生处理意向：accept → 置 accepted 并建立（或复用）师生会话；reject → 置 rejected。
// 顺序契约（与 handleResolvePush 对齐）：先查需求状态再写，杜绝「先写后判」窗口；
// accept 前用 dbLockDemandIntent 抢占（条件 UPDATE），防同需求并发双 accepted + 双会话。
export async function handleResolveIntent(db, intentId, body, req) {
  const { action } = body;
  if (!['accept', 'reject'].includes(action)) return error(MSG.INVALID_ACTION);
  const { user: me, err } = await requireUser(db, req, 'student');
  if (err) return err;
  const userId = me.id;

  const intent = await dbGetIntentWithDemand(db, intentId);
  if (!intent) return error(MSG.INTENT_NOT_FOUND, 404);
  if (intent.demand_owner !== userId) return error(MSG.NO_PERMISSION, 403);
  if (intent.status !== STATUS.PENDING) return error(MSG.INTENT_ALREADY_RESOLVED, 409);

  const dNow = await dbGetDemandById(db, intent.demand_id);
  if (!dNow || dNow.status === STATUS.CONTRACTED || dNow.status === STATUS.REVOKED) return error(MSG.DEMAND_CONTRACTED_CLOSED, 410); // 已撤销需求不可接受意向（须先重开）
  // 接受意向不再锁需求——一条需求允许任意多会话并存，
  // 仅当某会话「发起签约」成功签约时才自动拒绝其余（见 signing.js）

  const status = action === 'accept' ? STATUS.ACCEPTED : STATUS.REJECTED;
  if (!(await dbResolveIntent(db, intentId, status))) return error(MSG.INTENT_ALREADY_RESOLVED, 409); // 条件 UPDATE 赢家才继续，杜绝并发双通知

  let conversationId = null;
  if (action === 'accept') {
    conversationId = await dbUpsertConversation(db, userId, intent.teacher_user_id, intent.demand_id);
    await notifyUser(db, intent.teacher_user_id, UIC.INTENT_ACCEPTED_NOTIFY);
  } else {
    const d = await dbGetDemandById(db, intent.demand_id);
    await notifyUser(db, intent.teacher_user_id, intentRejectNote(d));
  }
  await logEvent(db, { action: `intent.${action}`, actorUserId: userId, actorRole: 'student',
    entity: 'intent', entityId: intentId,
    detail: { demandId: intent.demand_id, teacherUserId: intent.teacher_user_id, conversationId }, req });
  return json({ message: MSG.INTENT_RESOLVED, status, conversationId });
}

// ============================================================
// 学生主动推送需求给指定教师 / 教师处理推送
// ============================================================
export async function handlePushDemand(db, body, req) {
  const { teacherUserId, demandId } = body;
  // 学生打招呼消息（自我介绍+为什么选这位老师）；可选，trim 后超限拒绝
  let message = String(body.message ?? '').trim();
  if (message.length > LIMITS.GREETING_MSG_MAX) return error(MSG.GREETING_TOO_LONG, 400);
  const { user: me, err } = await requireUser(db, req, 'student');
  if (err) return err;
  const userId = me.id;
  const teacher = await dbGetUserById(db, teacherUserId);
  if (!teacher || teacher.role !== 'teacher' || teacher.banned || teacher.deactivated) return error(MSG.TEACHER_NOT_FOUND, 404); // 封禁/注销教师不可被推送（网安审计）
  const demand = await dbGetDemandById(db, demandId);
  if (!demand) return error(MSG.DEMAND_NOT_FOUND, 404);
  if (demand.user_id !== userId) return error(MSG.NO_PERMISSION, 403);
  if (demand.status === STATUS.CONTRACTED || demand.status === STATUS.REVOKED) return error(MSG.DEMAND_CONTRACTED_CLOSED, 410); // 已签约/已撤销需求不可再推送

  try {
    const id = await dbCreatePush(db, demandId, userId, teacherUserId, message); // 条件 INSERT 原子化：0 = 需求已非开放
    if (!id) return error(MSG.DEMAND_CONTRACTED_CLOSED, 410);
    await logEvent(db, { action: 'demand.push', actorUserId: userId, actorRole: 'student',
      entity: 'demand_push', entityId: id, detail: { teacherUserId, demandId }, req });
    return json({ id, message: MSG.PUSH_SUBMITTED }, 201);
  } catch (err2) {
    if (isUniqueConflict(err2)) return error(MSG.PUSH_DUPLICATE, 409);
    throw err2;
  }
}

// 教师端：本人的待处理推送列表（需求大厅置顶 + 红点计数同源；身份凭令牌）
export async function handleGetTeacherPushes(db, url, req) {
  const { user: me, err } = await requireUser(db, req, 'teacher'); // 教师角色门（同 handleResolvePush，防学生空探）
  if (err) return err;
  const pushes = await dbGetPendingPushesForTeacher(db, me.id);
  return json({ pushes });
}

// 教师确认 / 拒绝推送。确认 = 写已接受意向 + 建会话；拒绝 = 仅标记 + 委婉通知学生
export async function handleResolvePush(db, pushId, body, req) {
  const { action } = body;
  if (!['accept', 'reject'].includes(action)) return error(MSG.INVALID_ACTION);
  const { user: me, err } = await requireUser(db, req, 'teacher');
  if (err) return err;
  const userId = me.id;
  const push = await dbGetPushById(db, pushId);
  if (!push) return error(MSG.INTENT_NOT_FOUND, 404);
  if (push.teacher_user_id !== userId) return error(MSG.NO_PERMISSION, 403);
  if (push.status !== STATUS.PENDING) return error(MSG.INTENT_ALREADY_RESOLVED, 409);

  if (action === 'accept') {
    // v1.2.0 T3：推送接受 = 接单动作，须过接单资格（学信网核验 + 必填齐全）
    const prof = await dbGetTeacherProfile(db, userId);
    const el = acceptEligibility(prof);
    if (!el.ok) return error(el.reason === 'CHSI_UNVERIFIED' ? MSG.CHSI_VERIFY_REQUIRED : MSG.PROFILE_COMPLETE_REQUIRED, 403, el.reason);
    const dNow = await dbGetDemandById(db, push.demand_id);
    if (!dNow || dNow.status === STATUS.CONTRACTED || dNow.status === STATUS.REVOKED) return error(MSG.DEMAND_CONTRACTED_CLOSED, 410); // 已签约/已撤销需求不可再确认
    // 确认推送不再锁需求——一条需求允许多会话并存，
    // 仅「发起签约」成功签约时才自动拒绝其余（见 signing.js）
    if (!(await dbResolvePush(db, pushId, STATUS.ACCEPTED))) return error(MSG.INTENT_ALREADY_RESOLVED, 409);
    await dbAcceptPushAsIntent(db, push.demand_id, userId);
    await dbUpsertConversation(db, push.student_user_id, userId, push.demand_id);
    await notifyUser(db, push.student_user_id, UIC.PUSH_ACCEPTED_NOTIFY);
  } else {
    if (!(await dbResolvePush(db, pushId, STATUS.REJECTED))) return error(MSG.INTENT_ALREADY_RESOLVED, 409);
    const d = await dbGetDemandById(db, push.demand_id);
    await notifyUser(db, push.student_user_id, pushRejectNote(d));
  }
  await logEvent(db, { action: `demand_push.${action}`, actorUserId: userId, actorRole: 'teacher',
    entity: 'demand_push', entityId: pushId,
    detail: { demandId: push.demand_id, studentUserId: push.student_user_id }, req });
  return json({ message: 'ok', status: action === 'accept' ? STATUS.ACCEPTED : STATUS.REJECTED });
}

// ============================================================
// demand 域路由表（V-1-4c：需求 / 意向 / 推送）
// ============================================================
const S = (method, path, handler) => ({ method, path, handler });
const n = v => parseInt(v, 10);
export const routes = [
  S('POST', '/api/student/demands', c => handleCreateDemand(c.db, c.body, c.req)),
  S('GET', '/api/student/demands', c => handleGetDemands(c.db, c.url, c.req)),
  S('PUT', '/api/student/demands/:id', c => handleUpdateDemand(c.db, n(c.params.id), c.body, c.req)),
  S('DELETE', '/api/student/demands/:id', c => handleDeleteDemand(c.db, n(c.params.id), c.body, c.req)),
  S('POST', '/api/student/demands/:id/reopen', c => handleReopenDemand(c.db, n(c.params.id), c.body, c.req)),
  S('POST', '/api/demands/:id/intents', c => handleCreateIntent(c.db, n(c.params.id), c.body, c.req)),
  S('GET', '/api/demands/:id/intents', c => handleGetIntents(c.db, n(c.params.id), c.req)),
  S('POST', '/api/intents/:id/resolve', c => handleResolveIntent(c.db, n(c.params.id), c.body, c.req)),
  S('POST', '/api/demand-pushes', c => handlePushDemand(c.db, c.body, c.req)),
  S('GET', '/api/demand-pushes', c => handleGetTeacherPushes(c.db, c.url, c.req)),
  S('POST', '/api/demand-pushes/:id/resolve', c => handleResolvePush(c.db, n(c.params.id), c.body, c.req)),
];
