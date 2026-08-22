/**
 * 二次身份验证（C5 / I-06）：POST /api/auth/verify —— 已登录用户执行敏感操作前的一次性身份复核。
 * 三选二 UI 由前端呈现（手机验证码 / 邮箱验证码 / 密码），服务端只校验用户提交的 ONE 凭证
 * （OTP 为默认分支：手机号优先、邮箱兜底；无绑通道剔除）+ 拼图人机 flag，通过后签发一次性 capToken。
 * capToken 语义复用 danger-ops.issueCapToken（与 re-auth 同款，D1 持久化跨实例）。
 */
import { json, errorMsg } from '../../core/util.js';
import { verifyPassword } from '../../core/crypto.js';
import { requireUser } from '../../core/security.js';
import { dbGetMyCreds } from '../../core/credential.js';
import { verifyOtp, targetMask } from '../../core/otp.js';
import { issueCapToken } from '../../core/danger-ops.js';
import { logEvent } from '../../core/log.js';
import { isChallengeVerified, CAPTCHA_ID_MAX } from '../../core/human-check.js';
import { LIMITS } from '../../../shared/config.js';
import { dbFindUserByUsername } from './repo.js';

export async function handleVerifyIdentity(db, body, req) {
  const { user: me, err } = await requireUser(db, req);
  if (err) return err;

  // Human-check gate: the client sets captchaVerified=true after I-07 (slide puzzle) passes,
  // and echoes the captchaId it submitted. The captchaId is server-confirmed here
  // (isChallengeVerified) so a forged captchaVerified flag cannot skip the bot slow-down
  // without actually solving the puzzle. captcha is an anti-abuse layer over the real
  // credential check below (OTP/password are strictly server-verified) — it is NOT an auth
  // boundary, so a crafted request only ever skips the slow-down, never gains capability.
  if (body.captchaVerified !== true) return errorMsg('CAPTCHA_REQUIRED', 403);
  const captchaId = String(body.captchaId || '').slice(0, CAPTCHA_ID_MAX);
  if (!isChallengeVerified(captchaId)) {
    await logEvent(db, { action: 'auth.verify.failed', actorUsername: targetMask(me.username),
      entity: 'user', detail: { reason: 'captcha' }, req });
    return errorMsg('CAPTCHA_REQUIRED', 403);
  }

  const credential = body.credential || {};
  const type = credential.type === 'password' ? 'password' : 'otp';
  const value = String(credential.value || '').trim();
  if (!value) return errorMsg('VERIFY_FAILED', 403);

  if (type === 'password') {
    // Password branch: length cap early-exit (avoid pointless PBKDF2), uniform failure message (no enumeration).
    if (value.length > LIMITS.LOGIN_PASSWORD_MAX) return errorMsg('VERIFY_FAILED', 403);
    const u = await dbFindUserByUsername(db, me.username);
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
  // permanently 403 with no observable signal — 500 + warn instead (Z-1-F1 discipline, mirror re-auth).
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
