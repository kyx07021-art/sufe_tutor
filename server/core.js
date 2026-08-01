/**
 * 服务端核心工具层
 * 响应构造 / D1 辅助 / 密码学 / 管理员校验 / 服务端消息常量
 * 所有路由模块共享此层；此处不放任何业务逻辑
 */

// ============================================================
// 敏感信息已抽离至根目录 secrets.js（公测迁 Worker Secrets，见 docs/secrets-plan.md）
// 管理员种子经 secrets 网关；管理员鉴权一律走 requireAdminOrError 令牌机制，
// 「知道管理员用户名」不再等于「能执行管理员操作」
// ============================================================

// 评分系统（初始评分 + 权重，评价通过时做加权平均）
export const INITIAL_RATING = 4.0;

// 教师注册邀请码门控：开启状态（网安报告 F-05——教师开放注册属高危，注册必须凭管理员邀请码）。
// 管理员在侧边栏「生成邀请码」签发；前端 constants.js INVITE_GATE_DORMANT 须同步为 false
export const INVITE_GATE_ENABLED = true;
export const INITIAL_WEIGHT = 10;

// ============================================================
// 业务状态常量：JS 比较/赋值处一律引这里；SQL 语句内的字面量保持原样不插常量（插值易错不值）
// 值与数据库状态字面量逐字相同，改动即破坏兼容
// ============================================================
export const STATUS = {
  OPEN: 'open',             // 需求开放中 / 反馈待处理
  CONTRACTED: 'contracted', // 需求已签约下架
  REVOKED: 'revoked',       // 需求合同已撤销（待所有者手动重开）
  PENDING: 'pending',       // 意向/推送待处理 / 合同草案 / 评价待审核
  ACCEPTED: 'accepted',     // 意向/推送已接受
  REJECTED: 'rejected',     // 意向/推送已拒绝 / 评价已拒绝
  SIGNING: 'signing',       // 合同待签约（双方确认中）
  SIGNED: 'signed',         // 合同已签约（评价门槛 dbIsContracted 放行）
  APPROVED: 'approved',     // 评价已通过
  ACTIVE: 'active',         // 会话进行中
  CLOSED: 'closed',         // 会话已关闭
  RESOLVED: 'resolved',     // 反馈已处理
};

