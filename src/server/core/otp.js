/**
 * 验证码咽喉 —— 手机号/邮箱验证码请求与校验 单点
 *
 * 用户需求（2026-08-10）：公测以手机号为唯一账户凭证，内测把手机号做成基于用户名的增量凭证。
 * 要求：做好全套「请求验证码 → 上传校验」通路；模块符合生产接口且轻易插拔。
 * v1.4.12：接入 spug.cc 短信真实通道（sms），删除内测 mock 短路与 fail-open 回落——
 * 发送失败一律作废验证码返回 500（fail-closed，绝不再静默出假码）。
 *
 * 成熟方案口径（调研结论）：
 *   - 频控（60s 重发 + 单日上限）必须服务端强制（原子条件 INSERT 赢家模式，跨实例 D1 生效），
 *     前端倒计时只是表象；
 *   - 验证码一次性消费（命中即置 used，防重放并发双消费）；
 *   - TTL 5 分钟（expires_at，库内 UTC、SQL 层 UTC 参数比较）；
 *   - 验证码与目标均哈希存储（code_hash / target_hash，SHA-256 同 tokenDigest，不落明文）。
 *
 * 部署配置（经 secrets 网关读取，模板编码即调用凭证，禁止进前端/公开仓库）：
 *   SMS_OTP_TEMPLATE_CODE   → push.spug.cc 短信模板编码（POST /sms/<编码>，表单 {to,code,number}）
 *   EMAIL_OTP_TEMPLATE_CODE → push.spug.cc 邮件模板编码（POST /mail/<编码>，表单 {to,scene,code,minute}）
 *   模板编码未配置 → 抛错 fail-closed（宁可发码失败也不回落短路）。
 *   OTP_VERIFIER='local' → 验证码由本应用侧哈希比对校验（内测=「模拟校验模块」，这是校验的
 *                        唯一正解——验证码本就是我们生成的）；未来若验证码托管给服务商
 *                        （服务商存 code），可切 'provider' 接服务商校验 API。
 */
import { dbGet, dbRun, dbAll, error, errorMsg, toDbTime } from './util.js';
import { tokenDigest } from './crypto.js';
import { MSG } from '../../shared/codes.js';
import { LIMITS, CONFIG } from '../../shared/config.js';
import { getSecret } from '../../../server/secrets.js'; // SMS/EMAIL_OTP_TEMPLATE_CODE 部署级配置经网关读取（只读 env，fail-closed 零仓库明文）

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
// 手机号地区表单源在 src/shared/config.js CONFIG.PHONE_REGIONS（前端 src/client/features/auth/actions-otp.js 与本模块双端 import 直读，杜绝双源漂移）。
// 当前收敛大陆单区（仅 +86）：前缀选项已连根移除，parsePhone 只认大陆号；接入国际短信时再加回。
const PHONE_REGIONS = CONFIG.PHONE_REGIONS || [];

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
  const key = channel === 'sms' ? 'PHONE_INVALID' : 'EMAIL_INVALID';
  if (!t || t.length > (channel === 'sms' ? LIMITS.PHONE_MAX : LIMITS.EMAIL_MAX)) {
    return { ok: false, msg: MSG[key], key };
  }
  if (channel === 'sms') return parsePhone(t) ? { ok: true } : { ok: false, msg: MSG[key], key };
  return EMAIL_RE.test(t) ? { ok: true } : { ok: false, msg: MSG[key], key };
}

// ============================================================
// 部署级配置（经 secrets 网关读取；测试经 test/_otp-stub.js stub fetch 防真实发信）：
//   SMS_OTP_TEMPLATE_CODE   → push.spug.cc 短信模板编码（调用凭证，禁进前端/公开仓库）
//   EMAIL_OTP_TEMPLATE_CODE → push.spug.cc 邮件模板编码（调用凭证）
//   模板编码未配置 → deliverOtp 抛错（fail-closed：宁可发码失败也不静默短路出假码）。
//   OTP_VERIFIER='local' → 验证码由本应用侧哈希比对校验（验证码本就由我们生成，唯一正解）；
//                        未来若验证码托管给服务商（服务商存 code），可切 'provider' 接服务商校验 API。
const OTP_VERIFIER = 'local';

