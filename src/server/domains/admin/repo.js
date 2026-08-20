/**
 * 管理域数据层（V-1-4 从 server/db.js 提取）：统计/用户管理/统一内容提取。
 */
import { dbAll, dbGet, dbRun } from '../../core/util.js'; // Z-6-F1：dbRevokeInviteCode/dbDeleteFeedback/dbDeleteComplaint 补 dbRun（断线修复）
import { safeJsonArray } from '../../core/json.js';
import { LIMITS } from '../../../shared/config.js';
import { MSG } from '../../../shared/codes.js'; // Q-2i-M5：内容审核 title 文案单源
import { mapTeacherProfileRow } from '../teacher/repo.js'; // U-3a F2: single-source teacher row decrypt for admin search
import { likeEscape } from '../posts/repo.js'; // U-3a F2: shared LIKE-escape (same single source as complaints search)

// ============================================================
// 管理员统计
// ============================================================
export async function dbGetUserStats(db) {
  return await dbGet(db, `SELECT COUNT(*) as total,
    SUM(CASE WHEN role='student' THEN 1 ELSE 0 END) as students,
    SUM(CASE WHEN role='teacher' THEN 1 ELSE 0 END) as teachers FROM users`);
}

// 网安审计 N-17：表名白名单映射（消除调用方拼表名进 SQL 的注入形状；未知表返回 0 不炸）
const COUNT_TABLES = { teacher_profiles: 1, student_demands: 1, teacher_awards: 1, feedbacks: 1, complaints: 1, teacher_verifications: 1 }; // Z-6-F2：dashboard 待办「教师核验」计数此前白名单缺表恒 0
// 条件计数（统计页待办队列用）：表名必须过 COUNT_TABLES 白名单（防注入），
// where 为内部硬编码字面量（status 枚举），禁止拼接用户输入
export async function dbGetCountWhere(db, table, where) {
  if (!COUNT_TABLES[table]) return 0;
  const r = await dbGet(db, `SELECT COUNT(*) AS c FROM ${table} WHERE ${where}`, []);
  return r ? Number(r.c) : 0;
}

export async function dbGetCount(db, table) {
  if (!COUNT_TABLES[table]) return 0;
  const row = await dbGet(db, `SELECT COUNT(*) as cnt FROM ${table}`);
  return row?.cnt || 0;
}

export async function dbGetReviewStats(db) {
  return await dbGet(db, `SELECT COUNT(*) as total,
    SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) as approved,
    SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) as pending,
    SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) as rejected FROM reviews`);
}

export async function dbGetInviteStats(db) {
  // v1.2.0 T4：邀请码无过期时间——active = 未使用（used_by IS NULL）
  return await dbGet(db, `SELECT COUNT(*) as total,
    SUM(CASE WHEN used_by IS NOT NULL THEN 1 ELSE 0 END) as used,
    SUM(CASE WHEN used_by IS NULL THEN 1 ELSE 0 END) as active
    FROM invite_codes`);
}

/** v1.2.0 T4：邀请码列表（管理员管理模块）——含使用者用户名；未用在前，按创建倒序 */
export async function dbListInviteCodes(db) {
  return await dbAll(db, `SELECT i.code, i.created_at, i.used_by, i.used_at, u.username AS used_by_username
    FROM invite_codes i LEFT JOIN users u ON u.id=i.used_by
    ORDER BY (i.used_by IS NOT NULL), i.created_at DESC LIMIT 200`);
}

/** v1.2.0 T4：作废未使用邀请码（已使用不可作废——使用即永久失效） */
export async function dbRevokeInviteCode(db, code) {
  const r = await dbRun(db, 'DELETE FROM invite_codes WHERE code=? AND used_by IS NULL', [code]);
  return !!(r && r.meta && r.meta.changes > 0);
}

export async function dbGetRecentUsers(db, limit = LIMITS.RECENT_LIMIT) {
  return await dbAll(db, 'SELECT id,username,role,created_at FROM users ORDER BY created_at DESC LIMIT ?', [limit]);
}

