/**
 * 路由模块：隐私设置——访客可见性控制
 * GET  /api/privacy-settings   读本人设置（requireUser）
 * POST /api/privacy-settings   写（requireUser）；字段显式 0 关闭、缺省保持原值
 * 访客浏览过滤在 db 层（dbGetDemands forGuest / dbGetTeachers 游客分支），本文件只管读写。
 * 依赖：security（requireUser）、constants（MSG）、db、log。
 */
import { json, error } from '../src/server/core/util.js';
import { requireUser } from '../src/server/core/security.js';
import { MSG } from './constants.js';
import { dbGetPrivacySettings, dbSetPrivacySettings } from './db.js';
import { logEvent } from '../src/server/core/log.js';

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
  if (p === undefined && d === undefined) return error(MSG.INVALID_PARAMS);
  const settings = await dbSetPrivacySettings(db, me.id, { allowGuestProfile: p, allowGuestDemand: d });
  await logEvent(db, { action: 'privacy.update', actorUserId: me.id, entity: 'user', entityId: me.id, req });
  return json({ ...settings, ok: true });
}
