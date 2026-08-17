/**
 * 设置域数据层（V-1-4 从 server/db.js 提取）：user_settings 访客可见性。
 */
import { dbGet, dbRun } from '../../core/util.js';

// 隐私设置：访客可见性控制
// user_settings 无行 = 全默认可见（COALESCE 1）；upsert 单点写
// ============================================================
export async function dbGetPrivacySettings(db, userId) {
  const row = await dbGet(db,
    'SELECT allow_guest_profile, allow_guest_demand FROM user_settings WHERE user_id=?', [userId]);
  return {
    allowGuestProfile: row ? row.allow_guest_profile : 1,
    allowGuestDemand: row ? row.allow_guest_demand : 1,
  };
}

// 显式传 0 才关（=== 0 → 0，其余一律 1）；两字段任一缺失保持原值（undefined 走原值）
export async function dbSetPrivacySettings(db, userId, { allowGuestProfile, allowGuestDemand } = {}) {
  const cur = await dbGetPrivacySettings(db, userId);
  const p = allowGuestProfile === 0 ? 0 : (allowGuestProfile === undefined ? cur.allowGuestProfile : 1);
  const d = allowGuestDemand === 0 ? 0 : (allowGuestDemand === undefined ? cur.allowGuestDemand : 1);
  await dbRun(db, `INSERT INTO user_settings (user_id, allow_guest_profile, allow_guest_demand, updated_at)
    VALUES (?, ?, ?, datetime('now','localtime'))
    ON CONFLICT(user_id) DO UPDATE SET
      allow_guest_profile=excluded.allow_guest_profile,
      allow_guest_demand=excluded.allow_guest_demand,
      updated_at=excluded.updated_at`, [userId, p, d]);
  return dbGetPrivacySettings(db, userId);
}
