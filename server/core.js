/**
 * 服务端核心工具层
 * 响应构造 / D1 辅助 / 密码学 / 管理员校验 / 服务端消息常量
 * 所有路由模块共享此层；此处不放任何业务逻辑
 */

// ============================================================
// 敏感信息 — 部署时建议通过环境变量或 Secrets 覆盖
// ============================================================
export const ADMIN_USERNAMES = ['admin_sufe'];
export const ADMIN_DEFAULT_PASSWORD = 'admin_sufe';

// 评分系统（初始评分 + 权重，评价通过时做加权平均）
export const INITIAL_RATING = 4.0;
export const INITIAL_WEIGHT = 10;

// ============================================================
// 服务端消息常量
// ============================================================
export const MSG = {
  // 验证错误
  USERNAME_LENGTH: '用户名长度需在 3-30 个字符之间',
  PASSWORD_LENGTH: '密码长度至少 6 个字符',
  INVALID_ROLE: '无效的用户角色',
  LOGIN_REQUIRED: '请输入用户名和密码',
  LOGIN_FAILED: '用户名或密码错误',
  USERNAME_TAKEN: '用户名已被注册',

  // 邀请码
  TEACHER_NEEDS_INVITE: '教师注册需要邀请码',
  INVITE_INVALID: '邀请码无效或已过期',
  NO_PERMISSION: '无权限',
  ADMIN_NOT_FOUND: '管理员账户不存在',

  // 教师
  PROFILE_SAVED: '教师信息已保存',

  // 学生需求
  STUDENT_ONLY: '仅学生可提交需求',
  DEMAND_SUBMITTED: '需求已提交',
  DEMAND_NOT_FOUND: '需求不存在',
  DEMAND_UPDATED: '需求已更新',
  DEMAND_DELETED: '需求已删除',
  PROVINCE_REQUIRED: '请选择省份',
  REGION_ONLINE_ONLY: '该省份目前只支持线上教学',
  TEACHER_ONLY: '仅教师可操作',
  ADMIN_ONLY: '仅管理员可操作',
  USER_NOT_FOUND: '用户不存在',
  ACCOUNT_BANNED: '该账户已被封禁，禁止登录',
  BANNED: '已封禁',
  UNBANNED: '已解封',

  // 意向
  INTENT_DUPLICATE: '你已对该需求提交过意向',
  PROFILE_INCOMPLETE: '教师档案不完整：省份、年级、性别、擅长科目、报价均为必填，完善后才能提交试课意向',
  INTENT_SUBMITTED: '意向已提交',
  INTENT_NOT_FOUND: '意向不存在',
  INTENT_RESOLVED: '意向已处理',
  INTENT_ALREADY_RESOLVED: '该意向已被处理',

  // 沟通
  CONVERSATION_NOT_FOUND: '会话不存在',
  MESSAGE_TOO_LONG: '消息太长（上限 2000 字）',
  FEATURE_TODO: '该功能即将开放，敬请期待',

  // 评价
  RATING_RANGE: '评分需在1-5之间',
  COMMENT_TOO_SHORT: '评价内容太短',
  STUDENT_REVIEW_ONLY: '仅学生可发表评价',
  REVIEW_SUBMITTED: '评价已提交，等待管理员审核',
  REVIEW_NOT_FOUND: '评价不存在',
  REVIEW_APPROVED: '评价已通过',
  REVIEW_REJECTED: '评价已拒绝',
  REVIEW_DELETED: '评价已删除',

  // 通用
  REGISTER_SUCCESS: '注册成功',
  SERVER_ERROR: '服务器内部错误',
};

// ============================================================
// DB 辅助函数 (D1 API)
// ============================================================
export async function dbAll(db, sql, params = []) {
  const r = await db.prepare(sql).bind(...params).all();
  return r.results || [];
}

export async function dbGet(db, sql, params = []) {
  return await db.prepare(sql).bind(...params).first();
}

export async function dbRun(db, sql, params = []) {
  return await db.prepare(sql).bind(...params).run();
}

// ============================================================
// 密码学 (Web Crypto API)
// ============================================================
export function bufToHex(buf) {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function hashPassword(password, existingSalt) {
  const salt = existingSalt || bufToHex(crypto.getRandomValues(new Uint8Array(16)));
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-512' },
    keyMaterial, 512
  );
  return { hash: bufToHex(bits), salt };
}

export async function verifyPassword(password, storedHash, salt) {
  const { hash } = await hashPassword(password, salt);
  return hash === storedHash;
}

// ============================================================
// 响应构造
// ============================================================
export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

export function error(msg, status = 400) { return json({ error: msg }, status); }

// ============================================================
// 管理员校验：users 表 role='admin'（旧用户名白名单仅保留用于种子与迁移）
// ============================================================
export async function requireAdmin(db, username) {
  if (!username) return null;
  const u = await dbGet(db, 'SELECT id,username,role FROM users WHERE username=?', [username]);
  return (u && u.role === 'admin') ? u : null;
}

// ============================================================
// 随机邀请码
// ============================================================
export function genCode(len = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, v => chars[v % chars.length]).join('');
}
