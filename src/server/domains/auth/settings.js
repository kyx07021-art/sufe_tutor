/**
 * Consolidated settings surface (new-site ) — single `/api/settings` endpoint.
 * Interfaced per docs/interfaces.md ../ docs/module-plans/S1.md ..19.
 *
 * This is the NEW consolidated surface the new frontend calls. The v2 auth handlers
 * in auth/api.js remain untouched (v2-ready). Devices are intentionally NOT re-implemented
 * here: they use the v2 paths GET /api/auth/sessions + POST /api/auth/sessions/revoke
 * (D2: path retained from v2); this module only EMBEDS the device list into GET /api/settings.
 *
 * Routing: this module exports `settingsRoutes` for the module owner to wire into app.js.
 * It must NOT import from auth/api.js (api.js will import this module's settingsRoutes →
 * circular). Validation rules mirror the api.js handlers (single-source core functions are
 * imported from core/*; the small username/avatar rules are re-mirrored here by design).
 */
import { json, errorMsg, dbGet, dbRun } from '../../core/util.js';
import { requireUser } from '../../core/security.js';
import { getSessionByToken, listSessions } from '../../core/session.js';
import { confirmDangerOtp, clearDangerCaps } from '../../core/danger-ops.js';
import {
  updateUsernameCredential, getUsernameChangedAt,
  bindPhoneCredential, bindEmailCredential, dbPhoneTaken, dbEmailTaken, dbGetMyCreds,
} from '../../core/credential.js';
import { verifyOtp, normalizeIdentifier, targetMask } from '../../core/otp.js';
import { logEvent } from '../../core/log.js';
import { LIMITS } from '../../../shared/config.js';
import { DEACTIVATED_USER_PREFIX } from '../../../shared/enums.js';
import { MSG } from '../../../shared/codes.js';
import { dbDeactivateUser, dbPurgeUserOwnedData, dbUpdateUserAvatar, dbFindUserByUsername } from './repo.js';

/**
 * Single-source maskPhone (v2 settings surface convergence). auth/api.js imports
 * this export for handleAuthMe so there is exactly ONE implementation across both surfaces.
 * Masked display only, never a security boundary.
 */
export function maskPhone(phone) {
  const s = String(phone || '');
  if (!s) return ''; // unbound → empty string → frontend falls back to "unbound" placeholder
  const m = s.match(/^(\+\d+)(\d{3})\d{4}(\d{4})$/);
  if (m) return `${m[2]}****${m[3]}`;
  return s.slice(0, 3) + '***';
}

/**
 * Strict boolean pref normalizer for blockSystemNotifications / notifyBroadcastMuted.
 * Accepts only literal 0 / 1 / true / false (plus their JSON string forms) — no
 * arbitrary truthy/falsy coercion. Returns null for anything else.
 */
function normalizePref(v) {
  if (v === true || v === 1 || v === '1' || v === 'true') return 1;
  if (v === false || v === 0 || v === '0' || v === 'false') return 0;
  return null;
}

// GET /api/settings —— full settings snapshot for the new frontend settings page.
// Exact response shape per interfaces.md .
export async function handleGetSettings(db, req) {
  const { user: me, err } = await requireUser(db, req);
  if (err) return err;

  const creds = await dbGetMyCreds(db, me.id); // decrypted plaintext, masked before leaving
  const changedAt = await getUsernameChangedAt(db, me.id);
  let cooldownMs = 0;
  if (changedAt) {
    const t = Date.parse(String(changedAt).replace(' ', 'T') + 'Z');
    if (isFinite(t)) cooldownMs = Math.max(0, LIMITS.USERNAME_COOLDOWN_MS - (Date.now() - t));
  }
  const prefs = await dbGet(db, 'SELECT blockSystemNotifications, notifyBroadcastMuted FROM users WHERE id=?', [me.id]);

  // Devices embedded from the v2 session store (no re-implementation — see file header).
  const curRow = await getSessionByToken(db, me.id, req.headers.get('X-Auth-Token'));
  const currentId = (curRow && curRow.session_id) || '';
  const sessions = await listSessions(db, me.id);
  // DB UTC 'YYYY-MM-DD HH:MM:SS' is not self-describing — convert to ISO-8601 with Z so any
  // consumer Date.parse/new Date resolves to the same instant (same pattern as auth/api.js).
  const toIso = t => (t ? new Date(String(t).replace(' ', 'T') + 'Z').toISOString() : null);

  return json({
    user: {
      id: me.id,
      username: me.username,
      avatar: me.avatar || '',
      role: me.role,
      contactMasks: { phone: maskPhone(creds.phone), email: targetMask(creds.email) },
    },
    usernameStatus: { canChange: cooldownMs <= 0, cooldownMs },
    blockSystemNotifications: prefs ? !!prefs.blockSystemNotifications : false,
    notifyBroadcastMuted: prefs ? !!prefs.notifyBroadcastMuted : false,
    devices: sessions.map(s => ({
      session_id: s.session_id,
      label: s.label,
      created_at: toIso(s.created_at),
      expires_at: toIso(s.expires_at),
      current: s.session_id === currentId,
    })),
  });
}