export async function dbGetRecentDemands(db, limit = LIMITS.RECENT_LIMIT) {
  // R2-b：含 target_type，管理端统计「最近需求」按学科/非学科显示对应目标名
  const rows = await dbAll(db, `SELECT sd.id,sd.student_grade,sd.target_subjects,sd.target_type,sd.created_at,u.username
    FROM student_demands sd JOIN users u ON sd.user_id=u.id ORDER BY sd.created_at DESC LIMIT ?`, [limit]);
  return rows.map(d => ({ ...d, target_subjects: safeJsonArray(d.target_subjects) }));
}

// ============================================================
// 管理员用户管理
// ============================================================
// 学生列表：LEFT JOIN 统计需求数
export async function dbGetStudentUsersAdmin(db) {
  return await dbAll(db, `SELECT u.id,u.username,u.role,u.banned,u.created_at,COUNT(sd.id) AS demand_count
    FROM users u LEFT JOIN student_demands sd ON sd.user_id=u.id
    WHERE u.role='student' GROUP BY u.id ORDER BY u.created_at DESC`);
}

// U-3a rework (audit F2): admin username search must return the FULL row shape the list path
// uses — dbSearchUsersByRole (complaints domain) returns only {id,username,role}, which made
// search rows lose banned/created_at/demand_count (student) and grade/rating/price/verified
// (teacher). Reuses mapTeacherProfileRow (single-source decrypt) + likeEscape (posts/repo shared
// tool, same LIKE-escape single source as complaints).
export async function dbAdminSearchUsers(db, role, q, limit = LIMITS.ADMIN_SEARCH_MAX) {
  const num = /^\d+$/.test(q) ? +q : 0;
  const like = `%${likeEscape(q)}%`;
  if (role === 'teacher') {
    const rows = await dbAll(db, `SELECT u.id AS user_id, u.username, u.role, u.banned, u.created_at,
        tp.id, tp.grade, tp.gender, tp.subjects, tp.gaokao_scores, tp.price, tp.price_min, tp.price_max,
        tp.wechat, tp.email, tp.time_slots, tp.teaching_method,
        tp.personality_tags, tp.nonacademic_projects, tp.nonacademic_prices,
        tp.graduation_year,
        tp.rating, tp.rating_count, tp.province, tp.intro, tp.address, tp.school, tp.real_name,
        tp.verified, tp.chsi_school, tp.chsi_level, tp.chsi_major, tp.chsi_status, tp.chsi_enroll_year, tp.chsi_verified,
        tp.updated_at
      FROM users u LEFT JOIN teacher_profiles tp ON tp.user_id=u.id
      WHERE u.role='teacher' AND (u.username LIKE ? ESCAPE '\\' OR (? > 0 AND u.id = ?))
      ORDER BY u.id DESC LIMIT ${limit}`, [like, num, num]);
    return await Promise.all(rows.map(async r => ({ ...(await mapTeacherProfileRow(r)), role: r.role, banned: r.banned, created_at: r.created_at })));
  }
  return await dbAll(db, `SELECT u.id,u.username,u.role,u.banned,u.created_at,COUNT(sd.id) AS demand_count
    FROM users u LEFT JOIN student_demands sd ON sd.user_id=u.id
    WHERE u.role='student' AND (u.username LIKE ? ESCAPE '\\' OR (? > 0 AND u.id = ?))
    GROUP BY u.id ORDER BY u.id DESC LIMIT ${limit}`, [like, num, num]);
}

