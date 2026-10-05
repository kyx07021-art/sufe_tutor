/**
 * settings 域数据层（S6-S4）：通知屏蔽偏好——users.notifyBroadcastMuted 列读写。
 *
 * privacy（user_settings 访客可见性）随 S6 定案⑥ 删除（新站无访客浏览）。
 *
 * 列归属：users.notifyBroadcastMuted 由 auth 域 schema 声明（跨域补列既有机制，
 * auth/schema.js ensureColumns）；本文件只做数据层读写。auth/settings.js（S1 收敛
 * /api/settings 面）当前内联 UPDATE/SELECT 该列——若主会话裁定收敛，可改调本文件
 * 函数（单源，规则 ）。
 */
import { dbGet, dbRun } from '../../core/util.js';

// Strict boolean normalizer: only literal 0/1/true/false (+ JSON string forms).
// Returns 1 | 0 | null (null = invalid/absent → caller keeps the stored value).
function normalizeMuted(v) {
  if (v === true || v === 1 || v === '1' || v === 'true') return 1;
  if (v === false || v === 0 || v === '0' || v === 'false') return 0;
  return null;
}

export async function dbGetNotifyBroadcastMuted(db, userId) {
  const row = await dbGet(db, 'SELECT notifyBroadcastMuted FROM users WHERE id=?', [userId]);
  return row ? !!row.notifyBroadcastMuted : false;
}

export async function dbSetNotifyBroadcastMuted(db, userId, muted) {
  const v = normalizeMuted(muted);
  if (v !== null) {
    await dbRun(db, 'UPDATE users SET notifyBroadcastMuted=? WHERE id=?', [v, userId]);
  }
  return dbGetNotifyBroadcastMuted(db, userId);
}