// OTP 部署级配置经 env 绑定（bindOtpEnv，由 initDb 调用）后惰性读取——
// 只读 env（Worker Secrets / .dev.vars / 测试注入），无该键 = 空串，deliverOtp fail-closed。
let OTP_ENV = null;
export function bindOtpEnv(env) { OTP_ENV = env; }
const smsTemplateCode = () => String(getSecret(OTP_ENV, 'SMS_OTP_TEMPLATE_CODE') || '');
const emailTemplateCode = () => String(getSecret(OTP_ENV, 'EMAIL_OTP_TEMPLATE_CODE') || '');

/**
 * 真实通道投递（push.spug.cc，4s 超时防拖主流程；失败一律抛错，由 requestOtp 走「作废验证码 + 500」）：
 *   sms   → POST /sms/<SMS_OTP_TEMPLATE_CODE>，表单 {to: 裸 11 位号, code, number: 分钟数}
 *           （模板「您的验证码是${code}，${number}分钟内有效，如非本人操作请忽略。」）
 *   email → POST /mail/<EMAIL_OTP_TEMPLATE_CODE>，表单 {to, scene, code, minute: 分钟数}
 * 200 仅表示「发送请求已受理」，投递异步——request_id 落留档备查；响应码非 200 / 异常 / 超时均抛错。
 */