// ============================================================
// ============================================================
// D1 统一内容提取（审核者「一声令下看所有数据」）：逐表查询全部用户可操作内容，
// 归拢统一结构 { type, id, author:{id,username,role}, title, body, status, created_at, extra }。
// 增量改造：只新增本查询出口，不改变任何现有内容流转；私密字段（联系方式/附件本体）不提取。
// type 过滤参数：不传 = 全类型（每类型取 limit 条最新）；传 = 单类型。
// ============================================================
// 逐表串行 10 次 dbAll → 单次 db.batch（1 往返原子读，
// 无 type 过滤的全类型内容页是最重单查询：10 次串行 D1 → 1 次）。SQL 与行映射各自集中，
// 语义与旧实现逐字节一致（测试仍逐类型断言形状）。私密字段（联系方式/附件本体）不提取不变。
const CONTENT_SQL = {
  post: `SELECT p.id, p.user_id, u.username, u.role, p.section, p.title, p.body_md, p.like_count, p.created_at
    FROM posts p LEFT JOIN users u ON u.id=p.user_id ORDER BY p.id DESC LIMIT ?`,
  demand: `SELECT sd.id, sd.user_id, u.username, u.role, sd.status, sd.target_subjects, sd.address, sd.additional_info, sd.display_id, sd.created_at
    FROM student_demands sd LEFT JOIN users u ON u.id=sd.user_id ORDER BY sd.id DESC LIMIT ?`,
  teacher: `SELECT tp.user_id, u.username, u.role, tp.intro, tp.address, tp.school, tp.verified, tp.updated_at
    FROM teacher_profiles tp LEFT JOIN users u ON u.id=tp.user_id ORDER BY tp.updated_at DESC LIMIT ?`,
  review: `SELECT r.id, r.reviewer_user_id, u.username, u.role, r.rating, r.comment, r.status, r.created_at
    FROM reviews r LEFT JOIN users u ON u.id=r.reviewer_user_id ORDER BY r.id DESC LIMIT ?`,
  message: `SELECT m.id, m.conversation_id, m.sender_user_id, u.username, u.role, m.kind, m.body, m.name, m.created_at
    FROM messages m LEFT JOIN users u ON u.id=m.sender_user_id ORDER BY m.id DESC LIMIT ?`,
  feedback: `SELECT f.id, f.user_id, u.username, u.role, f.kind, f.title, f.content, f.status, f.created_at
    FROM feedbacks f LEFT JOIN users u ON u.id=f.user_id ORDER BY f.id DESC LIMIT ?`,
  complaint: `SELECT c.id, c.user_id, u.username, u.role, c.target_type, c.target_id, c.reason, c.detail, c.status, c.created_at
    FROM complaints c LEFT JOIN users u ON u.id=c.user_id ORDER BY c.id DESC LIMIT ?`,
  upload: `SELECT o.id, o.user_id, u.username, u.role, o.kind, o.name, o.created_at
    FROM uploads o LEFT JOIN users u ON u.id=o.user_id ORDER BY o.id DESC LIMIT ?`,
  contract: `SELECT c.id, c.drafter_user_id, u.username, u.role, c.plan, c.schedule, c.status, c.created_at
    FROM contracts c LEFT JOIN users u ON u.id=c.drafter_user_id ORDER BY c.id DESC LIMIT ?`,
  signing: `SELECT s.id, s.initiator_user_id, u.username, u.role, s.price, s.schedule, s.method, s.status, s.created_at
    FROM signing_requests s LEFT JOIN users u ON u.id=s.initiator_user_id ORDER BY s.id DESC LIMIT ?`,
};

