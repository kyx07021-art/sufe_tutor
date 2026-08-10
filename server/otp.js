/**
 * 验证码咽喉（v0.26.0 A3）—— 手机号/邮箱验证码请求与校验 单点
 *
 * 用户需求（2026-08-10）：公测以手机号为唯一账户凭证，内测把手机号做成基于用户名的增量凭证。
 * 要求：假装有现成验证码 API，做好全套「请求验证码 → 上传校验」通路；内测期明确注释短路——
 * 请求 API 后调内置随机模块 toast「模拟验证码（内测期使用）」；校验接口也留模拟校验模块；
 * 模块必须符合生产接口且轻易插拔。
 *
 * 成熟方案口径（调研结论，见 docs/0.26-认证与审核架构.md）：
 *   - 频控（60s 重发 + 单日上限）必须服务端强制（原子条件 INSERT 赢家模式，跨实例 D1 生效），
 *     前端倒计时只是表象；
 *   - 验证码一次性消费（命中即置 used，防重放并发双消费）；
 *   - TTL 5 分钟（expires_at，SQL 内 localtime 比较）；
 *   - 验证码与目标均哈希存储（code_hash / target_hash，SHA-256 同 tokenDigest，不落明文）。
 *
 * 插拔点（生产接入真实短信/邮件服务商只改此处，接口签名不变）：
 *   OTP_PROVIDER='mock' → 模拟发送：不真正发短信/邮件，返回 code 供前端 toast
 *                         「模拟验证码（内测期使用）：xxxxxx」；
 *   OTP_PROVIDER='prod' → deliverOtp 内接真实短信/邮件 API（sendSms/sendEmail），不返回 code。
 *   OTP_VERIFIER='local' → 验证码由本应用侧哈希比对校验（内测=「模拟校验模块」，这是校验的
 *                        唯一正解——验证码本就是我们生成的）；未来若验证码托管给服务商
 *                        （服务商存 code），可切 'provider' 接服务商校验 API。
 */
import { dbGet, dbRun, json, error, toDbTime } from './util.js';
import { tokenDigest } from './crypto.js';
import { MSG, LIMITS } from './constants.js';
import '../constants.js'; // 地区前缀表数据单源：globalThis.APP_CONSTANTS.CONFIG.PHONE_REGIONS（与前端同源）
import { logEvent } from './log.js';

// ============================================================
// 建表（幂等；otp 表域自持，db.js initDb 借 init）
// ============================================================
export async function initOtpTable(db) {
  await dbRun(db, `CREATE TABLE IF NOT EXISTS verification_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel TEXT NOT NULL CHECK(channel IN ('sms','email')),
    target_hash TEXT NOT NULL,      -- SHA-256(target)，目标（手机号/邮箱）不落明文
    code_hash TEXT NOT NULL,        -- SHA-256(code)，验证码不落明文
    expires_at DATETIME NOT NULL,   -- TTL（5 分钟，SQL localtime 比较）
    used INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT (datetime('now','localtime')))`);
  await dbRun(db, 'CREATE INDEX IF NOT EXISTS idx_otp_target ON verification_codes(channel, target_hash, created_at)');
}

// ============================================================
// 目标格式校验（地区前缀 + 号码 pattern；邮箱标准正则）
// ============================================================
// 手机号地区表单源在根 constants.js CONFIG.PHONE_REGIONS（前端 app-otp.js 同读，杜绝双源漂移）
export const PHONE_REGIONS = (globalThis.APP_CONSTANTS && globalThis.APP_CONSTANTS.CONFIG && globalThis.APP_CONSTANTS.CONFIG.PHONE_REGIONS) || [];

/** 解析地区前缀：最长前缀优先（+86 前于 +8 之类）；返回 { prefix, number } 或 null */
export function parsePhone(target) {
  const s = String(target || '').trim();
  if (!s) return null;
  for (const r of PHONE_REGIONS) {
    if (s.startsWith(r.prefix)) {
      const number = s.slice(r.prefix.length);
      return r.pattern.test(number) ? { prefix: r.prefix, region: r.name, number } : null;
    }
  }
  return null;
}

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

/** 校验目标格式与长度；返回 { ok } 或 { ok:false, msg } */
export function validateOtpTarget(channel, target) {
  const t = String(target || '').trim();
  if (!t || t.length > (channel === 'sms' ? LIMITS.PHONE_MAX : LIMITS.EMAIL_MAX)) {
    return { ok: false, msg: channel === 'sms' ? MSG.PHONE_INVALID : MSG.EMAIL_INVALID };
  }
  if (channel === 'sms') return parsePhone(t) ? { ok: true } : { ok: false, msg: MSG.PHONE_INVALID };
  return EMAIL_RE.test(t) ? { ok: true } : { ok: false, msg: MSG.EMAIL_INVALID };
}

