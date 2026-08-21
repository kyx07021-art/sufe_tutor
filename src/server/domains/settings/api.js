/**
 * 路由模块：隐私设置——访客可见性控制
 * GET  /api/privacy-settings   读本人设置（requireUser）
 * POST /api/privacy-settings   写（requireUser）；字段显式 0 关闭、缺省保持原值
 * 访客浏览过滤在 db 层（dbGetDemands forGuest / dbGetTeachers 游客分支），本文件只管读写。
 * 依赖：security（requireUser）、constants（MSG）、db、log。
 */
import { json, errorMsg } from '../../core/util.js';
import { requireUser } from '../../core/security.js';
import { MSG } from '../../../shared/codes.js';
import { dbGetPrivacySettings, dbSetPrivacySettings } from '../../../../server/db.js';
import { logEvent } from '../../core/log.js';

export async function handleGetPrivacySettings(db, req) {
  const { user: me, err } = await requireUser(db, req);
  if (err) return err;
  return json(await dbGetPrivacySettings(db, me.id));
}

export async function handleSetPrivacySettings(db, body, req) {
  const { user: me, err } = await requireUser(db, req);
  if (err) return err;
  const { allowGuestProfile, allowGuestDemand } = body || {};
  // 只接受 0/1（布尔归一）；其余/缺省 → undefined（保持原值）。至少一个有效字段才写。
  const norm = v => (v === 0 || v === 1 ? v : undefined);
  const p = norm(allowGuestProfile), d = norm(allowGuestDemand);
  if (p === undefined && d === undefined) return errorMsg('INVALID_PARAMS');
  const settings = await dbSetPrivacySettings(db, me.id, { allowGuestProfile: p, allowGuestDemand: d });
  await logEvent(db, { action: 'privacy.update', actorUserId: me.id, entity: 'user', entityId: me.id, req });
  return json({ ...settings, ok: true });
}

// ============================================================
// settings 域路由表（V-1-4c）
// ============================================================
const S = (method, path, handler) => ({ method, path, handler });
export const routes = [
  S('GET', '/api/privacy-settings', c => handleGetPrivacySettings(c.db, c.req)),
  S('POST', '/api/privacy-settings', c => handleSetPrivacySettings(c.db, c.body, c.req)),
];