// SQL 与行映射都按类型字符串键控（CONTENT_MAPPER[t]），
// 类型清单由 CONTENT_SQL 的键派生（CONTENT_TYPES）——增类型只改 CONTENT_SQL + CONTENT_MAPPER
// 两处同名键，清单自动跟随，杜绝「硬编码清单与表域错位」。
// 无效 type（非键）→ 返回空列表，不再崩溃。
// Q-2i-M5：title 显示文案 codes.js MSG 单源（原内联中文模板）
const tpl = (t, vars) => t.replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null ? vars[k] : m)); // Q-2i-M5c：未知变量保留原文——用户可控字段值内的 {ascii词}（如附件名 report{2024}.pdf）不再被吞掉
const CONTENT_MAPPER = {
  post: r => ({ type: 'post', id: r.id, author: { id: r.user_id, username: r.username, role: r.role }, title: r.title, body: r.body_md, status: '', created_at: r.created_at, extra: { section: r.section, like_count: r.like_count } }),
  demand: r => ({ type: 'demand', id: r.id, author: { id: r.user_id, username: r.username, role: r.role }, title: tpl(MSG.CONTENT_TITLE_DEMAND, { id: r.display_id || r.id }), body: [safeJsonArray(r.target_subjects).join('、'), r.address, r.additional_info].filter(Boolean).join(' · '), status: r.status, created_at: r.created_at, extra: {} }),
  teacher: r => ({ type: 'teacher', id: r.user_id, author: { id: r.user_id, username: r.username, role: r.role }, title: tpl(MSG.CONTENT_TITLE_TEACHER, { name: r.username || '' }), body: [r.intro, r.address, r.school].filter(Boolean).join(' · '), status: r.verified ? 'verified' : '', created_at: r.updated_at, extra: {} }),
  review: r => ({ type: 'review', id: r.id, author: { id: r.reviewer_user_id, username: r.username, role: r.role }, title: tpl(MSG.CONTENT_TITLE_REVIEW, { rating: r.rating }), body: r.comment, status: r.status, created_at: r.created_at, extra: {} }),
  message: r => ({ type: 'message', id: r.id, author: { id: r.sender_user_id, username: r.username, role: r.role }, title: r.kind === 'text' ? MSG.CONTENT_TITLE_MESSAGE_TEXT : tpl(MSG.CONTENT_TITLE_MESSAGE_ATTACH, { kind: r.kind, name: r.name ? ' · ' + r.name : '' }), body: r.body, status: '', created_at: r.created_at, extra: { conversation_id: r.conversation_id, kind: r.kind } }),
  feedback: r => ({ type: 'feedback', id: r.id, author: { id: r.user_id, username: r.username, role: r.role }, title: r.title || tpl(MSG.CONTENT_TITLE_FEEDBACK, { kind: r.kind }), body: r.content, status: r.status, created_at: r.created_at, extra: { kind: r.kind } }),
  complaint: r => ({ type: 'complaint', id: r.id, author: { id: r.user_id, username: r.username, role: r.role }, title: tpl(MSG.CONTENT_TITLE_COMPLAINT, { target: r.target_type, id: r.target_id, reason: r.reason }), body: r.detail, status: r.status, created_at: r.created_at, extra: { target_type: r.target_type, target_id: r.target_id } }),
  upload: r => ({ type: 'upload', id: r.id, author: { id: r.user_id, username: r.username, role: r.role }, title: tpl(MSG.CONTENT_TITLE_UPLOAD, { kind: r.kind, name: r.name ? ' · ' + r.name : '' }), body: '', status: '', created_at: r.created_at, extra: { kind: r.kind } }),
  contract: r => ({ type: 'contract', id: r.id, author: { id: r.drafter_user_id, username: r.username, role: r.role }, title: MSG.CONTENT_TITLE_CONTRACT, body: [r.plan, r.schedule].filter(Boolean).join(' · '), status: r.status, created_at: r.created_at, extra: {} }),
  signing: r => ({ type: 'signing', id: r.id, author: { id: r.initiator_user_id, username: r.username, role: r.role }, title: tpl(MSG.CONTENT_TITLE_SIGNING, { price: r.price > 0 ? r.price + MSG.CONTENT_PRICE_PER_HOUR : '' }), body: [r.schedule, r.method].filter(Boolean).join(' · '), status: r.status, created_at: r.created_at, extra: {} }),
};

function mapContentRows(t, rows, out) {
  const m = CONTENT_MAPPER[t];
  if (!m) return; // 类型键无映射（新增表域忘补映射）→ 跳过；清单本身由 CONTENT_SQL 键派生不会漏列
  for (const r of rows) out.push(m(r));
}

export const CONTENT_TYPES = Object.keys(CONTENT_SQL); // 单源：类型清单自动跟随 CONTENT_SQL 键

export async function dbGetAllContentAdmin(db, { type = null, limit = LIMITS.PUBLIC_LIST_MAX } = {}) {
  // 补 contract（合同正文——最敏感的用户内容）与 signing（签约请求），
  // 统一内容页现在可审全部用户可操作内容。
  const types = (type && CONTENT_SQL[type]) ? [type] : (type ? [] : CONTENT_TYPES);
  if (!types.length) return []; // 无效 type/空清单 → 空结果；不调 D1 batch([])（真实 D1 空数组 batch 会抛错，
    // 真实 D1 空数组 batch 会抛错，空清单必须提前 return（mock shim 同行为回归拦截）
  const results = await db.batch(types.map(t => db.prepare(CONTENT_SQL[t]).bind(limit)));
  const out = [];
  results.forEach((r, i) => mapContentRows(types[i], (r && r.results) || [], out));
  return out;
}

// D2 处罚所需删除 mapper（反馈/投诉此前仅有 resolve，无删除；内容审核通道需硬删）
export async function dbDeleteFeedback(db, id) {
  await dbRun(db, 'DELETE FROM feedbacks WHERE id=?', [id]);
}
export async function dbDeleteComplaint(db, id) {
  await dbRun(db, 'DELETE FROM complaints WHERE id=?', [id]);
}
