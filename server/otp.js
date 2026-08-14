/**
 * 验证码咽喉 —— 手机号/邮箱验证码请求与校验 单点
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
 *   - TTL 5 分钟（expires_at，库内 UTC、SQL 层 UTC 参数比较）；
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
import { dbGet, dbRun, dbAll, json, error, toDbTime } from './util.js';
import { tokenDigest } from './crypto.js';
import { MSG, LIMITS } from './constants.js';
import { getSecret } from './secrets.js'; // OTP_PROVIDER 部署级配置经网关读取（env 优先，回落 secrets.js 文件）
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
    expires_at DATETIME NOT NULL,   -- TTL（5 分钟；库内 UTC，SQL 层 UTC 比较）
    used INTEGER NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 0, -- 输错次数（满 3 次即作废，须重新发码）
    created_at DATETIME DEFAULT (datetime('now')))`); // 库内 UTC（与 expires_at 统一域）
  // 存量表补 attempts 列（幂等；新库 DDL 已带）
  const cols = (await dbAll(db, 'PRAGMA table_info(verification_codes)')).map(c => c.name);
  if (!cols.includes('attempts')) {
    await dbRun(db, 'ALTER TABLE verification_codes ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0');
  }
  await dbRun(db, 'CREATE INDEX IF NOT EXISTS idx_otp_target ON verification_codes(channel, target_hash, created_at)');
}

// ============================================================
// 目标格式校验（地区前缀 + 号码 pattern；邮箱标准正则）
// ============================================================
// 手机号地区表单源在根 constants.js CONFIG.PHONE_REGIONS（前端 app-otp.js 同读，杜绝双源漂移）。
// 当前收敛大陆单区（仅 +86）：前缀选项已连根移除，parsePhone 只认大陆号；接入国际短信时再加回。
const PHONE_REGIONS = (globalThis.APP_CONSTANTS && globalThis.APP_CONSTANTS.CONFIG && globalThis.APP_CONSTANTS.CONFIG.PHONE_REGIONS) || [];

/** 解析手机号前缀：遍历 PHONE_REGIONS（大陆单区 = 仅 +86）；返回 { prefix, number } 或 null */
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

/** 校验目标格式与长度；返回 { ok } 或 { ok:false, msg }（模块内使用） */
function validateOtpTarget(channel, target) {
  const t = String(target || '').trim();
  if (!t || t.length > (channel === 'sms' ? LIMITS.PHONE_MAX : LIMITS.EMAIL_MAX)) {
    return { ok: false, msg: channel === 'sms' ? MSG.PHONE_INVALID : MSG.EMAIL_INVALID };
  }
  if (channel === 'sms') return parsePhone(t) ? { ok: true } : { ok: false, msg: MSG.PHONE_INVALID };
  return EMAIL_RE.test(t) ? { ok: true } : { ok: false, msg: MSG.EMAIL_INVALID };
}

// ============================================================
// 插拔点（部署级配置经网关读取）：
//   OTP_PROVIDER='mock' → 模拟发送：不真正发短信/邮件，返回 code 供前端 toast
//                        「模拟验证码（内测期使用）：xxxxxx」——生产接入真实通道后此值必须置 'prod'，
//                        mock 下响应携带明文验证码 = 任意人可免密登录目标账户（内测期有意短路）。
//   OTP_PROVIDER='prod' → deliverOtp 走真实通道：email 调 push.spug.cc 邮件接口
//                        （POST https://push.spug.cc/mail/<TEMPLATE_CODE>，body {to,scene,code,minute}；
//                        200 仅表示受理，request_id 落留档备查）；sms 通道未接入前仍回落 mock。
//   OTP_VERIFIER='local' → 验证码由本应用侧哈希比对校验（验证码本就由我们生成，此为唯一正解）；
//                        未来若验证码托管给服务商（服务商存 code），可切 'provider' 接服务商校验 API。
const OTP_PROVIDER = String(getSecret(null, 'OTP_PROVIDER') || 'mock');
const OTP_VERIFIER = 'local';

// 邮件验证码通道（push.spug.cc）：模板编码即调用凭证（禁止进前端/公开仓库），
// 未配置时该通道回落 mock（内测兼容 fail-open）
const EMAIL_TEMPLATE_CODE = String(getSecret(null, 'EMAIL_OTP_TEMPLATE_CODE') || '');

/**
 * 真实通道投递：email → push.spug.cc 邮件接口（4s 超时防拖主流程；返回 {mock, code?, requestId?}）。
 * 投递失败抛错由 requestOtp 捕获走「不发码」路径；sms 未接入真实通道 → 回落 mock。
 */