// ============================================================
// 插拔点
// ============================================================
// 内测期模拟短信/邮件服务商（用户需求：接口短路 + 模拟验证码 toast）。
// 生产接入：OTP_PROVIDER 改 'prod'，deliverOtp 内调真实 sendSms/sendEmail（模板参数 JSON 序列化，
// 防拼接注入），不再返回 code。接口签名（channel/target/code）不变，其余链路原样。
const OTP_PROVIDER = 'mock';
// 校验侧插拔点：'local' = 本应用哈希比对（内测「模拟校验模块」；验证码本就由本应用生成，此为唯一正解）；
// 未来若验证码托管给服务商（服务商侧存 code），切 'provider' 接服务商校验 API，verifyOtp 内分支即可。
const OTP_VERIFIER = 'local';

async function deliverOtp({ channel, target, code }) {
  if (OTP_PROVIDER === 'mock') return { mock: true, code }; // 【短路】模拟发送：返回 code 供前端 toast
  // ---- 生产占位（真实短信/邮件服务商接入点）----
  // const template = channel === 'sms' ? 'sufe_verify' : 'sufe_verify_email';
  // await sendSms(target, { code, template });   // 伪代码：接真实短信 API
  // await sendEmail(target, { code, template }); // 伪代码：接真实邮件 API
  // return { mock: false };
  throw new Error('OTP_PROVIDER=prod 未配置真实短信/邮件通道');
}

// ============================================================
// 请求验证码
// ============================================================
/**
 * 请求验证码（60s 原子限频 + 单日上限，跨实例 D1 生效）。
 * @returns {Promise<{ok:boolean, code?:string, err?:Response}>}
 *   ok=true 且 OTP_PROVIDER=mock 时 code=模拟验证码（前端 toast 用，绝不进留档）；
 *   ok=false 时 err 为 429/400 响应。
 */
export async function requestOtp(db, { channel, target }, req) {
  const ch = channel === 'email' ? 'email' : 'sms';
  const v = validateOtpTarget(ch, target);
  if (!v.ok) return { ok: false, err: error(v.msg) };
  const t = String(target).trim();
  const [targetHash, code] = await Promise.all([tokenDigest(t), genOtpCode()]);
  const codeHash = await tokenDigest(String(code));
  const expires = toDbTime(new Date(Date.now() + LIMITS.OTP_CODE_TTL_MS));

  // 原子限频（赢家模式）：60s 内已发 / 单日超限 → 条件 INSERT 不命中（changes=0）拒绝。
  // 同时清该目标过期行（防 verification_codes 膨胀；与 rate_limits 的过期清理互补）。
  try {
    const r = await dbRun(db, `INSERT INTO verification_codes (channel, target_hash, code_hash, expires_at)
      SELECT ?, ?, ?, ? WHERE NOT EXISTS (
        SELECT 1 FROM verification_codes
        WHERE channel=? AND target_hash=? AND created_at > datetime('now','localtime', ?))
        AND (SELECT COUNT(*) FROM verification_codes
          WHERE channel=? AND target_hash=? AND created_at > datetime('now','localtime', ?)) < ?
      `, [ch, targetHash, codeHash, expires,
          ch, targetHash, '-' + Math.round(LIMITS.OTP_RESEND_WINDOW_MS / 1000) + ' seconds',
          ch, targetHash, '-1 day', LIMITS.OTP_DAILY_MAX]);
    if (!(r && r.meta && r.meta.changes > 0)) {
      await logEvent(db, { action: 'otp.request.rate', actorUsername: targetMask(t),
        entity: 'otp', detail: { channel: ch, reason: 'resend_window_or_daily_limit' }, req });
      // 区分 60s 窗口与单日上限的文案（60s 更常见）
      const recent = await dbGet(db, 'SELECT 1 AS x FROM verification_codes WHERE channel=? AND target_hash=? AND created_at > datetime(\'now\',\'localtime\', ?)',
        [ch, targetHash, '-' + Math.round(LIMITS.OTP_RESEND_WINDOW_MS / 1000) + ' seconds']);
      return { ok: false, err: error(recent ? MSG.OTP_RESEND_LIMIT : MSG.OTP_DAILY_LIMIT, 429) };
    }
  } catch (e) {
    return { ok: false, err: error(MSG.SERVER_ERROR, 500) }; // D1 异常保守拒绝（不 fail-open 出假验证码）
  }

  const delivered = await deliverOtp({ channel: ch, target: t, code });
  await logEvent(db, { action: 'otp.request', actorUsername: targetMask(t),
    entity: 'otp', detail: { channel: ch, provider: OTP_PROVIDER }, req });
  return { ok: true, code: delivered.mock ? delivered.code : undefined };
}