async function deliverOtp({ channel, target, code, scene }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000); // 外部调用 4s 超时，不让短信/邮件接口拖住注册/登录主流程
  try {
    const minute = String(LIMITS.OTP_CODE_TTL_MS / 60000); // 有效时长分钟数（模板 ${number}/${minute} 占位）
    let url, params;
    if (channel === 'sms') {
      const key = smsTemplateCode();
      if (!key) throw new Error('SMS_OTP_TEMPLATE_CODE 未配置（短信通道 fail-closed）');
      const p = parsePhone(target);
      url = `https://push.spug.cc/sms/${key}`;
      params = { to: (p && p.number) || target, code, number: minute }; // to 需 11 位裸号（模板口径）
    } else {
      const key = emailTemplateCode();
      if (!key) throw new Error('EMAIL_OTP_TEMPLATE_CODE 未配置（邮件通道 fail-closed）');
      url = `https://push.spug.cc/mail/${key}`;
      params = { to: target, scene, code, minute };
    }
    // 平台接口只认表单（Content-Type: application/json 会被拒「无效的数据格式」，实测）；
    // 无 Content-Type + URLSearchParams 即表单模式（fetch 自动补 x-www-form-urlencoded）。
    const res = await fetch(url, {
      method: 'POST',
      body: new URLSearchParams(params),
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status !== 200 || data.code !== 200) {
      // HTTP 200 仅表示受理，业务 code 才是真实结果（生产实证：spug 未实名认证时 HTTP 200 + code!=200）
      const err = new Error(`OTP ${channel} 通道拒绝：HTTP ${res.status} ${data.msg || ''}`);
      err.code = 'OTP_CHANNEL_REJECT'; // 业务拒绝：data.msg 为服务商操作提示（如未实名认证），可透传用户自助
      err.spugMsg = data.msg || '';
      throw err;
    }
    return { requestId: data.request_id || '' };
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================
// 请求验证码
// ============================================================
/**
 * 请求验证码（60s 原子限频 + 单日上限，跨实例 D1 生效）。
 * @returns {Promise<{ok:boolean, err?:Response}>}
 *   ok=true  已受理（真实通道投递，绝不返回验证码明文）；
 *   ok=false 时 err 为 429/400/500 响应（500 = 投递失败已作废本次验证码，用户可重试）。
 */
export async function requestOtp(db, { channel, target, scene }, req) {
  const ch = channel === 'email' ? 'email' : 'sms';
  const v = validateOtpTarget(ch, target);
  if (!v.ok) return { ok: false, err: errorMsg(v.key) };
  const t = String(target).trim();
  const [targetHash, code] = await Promise.all([tokenDigest(t), genOtpCode()]); // 六位数字明文验证码（本地变量，绝不进留档）
  const codeHash = await tokenDigest(String(code));
  const expires = toDbTime(new Date(Date.now() + LIMITS.OTP_CODE_TTL_MS));

  // 原子限频（赢家模式）：60s 内已发 → 条件 INSERT 不命中（changes=0）拒绝。
  // 时间域纪律：created_at/expires_at 库内 UTC，SQL 层比较必须用 UTC
  // （datetime('now') 即 UTC；datetime('now','localtime') 是库内本地时区，与 UTC 存储域比较
  // 在中国时区恒判命中/过期——verifyOtp 早已 UTC 参数比较，此处一并对齐）。
  // 限频 INSERT 前必须先清该目标过期行（防 verification_codes 膨胀）。
  const nowUtc = toDbTime(new Date());
  // Z-2-F1：单日上限独立计数走 rate_limits 桶——verification_codes 行仅 5 分钟 TTL，
  // DELETE 清过期行会抹掉历史，原 INSERT 内嵌的日计数子查询只看得到近 5 分钟行，
  // OTP_DAILY_MAX 恒不可达（短信轰炸第二道闸失效）。rate_limits reset_at 为 localtime 域，
  // upsert/比较统一 localtime（与 security.js RATE_UPSERT_SQL 同口径，过期行由限流兜底清理）。
  // 语义 =「成功投递次数」：预读桶 n（过滤 reset_at，过期桶视为无桶、upsert 自然重置——
  // 复审修：此前不过滤致过期桶再锁 24h），通过后才 INSERT；计数 +1 在 deliverOtp 成功之后
  //（复审修：此前 INSERT 后就 upsert，投递失败烧日配额）。60s 窗口拒绝的请求不计数。
  const dayKey = `otp:${ch}:${targetHash}`; // 函数级提升：try 块（预读）与投递成功分支（upsert）共用
  try {
    const dayRow = await dbGet(db, "SELECT n FROM rate_limits WHERE bucket=? AND reset_at > datetime('now','localtime')", [dayKey]);
    if (dayRow && dayRow.n >= LIMITS.OTP_DAILY_MAX) {
      await logEvent(db, { action: 'otp.request.rate', actorUsername: targetMask(t),
        entity: 'otp', detail: { channel: ch, reason: 'daily_limit' }, req });
      return { ok: false, err: errorMsg('OTP_DAILY_LIMIT', 429) };
    }
    // 清理过期行（防 verification_codes 膨胀）
    await dbRun(db, 'DELETE FROM verification_codes WHERE channel=? AND target_hash=? AND expires_at < ?',
      [ch, targetHash, nowUtc]);
    const r = await dbRun(db, `INSERT INTO verification_codes (channel, target_hash, code_hash, expires_at, created_at)
      SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (
        SELECT 1 FROM verification_codes
        WHERE channel=? AND target_hash=? AND used=0 AND created_at > datetime('now', ?))
      `, [ch, targetHash, codeHash, expires, nowUtc,
          ch, targetHash, '-' + Math.round(LIMITS.OTP_RESEND_WINDOW_MS / 1000) + ' seconds']);
    if (!(r && r.meta && r.meta.changes > 0)) {
      await logEvent(db, { action: 'otp.request.rate', actorUsername: targetMask(t),
        entity: 'otp', detail: { channel: ch, reason: 'resend_window' }, req });
      return { ok: false, err: errorMsg('OTP_RESEND_LIMIT', 429) };
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
    return { ok: false, err: errorMsg('SERVER_ERROR', 500) }; // D1 异常保守拒绝（不 fail-open 出假验证码）
  }

  // 投递失败（fail-closed 生产路径）：作废刚写入的验证码行（码没送达，留着只会被猜到/过期），
  // 返回 500 让用户重试；失败留档（detail 只含通道/原因摘要，验证码绝不进留档）
  let delivered;
  try {
    delivered = await deliverOtp({ channel: ch, target: t, code, scene: scene || (ch === 'email' ? '登录验证' : '身份验证') });
  } catch (e) {
    // AbortError = 4s 超时，映射为可读留档文案；其余为通道拒绝/网络异常原始摘要（不含验证码）
    const reason = (e && e.name === 'AbortError')
      ? '发送超时（4s 未响应）'
      : String((e && e.message) || e).slice(0, 200);
    await logEvent(db, { action: 'otp.send.fail', actorUsername: targetMask(t),
      entity: 'otp', detail: { channel: ch, reason }, req });
    console.warn('OTP 投递失败（已作废本次验证码）:', reason);
    await dbRun(db, 'DELETE FROM verification_codes WHERE channel=? AND target_hash=? AND code_hash=? AND used=0',
      [ch, targetHash, codeHash]);
    // 通道业务拒绝（服务商操作提示，如未实名认证/余额不足）→ 透传用户自助，替代笼统「服务器内部错误」；
    // 网络/超时/配置类失败无用户可操作信息 → 保持 SERVER_ERROR
    if (e && e.code === 'OTP_CHANNEL_REJECT' && e.spugMsg) {
      return { ok: false, err: error(`${MSG.OTP_SEND_FAILED_PREFIX}${e.spugMsg}`, 500, 'OTP_CHANNEL_REJECT') };
    }
    return { ok: false, err: errorMsg('SERVER_ERROR', 500) };
  }
  // Z-2-F1 复审修（缺陷 B）：单日计数 +1 在投递成功之后——投递失败删行返回 500 不烧日配额
  // Q-2b-F2: upsert/logEvent 包 try/catch——验证码已真实送达，后续 D1 记账/留档瞬时故障不得返 500
  // （假失败真送达：用户收到码但客户端视为失败，配额已烧 + 60s 窗口被占）。记账失败仅告警，已送达即成功。
  try {
    await dbRun(db, `INSERT INTO rate_limits (bucket, n, reset_at) VALUES (?, 1, datetime('now','localtime','+1 day'))
      ON CONFLICT(bucket) DO UPDATE SET
        n = CASE WHEN rate_limits.reset_at > datetime('now','localtime') THEN rate_limits.n + 1 ELSE 1 END,
        reset_at = CASE WHEN rate_limits.reset_at > datetime('now','localtime') THEN rate_limits.reset_at ELSE excluded.reset_at END`,
      [dayKey]);
    await logEvent(db, { action: 'otp.request', actorUsername: targetMask(t),
      entity: 'otp', detail: { channel: ch, requestId: delivered.requestId || '' }, req }); // request_id 落留档（查询投递状态用）
  } catch (e) {
    console.warn('OTP 已送达但记账/留档失败（不返 500）:', e && e.message);
  }
  return { ok: true };
}

// ============================================================
// 校验验证码（一次性消费 + TTL + 哈希比对）
// ============================================================
/**
 * 校验验证码；命中即消费（置 used=1，赢家模式防并发双消费）。
 * @returns {Promise<'ok'|'invalid'|'exhausted'>}
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
    // 输错：原子自增计数（并发 N 个错误请求各读旧值再绝对写会把三振折叠——必须 SQL 内 +1）；
    // 达到 3 次即作废（置 used）——之后必然「未找到/已用」回落 invalid 文案，前端三振后主动提示重新发码
    const bump = await dbRun(db,
      `UPDATE verification_codes SET attempts=attempts+1,
         used=CASE WHEN attempts+1 >= ? THEN 1 ELSE 0 END
       WHERE id=? AND used=0`, [LIMITS.OTP_MAX_ATTEMPTS, row.id]);
    if (!(bump && bump.meta && bump.meta.changes > 0)) return 'invalid';
    const after = await dbGet(db, 'SELECT attempts, used FROM verification_codes WHERE id=?', [row.id]);
    return (after && after.used) ? 'exhausted' : 'invalid';
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
