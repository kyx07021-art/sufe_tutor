/**
 * 二次身份验证（C5 / ）：POST /api/auth/verify —— 已登录用户执行敏感操作前的一次性身份复核。
 * 三选二 UI 由前端呈现（手机验证码 / 邮箱验证码 / 密码），服务端只校验用户提交的 ONE 凭证
 * （OTP 为默认分支：手机号优先、邮箱兜底；无绑通道剔除），通过后签发一次性 capToken。
 * capToken 语义复用 danger-ops.issueCapToken（与 re-auth 同款，D1 持久化跨实例）。
 *
 * AK-A1b：拼图为 client-side anti-abuse UX 门禁（前端本地判定，captchaVerified/captchaId
 * 仅为关联 id 被忽略的额外字段），真实防线 = 服务端凭证（OTP/密码）+ 下方 authRateBatch 限流。
 */
import { json, errorMsg } from '../../core/util.js';
import { verifyPassword } from '../../core/crypto.js';
import { authRateBatch, authRateBlock, requireUser } from '../../core/security.js';
import { dbGetMyCreds } from '../../core/credential.js';
import { verifyOtp, targetMask } from '../../core/otp.js';
import { issueCapToken } from '../../core/danger-ops.js';
import { logEvent } from '../../core/log.js';
import { LIMITS } from '../../../shared/config.js';
import { dbUserLookupStmt } from './repo.js';

export async function handleVerifyIdentity(db, body, req) {
  const { user: me, err } = await requireUser(db, req);
  if (err) return err;

  const credential = body.credential || {};
  const type = credential.type === 'password' ? 'password' : 'otp';
  const value = String(credential.value || '').trim();
  if (!value) return errorMsg('VERIFY_FAILED', 403);

  // combined authentication rate limit (8/10min, shared with the re-auth bucket —
  // verify issues the same one-time capToken as re-auth, so both share a per-IP budget). Placed
  // after the empty-value check so a flood of empty requests cannot drain a legitimate user's
  // budget, and before the credential check so every attempted guess counts. Same batch pattern
  // as handleLogin / handleReAuth; a D1 failure propagates to the fetch layer (500) rather than
  // failing open. AK-A1b: this rate limit is the primary anti-bruteforce defense now that the
  // server no longer confirms the client-side captcha.
  const ip = req.headers.get('CF-Connecting-IP') || 'anon';
  const gate = authRateBatch(db, ip, 'reauth', [dbUserLookupStmt(db, me.username)]);
  const results = await db.batch(gate.stmts);
  if (gate.verdict(results)) { await authRateBlock(db, ip); return errorMsg('RATE_LIMITED', 429); }
  const uRow = gate.extra(results)[0];
  const u = uRow && uRow.results ? uRow.results[0] : null;

  if (type === 'password') {
    // Password branch: length cap early-exit (avoid pointless PBKDF2), uniform failure message (no enumeration).
    if (value.length > LIMITS.LOGIN_PASSWORD_MAX) return errorMsg('VERIFY_FAILED', 403);
    if (!u || !(await verifyPassword(value, u.password_hash, u.salt))) {
      await logEvent(db, { action: 'auth.verify.failed', actorUsername: targetMask(me.username),
        entity: 'user', detail: { reason: 'password' }, req });
      return errorMsg('VERIFY_FAILED', 403);
    }
  } else {
    // OTP branch: read the user's bound contact (phone preferred, email fallback); no bound channel is pruned.
    const creds = await dbGetMyCreds(db, me.id);
    const target = creds.phone || creds.email;
    if (!target) {
      await logEvent(db, { action: 'auth.verify.failed', actorUsername: targetMask(me.username),
        entity: 'user', detail: { reason: 'no_otp_channel' }, req });
      return errorMsg('VERIFY_FAILED', 403);
    }
    const channel = creds.phone ? 'sms' : 'email';
    const otpR = await verifyOtp(db, { channel, target, code: value });
    if (otpR !== 'ok') {
      await logEvent(db, { action: 'auth.verify.failed', actorUsername: targetMask(me.username),
        entity: 'user', detail: { reason: otpR, channel }, req });
      return errorMsg('VERIFY_FAILED', 403);
    }
  }

  const capToken = await issueCapToken(db, req);
  // Empty capToken means D1 persist failure: a dead token would make downstream dangerous ops
  // permanently 403 with no observable signal — 500 + warn instead (discipline, mirror re-auth).
  if (!capToken) {
    console.warn('handleVerifyIdentity: issueCapToken 返回空（D1 异常），拒绝下发');
    return errorMsg('SERVER_ERROR', 500);
  }
  await logEvent(db, { action: 'auth.verify.success', actorUserId: me.id, actorUsername: me.username,
    actorRole: me.role, entity: 'user', entityId: me.id, req });
  return json({ verified: true, capToken });
}

const S = (method, path, handler) => ({ method, path, handler });
export const verifyRoutes = [
  S('POST', '/api/auth/verify', c => handleVerifyIdentity(c.db, c.body, c.req)),
];
