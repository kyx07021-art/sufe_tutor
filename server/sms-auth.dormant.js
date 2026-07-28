/**
 * ============================================================================
 * sms-auth.dormant.js —— 手机号 + 短信验证码 认证模块（休眠中）
 * ============================================================================
 *
 * 【状态说明】
 * 本文件已完整实现，但处于休眠状态：_worker.js 不引用它，没有任何路由指向它，
 * 部署后线上行为零变化。待产品负责人完成短信服务开通（签名 / 模板审核通过）
 * 后，按 docs/sms-plan.md 的激活清单操作即可上线。
 *
 * 【激活摘要】（详见 docs/sms-plan.md）
 *   1. 阿里云或腾讯云开通短信服务，申请签名与验证码模板，等审核通过；
 *   2. 密钥写入 Cloudflare Pages Secrets（变量名见下方清单）；
 *   3. 在 _worker.js 主路由展开 activateRoutes(env)，并调用 initSmsAuth(db) 幂等建表；
 *   4. 先以 SMS_PROVIDER=mock 走通联调，再切换 aliyun / tencent 真实发送。
 *
 * 【所需环境变量清单】
 *   SMS_PROVIDER            'mock' | 'aliyun' | 'tencent'，缺省按 mock 处理
 *   SMS_ACCESS_KEY_ID       阿里云 AccessKeyId / 腾讯云 SecretId
 *   SMS_ACCESS_KEY_SECRET   阿里云 AccessKeySecret / 腾讯云 SecretKey
 *   SMS_SIGN_NAME           审核通过的签名内容，如「尼采家教」
 *   SMS_TEMPLATE_ID         审核通过的模板编号（阿里云 SMS_xxx / 腾讯云数字 ID）
 *   TENCENT_SMS_SDK_APP_ID  仅腾讯云需要：短信应用的 SdkAppId
 *
 * 【设计约定】
 *   - 业务函数签名与 _worker.js 一致：(db, body) => Response；
 *   - 不 import、不修改任何现有文件；密码学 / 响应辅助是 _worker.js 同名实现
 *     的本地副本（PBKDF2 参数对齐，与存量账号密码哈希格式互通）；
 *   - 验证码永不明文落库（哈希 + 独立盐，5 分钟有效，错 5 次作废），
 *     同号 60 秒冷却 + 每日上限 SMS_DAILY_LIMIT 条。
 */

// ============================================================
// 业务常量
// ============================================================
const CODE_LENGTH = 6;                // 验证码位数
const CODE_TTL_SECONDS = 5 * 60;      // 验证码有效期（秒）
const RESEND_INTERVAL_SECONDS = 60;   // 同号重发冷却（秒）
const SMS_DAILY_LIMIT = 10;           // 单号码每日发送上限
const MAX_VERIFY_ATTEMPTS = 5;        // 单条验证码允许的最大输错次数
const PHONE_RE = /^1[3-9]\d{9}$/;     // 大陆手机号；国际号码支持与否见 docs/sms-plan.md 开放问题

// ============================================================
// 错误消息常量（风格同 _worker.js 的 MSG）
// ============================================================
const SMS_MSG = {
  INVALID_PHONE: '手机号格式不正确',
  CODE_TOO_FAST: '发送过于频繁，请 60 秒后再试',
  CODE_DAILY_LIMIT: '已超过今日发送上限，请明天再试',
  CODE_SENT: '验证码已发送',
  CODE_REQUIRED: '请输入验证码',
  CODE_NOT_FOUND: '验证码不存在或已过期',
  CODE_WRONG: '验证码不正确',
  CODE_LOCKED: '错误次数过多，该验证码已作废，请重新获取',
  PASSWORD_LENGTH: '密码长度至少 6 个字符',
  INVALID_ROLE: '无效的用户角色',
  PHONE_TAKEN: '该手机号已被注册',
  PHONE_NOT_REGISTERED: '该手机号未注册，请先注册',
  TEACHER_NEEDS_INVITE: '教师注册需要邀请码',
  INVITE_INVALID: '邀请码无效或已过期',
  REGISTER_SUCCESS: '注册成功',
  LOGIN_REQUIRED: '请输入账号和密码',
  LOGIN_FAILED: '账号或密码错误',
  ACCOUNT_BANNED: '该账户已被封禁，禁止登录',
  TRANSPORT_FAILED: '短信发送失败，请稍后重试',
  SERVER_ERROR: '服务器内部错误',
};

