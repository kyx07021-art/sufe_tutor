/**
 * 通知推送模块（独立维护「通知信息」侧边栏模块的全部后端逻辑）
 *
 * 设计：本模块自持建表 + 推送咽喉 + 数据层 + 路由 handler，外部只通过
 *   initNotifyTable(db)  建表（由 db.js 的 initDb 调一次）
 *   notifyUser(db, userId, text)  推送一条（咽喉：吞错不影响业务，截断 200 字）
 *   handleGetNotifications / handleMarkNotificationsRead  路由
 * 通知文案由业务方（routes-* 在拒绝/退回等节点）按场景拼装后传入，保持委婉语气。
 * 仅 import core.js（dbAll/dbGet/dbRun/json/error/MSG），不依赖 db.js，避免循环。
 */
import { dbAll, dbGet, dbRun, json, error, MSG } from './core.js';

// 建表（幂等）
export async function initNotifyTable(db) {
  await dbRun(db, `CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    text TEXT NOT NULL,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`);
  try { await dbRun(db, 'CREATE INDEX IF NOT EXISTS idx_notify_user ON notifications(user_id, is_read)'); }
  catch { /* 已存在则忽略 */ }
}

// 推送咽喉：任何通知失败都不应影响主业务；文案截断 200 字防异常长串
export async function notifyUser(db, userId, text) {
  if (!userId || !text) return;
  try {
    await dbRun(db, 'INSERT INTO notifications (user_id, text) VALUES (?,?)',
      [userId, String(text).slice(0, 200)]);
  } catch (e) {
    console.warn('notify failed:', e && e.message);
  }
}

// 管理员广播：一条 SELECT-INSERT 给全体用户各插一条（系统公告可较长，截断 500 字）；返回发送条数
export async function dbBroadcastNotification(db, text) {
  const t = String(text || '').trim().slice(0, 500);
  if (!t) return 0;
  const res = await dbRun(db, 'INSERT INTO notifications (user_id, text) SELECT id, ? FROM users', [t]);
  return (res && res.meta && res.meta.changes) || 0;
}

export async function dbGetNotifications(db, userId) {
  return await dbAll(db,
    'SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 200', [userId]);
}

// 进入通知页时一次标记全部已读
export async function dbMarkNotificationsRead(db, userId) {
  await dbRun(db, 'UPDATE notifications SET is_read=1 WHERE user_id=? AND is_read=0', [userId]);
}

// GET /api/notifications?userId=  → { notifications }（含 is_read，前端据此显示未读圆点/加粗）
export async function handleGetNotifications(db, url) {
  const userId = parseInt(url.searchParams.get('userId'));
  if (!userId) return error(MSG.LOGIN_REQUIRED);
  const notifications = await dbGetNotifications(db, userId);
  return json({ notifications });
}

// POST /api/notifications/read  body { userId }  → 全部已读
export async function handleMarkNotificationsRead(db, body) {
  const userId = parseInt(body.userId);
  if (!userId) return error(MSG.LOGIN_REQUIRED);
  await dbMarkNotificationsRead(db, userId);
  return json({ ok: true });
}