// ============================================================
// 校验验证码（一次性消费 + TTL + 哈希比对）
// ============================================================
/**
 * 校验验证码；命中即消费（置 used=1，赢家模式防并发双消费）。
 * @returns {Promise<boolean>}
 */
export async function verifyOtp(db, { channel, target, code }) {
  const ch = channel === 'email' ? 'email' : 'sms';
  const v = validateOtpTarget(ch, target);
  if (!v.ok || !String(code || '')) return false;
  const t = String(target).trim();
  const targetHash = await tokenDigest(t);
  // 时间戳纪律：expires_at 由 toDbTime 落 UTC，SQL 层比较必须传 UTC 参数（datetime('now','localtime')
  // 是库内本地时区，与 UTC 存储域比较会恒判过期/永不过期——中国时区实测踩坑）
  const nowUtc = toDbTime(new Date());
  const row = await dbGet(db, `SELECT id, code_hash FROM verification_codes
    WHERE channel=? AND target_hash=? AND used=0 AND expires_at > ?
    ORDER BY id DESC LIMIT 1`, [ch, targetHash, nowUtc]);
  if (!row) return false; // 未找到 / 已过期 / 已用
  const codeHash = await tokenDigest(String(code).trim());
  if (row.code_hash !== codeHash) return false;
  // 一次性消费（赢家）：并发双提交仅 changes>0 的一方通过
  const r = await dbRun(db, 'UPDATE verification_codes SET used=1 WHERE id=? AND used=0', [row.id]);
  if (!(r && r.meta && r.meta.changes > 0)) return false;
  if (OTP_VERIFIER === 'provider') {
    // 生产占位：验证码托管给服务商时，改走服务商校验 API（verifyOtp 内分支，接口签名不变）
    // return await providerVerifyOtp({ channel: ch, target: t, code });
  }
  return true;
}

// ============================================================
// 内部
// ============================================================
async function genOtpCode() {
  const b = new Uint8Array(4);
  crypto.getRandomValues(b);
  const n = LIMITS.OTP_CODE_MIN + (b[0] * 65536 + b[1] * 256 + b[2]) % (LIMITS.OTP_CODE_MAX - LIMITS.OTP_CODE_MIN + 1);
  return String(n);
}

/** 目标脱敏（留档用：手机号留尾号、邮箱留域名前 3 字）——验证码绝不进留档 */
export function targetMask(target) {
  const s = String(target || '');
  if (s.startsWith('+')) return s.slice(0, 3) + '***' + s.slice(-4);
  const at = s.indexOf('@');
  if (at > 0) return s.slice(0, Math.min(3, at)) + '***' + s.slice(at);
  return s.slice(0, 3) + '***';
}

// ============================================================
// 登录识别（A7：五合一登录的唯一输入框初判格式）——username/phone/email 分类 + 归一化
// ============================================================
// 裸中国手机号（无 +86 前缀）也按手机识别：11 位、1[3-9] 开头
const CN_MOBILE = /^1[3-9]\d{9}$/;
export const CN_MOBILE_RE = CN_MOBILE;

/**
 * 初判 identifier 类别：'email'（含 @）| 'phone'（带区号前缀或裸中国手机号）| 'username' | null
 */
export function classifyIdentifier(identifier) {
  const s = String(identifier || '').trim();
  if (!s) return null;
  if (s.includes('@')) return 'email';
  if (parsePhone(s) || CN_MOBILE.test(s)) return 'phone';
  return 'username';
}

/**
 * 归一化：裸中国手机号补 +86 前缀（登录/发码统一目标格式）。
 * @returns {{kind:'username'|'phone'|'email'|null, target:string}}
 */
export function normalizeIdentifier(identifier) {
  const kind = classifyIdentifier(identifier);
  const s = String(identifier || '').trim();
  if (kind === 'phone' && CN_MOBILE.test(s)) return { kind, target: '+86' + s };
  return { kind, target: s };
}