async function deliverOtp({ channel, target, code, scene }) {
  if (channel === 'sms' || !EMAIL_TEMPLATE_CODE || OTP_PROVIDER !== 'prod') {
    console.warn('OTP 通道回落 mock：channel=%s 模板配置=%s', channel, EMAIL_TEMPLATE_CODE ? '已配' : '未配');
    return { mock: true, code }; // 【短路】模拟发送：返回 code 供前端 toast
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000); // 外部调用 4s 超时，不让邮件接口拖住注册/登录主流程
  try {
    const res = await fetch(`https://push.spug.cc/mail/${EMAIL_TEMPLATE_CODE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: target, scene, code, minute: '5' }),
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    // 200 仅表示「发送请求已受理」，投递异步——request_id 落留档备查（查询发送状态用）
    if (res.status !== 200 || data.code !== 200) {
      throw new Error(`mail otp rejected: ${res.status} ${JSON.stringify(data)}`);
    }
    return { mock: false, requestId: data.request_id || '' };
  } finally {
    clearTimeout(timer);
  }
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
export async function requestOtp(db, { channel, target, scene }, req) {
  const ch = channel === 'email' ? 'email' : 'sms';
  const v = validateOtpTarget(ch, target);
  if (!v.ok) return { ok: false, err: error(v.msg) };
  const t = String(target).trim();
  const [targetHash, code] = await Promise.all([tokenDigest(t), genOtpCode()]); // 六位数字明文验证码（本地变量，绝不进留档）
  const codeHash = await tokenDigest(String(code));
  const expires = toDbTime(new Date(Date.now() + LIMITS.OTP_CODE_TTL_MS));

  // 原子限频（赢家模式）：60s 内已发 / 单日超限 → 条件 INSERT 不命中（changes=0）拒绝。
  // 时间域纪律：created_at/expires_at 库内 UTC，SQL 层比较必须用 UTC
  // （datetime('now') 即 UTC；datetime('now','localtime') 是库内本地时区，与 UTC 存储域比较
  // 在中国时区恒判命中/过期——verifyOtp 早已 UTC 参数比较，此处一并对齐）。
  // 限频 INSERT 前必须先清该目标过期行（防 verification_codes 膨胀）。
  const nowUtc = toDbTime(new Date());
  try {
    // 清理过期行（防 verification_codes 膨胀）
    await dbRun(db, 'DELETE FROM verification_codes WHERE channel=? AND target_hash=? AND expires_at < ?',
      [ch, targetHash, nowUtc]);
    const r = await dbRun(db, `INSERT INTO verification_codes (channel, target_hash, code_hash, expires_at, created_at)
      SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (
        SELECT 1 FROM verification_codes
        WHERE channel=? AND target_hash=? AND used=0 AND created_at > datetime('now', ?))
        AND (SELECT COUNT(*) FROM verification_codes
          WHERE channel=? AND target_hash=? AND created_at > datetime('now', ?)) < ?
      `, [ch, targetHash, codeHash, expires, nowUtc,
          ch, targetHash, '-' + Math.round(LIMITS.OTP_RESEND_WINDOW_MS / 1000) + ' seconds',
          ch, targetHash, '-1 day', LIMITS.OTP_DAILY_MAX]);
    if (!(r && r.meta && r.meta.changes > 0)) {
      await logEvent(db, { action: 'otp.request.rate', actorUsername: targetMask(t),
        entity: 'otp', detail: { channel: ch, reason: 'resend_window_or_daily_limit' }, req });
      // 区分 60s 窗口与单日上限的文案（60s 更常见）
      const recent = await dbGet(db, 'SELECT 1 AS x FROM verification_codes WHERE channel=? AND target_hash=? AND used=0 AND created_at > datetime(\'now\', ?)',
        [ch, targetHash, '-' + Math.round(LIMITS.OTP_RESEND_WINDOW_MS / 1000) + ' seconds']);
      return { ok: false, err: error(recent ? MSG.OTP_RESEND_LIMIT : MSG.OTP_DAILY_LIMIT, 429) };
    }
    // 契约：同一联系方式发新码后，旧验证码凭证立刻过期销毁——
    // 限频已过（本请求成功插入新码），作废该目标其余未消费行（置 used，行保留供单日计数/审计；
    // 同目标同一时刻至多一枚有效验证码）
    const newId = Number((r && r.meta && r.meta.last_row_id) || 0);
    if (newId) {
      await dbRun(db, 'UPDATE verification_codes SET used=1 WHERE channel=? AND target_hash=? AND used=0 AND id != ?',
        [ch, targetHash, newId]);
    }
  } catch (e) {
    return { ok: false, err: error(MSG.SERVER_ERROR, 500) }; // D1 异常保守拒绝（不 fail-open 出假验证码）
  }

  // 邮件投递失败：作废刚写入的验证码行（码没送达，留着只会被猜到/过期），返回 500 让用户重试
  let delivered;
  try {
    delivered = await deliverOtp({ channel: ch, target: t, code, scene: scene || (ch === 'email' ? '登录验证' : '身份验证') });
  } catch (e) {
    console.warn('OTP 投递失败（已作废本次验证码）:', e && e.message);
    await dbRun(db, 'DELETE FROM verification_codes WHERE channel=? AND target_hash=? AND code_hash=? AND used=0',
      [ch, targetHash, codeHash]);
    return { ok: false, err: error(MSG.SERVER_ERROR, 500) };
  }
  await logEvent(db, { action: 'otp.request', actorUsername: targetMask(t),
    entity: 'otp', detail: { channel: ch, provider: OTP_PROVIDER, requestId: delivered.requestId || '' }, req }); // request_id 落留档（查询投递状态用）
  return { ok: true, code: delivered.mock ? delivered.code : undefined };
}

// ============================================================
// 校验验证码（一次性消费 + TTL + 哈希比对）
// ============================================================
/**
 * 校验验证码；命中即消费（置 used=1，赢家模式防并发双消费）。
 * @returns {Promise<boolean>}
 */
/**
 * 校验验证码（哈希匹配 + 一次性消费 + 三振限次）。
 * 契约（用户需求）：一个验证码只能尝试三次——前两次输错 +1 次计数（码仍有效可重试），
 * 第三次输错即作废该码，必须重新发送；输对即一次性消费（赢家模式防并发双消费）。
 * @returns {Promise<'ok'|'invalid'|'exhausted'>}
 *   ok        校验通过（码已消费，不可再用）
 *   invalid   验证码错误（未达 3 次，可重试；统一文案防枚举）
 *   exhausted 连续输错 3 次，该码已作废——必须重新发送验证码
 */
export async function verifyOtp(db, { channel, target, code }) {
  const ch = channel === 'email' ? 'email' : 'sms';
  const v = validateOtpTarget(ch, target);
  if (!v.ok || !String(code || '')) return 'invalid';
  const t = String(target).trim();
  const targetHash = await tokenDigest(t);
  // 时间戳纪律：expires_at 由 toDbTime 落 UTC，SQL 层比较必须传 UTC 参数
  const nowUtc = toDbTime(new Date());
  const row = await dbGet(db, `SELECT id, code_hash, attempts FROM verification_codes
    WHERE channel=? AND target_hash=? AND used=0 AND expires_at > ?
    ORDER BY id DESC LIMIT 1`, [ch, targetHash, nowUtc]);
  if (!row) return 'invalid'; // 未找到 / 已过期 / 已用（统一文案防枚举）
  const codeHash = await tokenDigest(String(code).trim());
  if (row.code_hash !== codeHash) {
    // 输错：计数 +1；满 3 次即作废（置 used）——第四次起必然「未找到/已用」回落 invalid 文案，
    // 但前端三振后主动提示重新发码
    const newAttempts = Number(row.attempts) + 1;
    if (newAttempts >= LIMITS.OTP_MAX_ATTEMPTS) {
      const kill = await dbRun(db, 'UPDATE verification_codes SET used=1, attempts=? WHERE id=? AND used=0',
        [newAttempts, row.id]);
      return (kill && kill.meta && kill.meta.changes > 0) ? 'exhausted' : 'invalid';
    }
    await dbRun(db, 'UPDATE verification_codes SET attempts=? WHERE id=? AND used=0', [newAttempts, row.id]);
    return 'invalid';
  }
  // 一次性消费（赢家）：并发双提交仅 changes>0 的一方通过
  const r = await dbRun(db, 'UPDATE verification_codes SET used=1 WHERE id=? AND used=0', [row.id]);
  if (!(r && r.meta && r.meta.changes > 0)) return 'invalid';
  if (OTP_VERIFIER === 'provider') {
    // 生产占位：验证码托管给服务商时，改走服务商校验 API（verifyOtp 内分支，接口签名不变）
    // return await providerVerifyOtp({ channel: ch, target: t, code });
  }
  return 'ok';
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
  if (!s) return ''; // 未绑定：空串 → 前端回落「未绑定」占位（B5 修复：原空串被 slice 成 '***'）
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
