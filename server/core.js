/**
 * 服务端核心工具层
 * 响应构造 / D1 辅助 / 密码学 / 管理员校验 / 服务端消息常量
 * 所有路由模块共享此层；此处不放任何业务逻辑
 */

// ============================================================
// 敏感信息已抽离至根目录 secrets.js（公测迁 Worker Secrets，见 docs/secrets-plan.md）
// 管理员种子读 globalThis.APP_SECRETS；管理员鉴权一律走 requireAdmin 令牌机制，
// 「知道管理员用户名」不再等于「能执行管理员操作」
// ============================================================

// 评分系统（初始评分 + 权重，评价通过时做加权平均）
export const INITIAL_RATING = 4.0;

// 教师注册邀请码门控：内测期间休眠（免邀请码注册）；恢复时置 true，
// 并同步前端 constants.js 的 INVITE_GATE_DORMANT 为 false
export const INVITE_GATE_ENABLED = false;
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

  // 教师
  PROFILE_SAVED: '教师信息已保存',

  // 学生需求
  STUDENT_ONLY: '仅学生可提交需求',
  DEMAND_SUBMITTED: '需求已提交',
  DEMAND_NOT_FOUND: '需求不存在',
  DEMAND_UPDATED: '需求已更新',
  DEMAND_DELETED: '需求已删除',
  PROVINCE_REQUIRED: '请选择省份',
  TEACHER_ONLY: '仅教师可操作',
  ADMIN_ONLY: '仅管理员可操作',
  USER_NOT_FOUND: '用户不存在',
  ACCOUNT_BANNED: '该账户已被封禁，禁止登录',
  ACCOUNT_DEACTIVATED: '该账户已注销',
  BANNED: '已封禁',
  UNBANNED: '已解封',

  // 意向
  INTENT_DUPLICATE: '你已对该需求提交过意向',

  // 需求推送
  TEACHER_NOT_FOUND: '目标教师不存在',
  PUSH_SUBMITTED: '需求已发送给老师，等待对方查看',
  PUSH_DUPLICATE: '该需求已发送给这位老师',

  // 通知广播（管理员）
  BROADCAST_EMPTY: '通知内容不能为空',

  // 头像
  AVATAR_INVALID: '头像数据无效（请上传 160px 内的图片）',

  // 用户反馈（给提出者的通知文案在 constants.js UI.FEEDBACK_RESOLVED）
  FEEDBACK_NOT_FOUND: '反馈不存在',

  // 合同（通知模板含 {name} 占位：通知不在聊天上下文，须给出具体用户名）
  CONTRACT_EXISTS: '该会话已存在进行中的合同',
  CONTRACT_NOT_FOUND: '合同不存在',
  CONTRACT_STATE_INVALID: '合同当前状态不允许该操作',
  CONTRACT_MODIFIED_CONFLICT: '合同已被对方修改，请关闭后重新打开查看最新版本',
  DEMAND_CONTRACTED_CLOSED: '该需求已签约成交，已停止接收新意向',
  DEMAND_CONTRACTED_LOCKED: '已签约的需求不可修改或删除',
  CONTRACT_SELF_DRAFT: '草案由你起草，等待对方确认',
  CONTRACT_EMPTY: '合同内容不能为空',
  // 合同各环节给用户的文案统一在 constants.js UI.CONTRACT_*（服务端经 globalThis 读取）
  PROFILE_INCOMPLETE: '教师档案不完整：省份、年级、性别、擅长科目、报价均为必填，完善后才能提交试课意向',
  INTENT_SUBMITTED: '意向已提交',
  INTENT_NOT_FOUND: '意向不存在',
  INTENT_RESOLVED: '意向已处理',
  INTENT_ALREADY_RESOLVED: '该意向已被处理',

  // 沟通
  CONVERSATION_NOT_FOUND: '会话不存在',
  MESSAGE_NOT_FOUND: '消息不存在',
  MESSAGE_TOO_LONG: '消息太长（上限 2000 字）',
  FILE_TOO_LARGE: '附件过大（上限约 500KB，图片会自动压缩）',
  FILE_TYPE_BLOCKED: '不支持的文件类型',

  // 评价
  RATING_RANGE: '评分需在1-5之间',
  COMMENT_TOO_SHORT: '评价内容太短',
  STUDENT_REVIEW_ONLY: '仅学生可发表评价',
  REVIEW_SUBMITTED: '评价已提交，等待管理员审核',
  REVIEW_CONTRACT_ONLY: '评价仅限与该教师签约的学生（签约功能即将上线）',
  REVIEW_EXISTS: '你已评价过该教师，只能修改原评价',
  REVIEW_UPDATED: '评价已更新，重新进入审核',
  REVIEW_NOT_FOUND: '评价不存在',
  REVIEW_APPROVED: '评价已通过',
  REVIEW_REJECTED: '评价已拒绝',
  REVIEW_DELETED: '评价已删除',

  // 通用
  REGISTER_SUCCESS: '注册成功',
  SERVER_ERROR: '服务器内部错误',
  RATE_LIMITED: '请求过于频繁，请稍后再试',
  LOG_NOT_FOUND: '留档记录不存在',
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
// 身份解析：全站一律凭 X-Auth-Token（登录签发，7 天有效，users.auth_token 存储，
// 过期按 UTC 比较——同全站 datetime 纪律）。body/query 里的 userId 只当前端回显用，
// 服务端身份认定永远以令牌解出的用户为准（审计整改：自报 userId 可枚举冒名）
// ============================================================
export async function authUser(db, req) {
  const token = req && req.headers && req.headers.get('X-Auth-Token');
  if (!token) return null;
  const u = await dbGet(db, 'SELECT id,username,role,banned,token_expires FROM users WHERE auth_token=?', [token]);
  if (!u || u.banned) return null;
  const exp = Date.parse(String(u.token_expires || '').replace(' ', 'T') + 'Z');
  if (!exp || exp < Date.now()) return null;
  return u;
}

// 管理员校验 = 令牌用户 + role='admin'
export async function requireAdmin(db, req) {
  const u = await authUser(db, req);
  return u && u.role === 'admin' ? u : null;
}

// ============================================================
// 危险操作 OTP 校验咽喉（注销账户 / 撤销合同等不可逆操作执行前统一过此关）
// 内测期短信未接入 → 恒通过；公测激活后改为向绑定手机发验证码并校验
// （密钥经 secrets 网关，流程见 docs/sms-plan.md），业务调用方零改动
// ============================================================
let BOUND_ENV = null;
export function bindCoreEnv(env) { BOUND_ENV = env; }
export async function confirmDangerOtp(db, userId) {
  void db; void userId; void BOUND_ENV; // BOUND_ENV 激活后取 SMS 密钥用
  return true;
}

// 登录 / 注册签发令牌：48 位随机 hex（熵足够，无需 JWT 的无状态代价）
export async function issueAuthToken(db, userId) {
  const token = bufToHex(crypto.getRandomValues(new Uint8Array(24)));
  const expires = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  await dbRun(db, 'UPDATE users SET auth_token=?, token_expires=? WHERE id=?', [token, expires, userId]);
  return token;
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