// ============================================================
// 服务端消息常量
// ============================================================
export const MSG = {
  // 验证错误
  USERNAME_LENGTH: '用户名长度需在 3-30 个字符之间',
  USERNAME_INVALID: '用户名只能包含中文、字母、数字及 _ . - （3-30 个字符）',
  PASSWORD_LENGTH: '密码长度至少 6 个字符',
  INVALID_ROLE: '无效的用户角色',
  INVALID_PARAMS: '参数不合法',
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
  DEMAND_REOPENED: '需求已重新开放',
  DEMAND_STATE_INVALID: '当前需求状态不允许此操作',
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
  UPLOAD_STAGING_LIMIT: '暂存的待发送附件过多，请先发送或删除部分附件',

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

  // 登录设备（会话）
  SESSION_NOT_FOUND: '该设备的登录状态不存在或已失效',

  // 通用
  REGISTER_SUCCESS: '注册成功',
  REAUTH_FAILED: '密码错误，请重新输入后再试',
  SERVER_ERROR: '服务器内部错误',
  PAYLOAD_TOO_LARGE: '请求体过大',
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

export function error(msg, status = 400, code) { return json({ error: msg, code }, status); }

// ============================================================
// 身份解析：全站一律凭 X-Auth-Token（登录签发，7 天有效，auth_sessions 多端会话表存储，
// 过期按 UTC 比较——同全站 datetime 纪律）。body/query 里的 userId 只当前端回显用，
// 服务端身份认定永远以令牌解出的用户为准（审计整改：自报 userId 可枚举冒名）
// ============================================================
export async function authUser(db, req) {
  const token = req && req.headers && req.headers.get('X-Auth-Token');
  if (!token) return null;
  const u = await dbGet(db, `SELECT u.id,u.username,u.role,u.avatar,u.banned,s.expires_at AS token_expires
    FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?`, [await tokenDigest(token)]);
  if (!u || u.banned) return null;
  const exp = Date.parse(String(u.token_expires || '').replace(' ', 'T') + 'Z');
  if (!exp || exp < Date.now()) return null;
  return u;
}

// 管理员鉴权两行式合一：调用方先用 authUser 解令牌用户再传入。
// 非管理员（含无令牌 / 令牌失效，authUser 返 null）→ 返 403 响应对象；通过 → 返 null。
// 调用方统一 `const e = requireAdminOrError(u); if (e) return e;`，错误文案与状态码单点收口
export function requireAdminOrError(user) {
  return user && user.role === 'admin' ? null : error(MSG.ADMIN_ONLY, 403);
}

// ============================================================
// 危险操作二次认证咽喉（注销账户 / 撤销合同等不可逆操作执行前统一过此关）
// 网安报告 F-05：原「OTP 恒通过」改为真实二次认证——前端危险操作弹窗收集当前密码，
// POST /api/auth/re-auth 校验后签发一次性 capToken（5 分钟、每用户仅一枚、命中即删），
// 危险接口凭 capToken 放行。密码错绝不返 401（前端 api() 对 401 自动弹登录页踢用户），统一 403
// ============================================================
const CAPS = new Map(); // userId → { token, exp }（内存 Map：单枚、短寿、无持久价值）
const CAP_TTL = 5 * 60 * 1000;
export function issueCapToken(userId) {
  const now = Date.now();
  for (const [uid, c] of CAPS) if (c.exp < now) CAPS.delete(uid); // 惰性清过期，Map 不膨胀
  const t = bufToHex(crypto.getRandomValues(new Uint8Array(16)));
  CAPS.set(userId, { token: t, exp: now + CAP_TTL });
  return t;
}
export async function confirmDangerOtp(db, userId, body) {
  void db;
  const c = CAPS.get(userId);
  if (!c) return false;
  const got = String((body && body.capToken) || '');
  CAPS.delete(userId); // 一次性：无论校验成败皆失效
  return c.exp >= Date.now() && got === c.token;
}

// 令牌摘要化（网安报告 F-04）：auth_sessions 只存 SHA-256(token)，令牌明文永不落库。
// 登录/注册签发仍回传明文令牌供请求头使用，库内仅存哈希可比对
export async function tokenDigest(token) {
  return bufToHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
}

// 登录 / 注册签发令牌：48 位随机 hex（熵足够，无需 JWT 的无状态代价）。
// 多端会话：每次登录写一行 auth_sessions（旧设备不被顶下线，账户设置可逐端退登）；
// 签发前先清该用户过期会话，会话表天然不膨胀。
// session_id：独立随机 id，对外设备管理唯一标识——token 只在请求头流动，永不进响应体（网安报告 F-04）
// 库内只存 token_hash（网安报告 F-04：DB 泄露/备份不含令牌明文，无法重放登录）
export async function issueAuthToken(db, userId, label) {
  const token = bufToHex(crypto.getRandomValues(new Uint8Array(24)));
  const sessionId = bufToHex(crypto.getRandomValues(new Uint8Array(16)));
  const expires = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  await dbRun(db, `DELETE FROM auth_sessions WHERE user_id=? AND expires_at < datetime('now','localtime')`, [userId]);
  await dbRun(db, 'INSERT INTO auth_sessions (token_hash, session_id, user_id, label, expires_at) VALUES (?,?,?,?,?)',
    [await tokenDigest(token), sessionId, userId, label || '', expires]);
  return token;
}

// 登录设备识别：由 User-Agent 生成可读标签（「Windows · Chrome」/「iPhone · Safari」），供账户设置展示
export function deviceLabelFromUA(ua) {
  const s = String(ua || '');
  let os = '未知设备';
  if (/iPad/i.test(s)) os = 'iPad';
  else if (/iPhone/i.test(s)) os = 'iPhone';
  else if (/Android/i.test(s)) os = 'Android';
  else if (/Windows/i.test(s)) os = 'Windows';
  else if (/Mac OS X|Macintosh/i.test(s)) os = 'macOS';
  else if (/Linux/i.test(s)) os = 'Linux';
  let br = '浏览器';
  if (/Edg\//i.test(s)) br = 'Edge';
  else if (/Firefox\//i.test(s)) br = 'Firefox';
  else if (/Chrome\//i.test(s)) br = 'Chrome';
  else if (/Safari\//i.test(s)) br = 'Safari';
  return `${os} · ${br}`;
}

// 会话数据层：列出用户全部会话（新→旧，current 标记由调用方据当前 token 计算传入）。
// 绝不返回 token/session_id 之外的认证信息；token 仅作 current 判定用，不随响应下发（网安报告 F-04）
export async function listSessions(db, userId) {
  return await dbAll(db, 'SELECT session_id, label, created_at, expires_at FROM auth_sessions WHERE user_id=? ORDER BY created_at DESC', [userId]);
}
export async function revokeSession(db, userId, sessionId) {
  const r = await dbRun(db, 'DELETE FROM auth_sessions WHERE user_id=? AND session_id=?', [userId, sessionId]);
  return !!(r && r.meta && r.meta.changes > 0);
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