// ============================================================
// 迁移 SQL（D1 / SQLite 方言）
// 全部 CREATE TABLE IF NOT EXISTS，initSmsAuth(db) 幂等可重复执行。
// ============================================================

// users_phone：手机号与 users 的 1:1 绑定。phone 直接做 PRIMARY KEY，从 schema
// 层面确立「手机号 = 未来唯一账号 ID」；user_id UNIQUE 保证一号一户、迁移路径单值。
const SQL_USERS_PHONE = `CREATE TABLE IF NOT EXISTS users_phone (
  phone TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE,
  verified_at DATETIME DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`;

// sms_codes：发放与校验记录。只存 code_hash + salt，明文绝不落库，
// DB 管理员也读不到码；created_at 支撑频控 / 日上限，attempts 支撑输错锁定。
const SQL_SMS_CODES = `CREATE TABLE IF NOT EXISTS sms_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  expires_at DATETIME NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT (datetime('now','localtime')))`;

async function initSmsAuth(db) {
  await db.batch([db.prepare(SQL_USERS_PHONE), db.prepare(SQL_SMS_CODES)]);
}

// DB 辅助函数（_worker.js 同名实现的副本，因其未导出）
async function dbGet(db, sql, params = []) {
  return await db.prepare(sql).bind(...params).first();
}

async function dbRun(db, sql, params = []) {
  return await db.prepare(sql).bind(...params).run();
}