// PUT /api/settings —— partial update dispatched by field branch (interfaces.md ).
export async function handleUpdateSettings(db, body, req) {
  const { user: me, err } = await requireUser(db, req);
  if (err) return err;
  const b = body || {};

  // Branch 1: username change (danger op — capToken required).
  if (b.username !== undefined) {
    if (me.role === 'admin') return errorMsg('NO_PERMISSION', 403);
    if (!(await confirmDangerOtp(db, req, b))) return errorMsg('REAUTH_FAILED', 403);
    const newName = String(b.username || '').trim();
    if (newName.length < LIMITS.USERNAME_MIN || newName.length > LIMITS.USERNAME_MAX) return errorMsg('USERNAME_LENGTH');
    // Whitelist chars + no '@' + not pure digit (login input classifies by format → ambiguity).
    if (!/^[\p{Script=Han}A-Za-z0-9_.\-]+$/u.test(newName)) return errorMsg('USERNAME_NEW_INVALID');
    if (newName.includes('@') || /^\d+$/.test(newName)) return errorMsg('USERNAME_NEW_INVALID');
    // Tombstone-prefix ban: no impersonating a deactivated account.
    const tombPrefix = DEACTIVATED_USER_PREFIX;
    if (tombPrefix && newName.startsWith(tombPrefix)) return errorMsg('USERNAME_NEW_INVALID');
    if (newName === me.username) return errorMsg('USERNAME_NEW_INVALID');
    const changedAt = await getUsernameChangedAt(db, me.id);
    if (changedAt) {
      const t = Date.parse(String(changedAt).replace(' ', 'T') + 'Z');
      if (isFinite(t) && Date.now() - t < LIMITS.USERNAME_COOLDOWN_MS) return errorMsg('USERNAME_COOLDOWN');
    }
    if (await dbFindUserByUsername(db, newName)) return errorMsg('USERNAME_TAKEN', 409); // occupied → 409
    await updateUsernameCredential(db, me.id, newName);
    await logEvent(db, { action: 'user.username.change', actorUserId: me.id, actorUsername: me.username,
      actorRole: me.role, entity: 'user', entityId: me.id, detail: { from: me.username, to: newName }, req });
    return json({ ok: true, username: newName, message: MSG.USERNAME_CHANGED });
  }

  // Branch 2: avatar update (bitmap dataURL only).
  if (b.avatar !== undefined) {
    const avatar = String(b.avatar || '');
    // SVG rejected (vector can embed scripts); bitmap whitelist + length cap (single source LIMITS.AVATAR_MAX_BYTES).
    if (!/^data:image\//i.test(avatar) || /^data:image\/svg/i.test(avatar) || avatar.length > LIMITS.AVATAR_MAX_BYTES) return errorMsg('AVATAR_INVALID');
    await dbUpdateUserAvatar(db, me.id, avatar);
    await logEvent(db, { action: 'user.avatar.update', actorUserId: me.id, actorUsername: me.username,
      actorRole: me.role, entity: 'user', entityId: me.id, req });
    return json({ ok: true });
  }

  // Branch 3: bind phone / email (verify-code FIRST, then occupied check — matches 
  // 验码先行 anti-enumeration; only a code holder can trigger the 409 occupied probe).
  if (b.channel !== undefined) {
    const isEmail = b.channel === 'email';
    const channel = isEmail ? 'email' : 'sms';
    const raw = String(b.target || '').trim();
    const code = String(b.code || '').trim();
    if (!raw || !code) return errorMsg('OTP_REQUIRED');
    const norm = normalizeIdentifier(raw);
    if (isEmail) {
      if (norm.kind !== 'email' || norm.target.length > LIMITS.EMAIL_MAX) return errorMsg('EMAIL_INVALID');
    } else {
      if (norm.kind !== 'phone') return errorMsg('PHONE_INVALID');
    }
    const target = norm.target;
    const otpR = await verifyOtp(db, { channel, target, code });
    if (otpR === 'exhausted') return errorMsg('OTP_EXHAUSTED', 400);
    if (otpR !== 'ok') return errorMsg('OTP_INVALID_OR_EXPIRED');
    const taken = isEmail ? await dbEmailTaken(db, target) : await dbPhoneTaken(db, target);
    if (taken) return errorMsg(isEmail ? 'EMAIL_ALREADY_BOUND' : 'PHONE_ALREADY_BOUND', 409);
    if (isEmail) {
      await bindEmailCredential(db, me.id, target);
      await logEvent(db, { action: 'user.email.bind', actorUserId: me.id, actorUsername: me.username,
        actorRole: me.role, entity: 'user', entityId: me.id, detail: { email: targetMask(target) }, req });
      return json({ ok: true, message: MSG.BIND_SUCCESS, email: targetMask(target) });
    }
    await bindPhoneCredential(db, me.id, target);
    await logEvent(db, { action: 'user.phone.bind', actorUserId: me.id, actorUsername: me.username,
      actorRole: me.role, entity: 'user', entityId: me.id, detail: { phone: maskPhone(target) }, req });
    return json({ ok: true, message: MSG.BIND_SUCCESS, phone: maskPhone(target) });
  }

  // Branch 4: notification prefs (strict 0/1 booleans).
  if (b.blockSystemNotifications !== undefined || b.notifyBroadcastMuted !== undefined) {
    const update = {};
    if (b.blockSystemNotifications !== undefined) {
      const v = normalizePref(b.blockSystemNotifications);
      if (v === null) return errorMsg('INVALID_PARAMS');
      update.blockSystemNotifications = v;
    }
    if (b.notifyBroadcastMuted !== undefined) {
      const v = normalizePref(b.notifyBroadcastMuted);
      if (v === null) return errorMsg('INVALID_PARAMS');
      update.notifyBroadcastMuted = v;
    }
    const sets = Object.keys(update).map(k => `${k}=?`);
    await dbRun(db, `UPDATE users SET ${sets.join(',')} WHERE id=?`, [...Object.values(update), me.id]);
    await logEvent(db, { action: 'user.settings.prefs', actorUserId: me.id, actorUsername: me.username,
      actorRole: me.role, entity: 'user', entityId: me.id, detail: update, req });
    return json({ ok: true });
  }

  return errorMsg('INVALID_PARAMS');
}

// POST /api/settings/deactivate —— account deactivation (admin forbidden, capToken-gated).
// Clears contact columns to release the unique phone/email indexes (AE-1) + username tombstone.
export async function handleDeactivateSettings(db, body, req) {
  const { user: me, err } = await requireUser(db, req);
  if (err) return err;
  if (me.role === 'admin') return errorMsg('NO_PERMISSION', 403);
  if (!(await confirmDangerOtp(db, req, body))) return errorMsg('REAUTH_FAILED', 403);
  const tombstone = `${DEACTIVATED_USER_PREFIX}#${me.id}`;
  await dbDeactivateUser(db, me.id, tombstone);
  await dbPurgeUserOwnedData(db, me.id, me.role);
  await clearDangerCaps(db, me.id);
  await logEvent(db, { action: 'user.deactivate', actorUserId: me.id, actorUsername: tombstone,
    actorRole: me.role, entity: 'user', entityId: me.id, req });
  return json({ ok: true });
}

// ============================================================
// Consolidated settings routes (module owner wires these into app.js)
// ============================================================
const S = (method, path, handler) => ({ method, path, handler });
export const settingsRoutes = [
  S('GET', '/api/settings', c => handleGetSettings(c.db, c.req)),
  S('PUT', '/api/settings', c => handleUpdateSettings(c.db, c.body, c.req)),
  S('POST', '/api/settings/deactivate', c => handleDeactivateSettings(c.db, c.body, c.req)),
];