// ============================================================
// 密码学 —— _worker.js 中 hashPassword/verifyPassword 的本地副本（原文件未导出）。
// 参数对齐：PBKDF2 + SHA-512 + 10 万次迭代 + 512bit，手机号用户与存量用户哈希格式互通。
// 验证码是「短命密码」，同样复用 hashPassword 做哈希存储。
// ============================================================
function bufToHex(buf) {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password, existingSalt) {
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

async function verifyPassword(password, storedHash, salt) {
  const { hash } = await hashPassword(password, salt);
  return hash === storedHash;
}

// ============================================================
// 响应辅助（与 _worker.js 的 json/error 形状一致）
// ============================================================
function json(data, status = 200) {
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

function error(msg, status = 400) { return json({ error: msg }, status); }

// 6 位纯数字验证码：crypto.getRandomValues 随机 + 模 10 映射（偏差可忽略，风格对齐 genCode）
function genSmsCode() {
  const arr = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(arr);
  return Array.from(arr, v => String(v % 10)).join('');
}

// ============================================================
// CodeTransport 抽象 —— 统一契约 send(phone, code) => Promise<{ok, detail}>，
// 激活时由 createTransport(env) 按 env.SMS_PROVIDER 选择实现。
// ============================================================

// 本地测试实现：不真实发短信，把验证码写进返回值与日志，供 mock 模式端到端联调。
class MockTransport {
  constructor() { this.name = 'mock'; }
  async send(phone, code) {
    console.log(`[MockTransport] 模拟发送短信 -> ${phone}, code=${code}`);
    return { ok: true, detail: { mock: true, code } };
  }
}

// 阿里云短信桩。官方文档：https://help.aliyun.com/zh/sms/
class AliyunSmsTransport {
  constructor({ accessKeyId, accessKeySecret, signName, templateId }) {
    Object.assign(this, { accessKeyId, accessKeySecret, signName, templateId });
    this.name = 'aliyun'; // templateId 即 TemplateCode，形如 SMS_123456789
  }

  async send(phone, code) {
    // TODO 激活时实现，官方 API 要点：
    //  1. 接口 Action=SendSms，Version=2017-05-25，接入地址 dysmsapi.aliyuncs.com；
    //  2. 业务参数：PhoneNumbers=phone、SignName=this.signName、
    //     TemplateCode=this.templateId、TemplateParam=JSON.stringify({ code })；
    //  3. RPC 风格签名：全部请求参数（含 SignatureMethod=HMAC-SHA1、
    //     SignatureVersion=1.0、SignatureNonce、UTC Timestamp）排序后拼成
    //     规范化查询串，HMAC-SHA1 计算签名，签名密钥为 accessKeySecret + '&'；
    //  4. 成功判定：响应 JSON 的 Code === 'OK'；常见失败码如
    //     isv.BUSINESS_LIMIT_CONTROL（触发频控）、isv.SMS_SIGNATURE_ILLEGAL。
    return { ok: false, detail: 'aliyun transport 尚未实现，见函数内 TODO' };
  }
}

// 腾讯云短信桩。官方文档：https://cloud.tencent.com/document/product/382
class TencentSmsTransport {
  constructor({ accessKeyId, accessKeySecret, signName, templateId, sdkAppId }) {
    Object.assign(this, { accessKeyId, accessKeySecret, signName, templateId, sdkAppId });
    // accessKeyId / accessKeySecret 即腾讯云 SecretId / SecretKey；sdkAppId 为短信应用 SdkAppId（腾讯云特有）
    this.name = 'tencent';
  }

  async send(phone, code) {
    // TODO 激活时实现，官方 API 要点：
    //  1. POST https://sms.tencentcloudapi.com/，头部 X-TC-Action=SendSms、
    //     X-TC-Version=2021-01-11、X-TC-Timestamp、X-TC-Region；
    //  2. 请求体 JSON：SmsSdkAppId=this.sdkAppId、PhoneNumberSet=['+86'+phone]
    //     （大陆号码必须带 +86 前缀）、SignName=this.signName、
    //     TemplateId=this.templateId、TemplateParamSet=[code]（按模板变量序）；
    //  3. TC3-HMAC-SHA256 签名：构造 CanonicalRequest -> StringToSign，
    //     以 'TC3'+SecretKey 为起点按 Date -> Service('sms') -> 'tc3_request'
    //     逐层 HMAC 派生签名密钥，最终拼 Authorization 头；
    //  4. 成功判定：SendStatusSet[0].Code === 'Ok'。
    return { ok: false, detail: 'tencent transport 尚未实现，见函数内 TODO' };
  }
}

// 按环境变量选择通道。未配置 SMS_PROVIDER 时返回失效通道（发送即失败）——
// 严禁静默回落 mock：mock 会经 HTTP 回带验证码，带病激活 = 任意手机号账号接管。
function createTransport(env) {
  const provider = (env.SMS_PROVIDER || '').toLowerCase();
  if (provider !== 'mock' && provider !== 'aliyun' && provider !== 'tencent') {
    return { name: 'disabled', send: async () => ({ ok: false, detail: 'SMS_PROVIDER 未配置（激活流程见 docs/sms-plan.md）' }) };
  }
  const common = {
    accessKeyId: env.SMS_ACCESS_KEY_ID,
    accessKeySecret: env.SMS_ACCESS_KEY_SECRET,
    signName: env.SMS_SIGN_NAME,
    templateId: env.SMS_TEMPLATE_ID,
  };
  if (provider === 'aliyun') return new AliyunSmsTransport(common);
  if (provider === 'tencent') return new TencentSmsTransport({ ...common, sdkAppId: env.TENCENT_SMS_SDK_APP_ID });
  return new MockTransport();
}

// ============================================================
// 验证码核心逻辑 —— 频控、落库、校验消费
// ============================================================

// 发送前频控：60 秒冷却 + 每日上限，基于 sms_codes 历史。返回 null 放行，否则为错误消息。
async function assertSendAllowed(db, phone) {
  const recent = await dbGet(db,
    "SELECT id FROM sms_codes WHERE phone=? AND created_at > datetime('now','localtime',?)",
    [phone, `-${RESEND_INTERVAL_SECONDS} seconds`]);
  if (recent) return SMS_MSG.CODE_TOO_FAST;

  const today = await dbGet(db,
    "SELECT COUNT(*) AS cnt FROM sms_codes WHERE phone=? AND date(created_at)=date('now','localtime')",
    [phone]);
  if ((today?.cnt || 0) >= SMS_DAILY_LIMIT) return SMS_MSG.CODE_DAILY_LIMIT;
  return null;
}

// 验证码落库：哈希后持久化。expires_at 由数据库端计算，与比较式共用 DB 时钟防漂移。
async function storeCode(db, phone, code) {
  const { hash, salt } = await hashPassword(code);
  await dbRun(db,
    `INSERT INTO sms_codes (phone,code_hash,salt,expires_at)
     VALUES (?,?,?,datetime('now','localtime',?))`,
    [phone, hash, salt, `+${CODE_TTL_SECONDS} seconds`]);
}

// 消费验证码：校验通过置 used=1 返回 null；失败累计 attempts 并返回错误消息，
// 达到 MAX_VERIFY_ATTEMPTS 直接作废该码，防止对 6 位数字码在线爆破。
async function consumeCode(db, phone, code) {
  if (!code) return SMS_MSG.CODE_REQUIRED;

  const row = await dbGet(db,
    `SELECT * FROM sms_codes
     WHERE phone=? AND used=0 AND expires_at > datetime('now','localtime')
     ORDER BY id DESC LIMIT 1`,
    [phone]);
  if (!row) return SMS_MSG.CODE_NOT_FOUND;

  if (row.attempts >= MAX_VERIFY_ATTEMPTS) {
    await dbRun(db, 'UPDATE sms_codes SET used=1 WHERE id=?', [row.id]);
    return SMS_MSG.CODE_LOCKED;
  }

  const ok = await verifyPassword(code, row.code_hash, row.salt);
  if (!ok) {
    const next = row.attempts + 1;
    if (next >= MAX_VERIFY_ATTEMPTS) {
      // 最后一次机会用尽：连用作废，避免「恰好第 5 次」的边界绕过
      await dbRun(db, 'UPDATE sms_codes SET used=1, attempts=? WHERE id=?', [next, row.id]);
      return SMS_MSG.CODE_LOCKED;
    }
    await dbRun(db, 'UPDATE sms_codes SET attempts=? WHERE id=?', [next, row.id]);
    return SMS_MSG.CODE_WRONG;
  }

  await dbRun(db, 'UPDATE sms_codes SET used=1 WHERE id=?', [row.id]);
  return null;
}

// ============================================================
// 业务函数（与 _worker.js 路由处理函数同签名：(db, body) => Response）
// ============================================================

// POST /api/v2/auth/send-code  body: { phone }
// 60 秒频控 + 日上限；6 位数字码；哈希存库；5 分钟有效。transport 由闭包注入。
async function handleSendCode(db, body, transport) {
  const { phone } = body;
  if (!PHONE_RE.test(phone || '')) return error(SMS_MSG.INVALID_PHONE);

  const blocked = await assertSendAllowed(db, phone);
  if (blocked) return error(blocked, 429);

  const code = genSmsCode();
  const result = await transport.send(phone, code);
  if (!result.ok) return error(SMS_MSG.TRANSPORT_FAILED, 502);

  // 发送成功后才落库：通道失败时不留记录，避免失败发送占用频控额度
  await storeCode(db, phone, code);

  const payload = { message: SMS_MSG.CODE_SENT };
  // 仅 mock 通道回带验证码，供本地联调；真实通道绝不回传码
  if (result.detail && result.detail.mock) payload.debugCode = code;
  return json(payload);
}

// POST /api/v2/auth/register  body: { phone, code, password, role, inviteCode? }
// 验证码核销 -> 建 users 行（username 暂取手机号本身，仍满足 UNIQUE NOT NULL）
// -> 写 users_phone 绑定。教师保留邀请码钩子，规则与 _worker.js handleRegister 一致。
async function handleRegisterPhone(db, body) {
  const { phone, code, password, role, inviteCode } = body;
  if (!PHONE_RE.test(phone || '')) return error(SMS_MSG.INVALID_PHONE);
  if (!password || password.length < 6) return error(SMS_MSG.PASSWORD_LENGTH);
  if (!['student', 'teacher'].includes(role)) return error(SMS_MSG.INVALID_ROLE);

  if (await dbGet(db, 'SELECT phone FROM users_phone WHERE phone=?', [phone])) {
    return error(SMS_MSG.PHONE_TAKEN);
  }
  // 防御：存量时代若有人恰好用 11 位数字注册了用户名，避免 UNIQUE 冲突炸成 500
  if (await dbGet(db, 'SELECT id FROM users WHERE username=?', [phone])) {
    return error(SMS_MSG.PHONE_TAKEN);
  }

  // 邀请码钩子位：教师仍走邀请码校验（_worker.js 同名函数未导出，SQL 复刻于此）
  let invite = null;
  if (role === 'teacher') {
    if (!inviteCode) return error(SMS_MSG.TEACHER_NEEDS_INVITE);
    invite = await dbGet(db,
      "SELECT * FROM invite_codes WHERE code=? AND used_by IS NULL AND expires_at > datetime('now','localtime')",
      [inviteCode]);
    if (!invite) return error(SMS_MSG.INVITE_INVALID);
  }

  const codeErr = await consumeCode(db, phone, code);
  if (codeErr) return error(codeErr, 401);

  const { hash, salt } = await hashPassword(password);
  const result = await dbRun(db,
    'INSERT INTO users (username,password_hash,salt,role) VALUES (?,?,?,?)',
    [phone, hash, salt, role]);
  const userId = Number(result.meta.last_row_id);
  await dbRun(db, 'INSERT INTO users_phone (phone,user_id) VALUES (?,?)', [phone, userId]);

  if (invite) {
    await dbRun(db,
      "UPDATE invite_codes SET used_by=?, used_at=datetime('now','localtime') WHERE code=?",
      [userId, inviteCode]);
  }

  return json({
    user: { id: userId, username: phone, role, phone },
    message: SMS_MSG.REGISTER_SUCCESS,
  });
}

// POST /api/v2/auth/login-code  body: { phone, code }
// 先查绑定再核销验证码：未注册号码不消耗尝试次数，直接导向注册流程。
async function handleLoginByCode(db, body) {
  const { phone, code } = body;
  if (!PHONE_RE.test(phone || '')) return error(SMS_MSG.INVALID_PHONE);

  const binding = await dbGet(db,
    `SELECT up.user_id, u.username, u.role, u.banned
     FROM users_phone up JOIN users u ON u.id=up.user_id
     WHERE up.phone=?`,
    [phone]);
  if (!binding) return error(SMS_MSG.PHONE_NOT_REGISTERED, 404);

  const codeErr = await consumeCode(db, phone, code);
  if (codeErr) return error(codeErr, 401);

  if (binding.banned) return error(SMS_MSG.ACCOUNT_BANNED, 403);
  return json({
    user: { id: binding.user_id, username: binding.username, role: binding.role, phone },
  });
}

// POST /api/v2/auth/login-password  body: { account, password }
// account 可为手机号或旧用户名 —— 这是「用户名与手机号登录并存」的落地形态，
// 是否长期保留见 docs/sms-plan.md 开放问题。
async function handleLoginByPassword(db, body) {
  const { account, password } = body;
  if (!account || !password) return error(SMS_MSG.LOGIN_REQUIRED);

  // 形似手机号先按手机号查绑定；查不到再回落按用户名查（兼容老账号）
  let user = null;
  if (PHONE_RE.test(account)) {
    user = await dbGet(db,
      `SELECT u.id, u.username, u.password_hash, u.salt, u.role, u.banned
       FROM users_phone up JOIN users u ON u.id=up.user_id
       WHERE up.phone=?`,
      [account]);
  }
  if (!user) {
    user = await dbGet(db, 'SELECT * FROM users WHERE username=?', [account]);
  }

  if (!user || !(await verifyPassword(password, user.password_hash, user.salt))) {
    return error(SMS_MSG.LOGIN_FAILED, 401);
  }
  if (user.banned) return error(SMS_MSG.ACCOUNT_BANNED, 403);
  return json({ user: { id: user.id, username: user.username, role: user.role } });
}

// ============================================================
// 路由清单 —— 激活的唯一入口。激活时在 _worker.js 主路由 try 块内展开：
//
//   import { activateRoutes, initSmsAuth } from './server/sms-auth.dormant.js';
//   // 首次请求初始化处补一句：await initSmsAuth(env.DB);
//   for (const r of activateRoutes(env)) {
//     if (p === r.path && request.method === r.method) return await r.handler(db, body);
//   }
//
// handler 统一 (db, body) => Response；transport 在此按 env 构造一次，闭包注入。
// ============================================================
export function activateRoutes(env) {
  const transport = createTransport(env || {});
  return [
    { method: 'POST', path: '/api/v2/auth/send-code',      handler: (db, body) => handleSendCode(db, body, transport) },
    { method: 'POST', path: '/api/v2/auth/register',       handler: (db, body) => handleRegisterPhone(db, body) },
    { method: 'POST', path: '/api/v2/auth/login-code',     handler: (db, body) => handleLoginByCode(db, body) },
    { method: 'POST', path: '/api/v2/auth/login-password', handler: (db, body) => handleLoginByPassword(db, body) },
  ];
}

// 导出清单：建表 / 路由 / 消息常量 / transport 类（联调用）/ SQL 常量（迁移脚本复用）
export {
  initSmsAuth,
  SMS_MSG,
  createTransport,
  MockTransport,
  AliyunSmsTransport,
  TencentSmsTransport,
  handleSendCode,
  handleRegisterPhone,
  handleLoginByCode,
  handleLoginByPassword,
  SQL_USERS_PHONE,
  SQL_SMS_CODES,
};
