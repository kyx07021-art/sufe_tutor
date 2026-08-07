/**
 * 通知推送模块（独立维护「通知信息」侧边栏模块的全部后端逻辑）
 *
 * 设计：本模块自持建表 + 推送咽喉 + 数据层 + 路由 handler，外部只通过
 *   initNotifyTable(db)  建表（由 db.js 的 initDb 调一次）
 *   notifyUser(db, userId, text)  推送一条（咽喉：吞错不影响业务，截断 200 字）
 *   handleGetNotifications / handleMarkNotificationsRead  路由
 * 通知文案由业务方（routes-* 在拒绝/退回等节点）按场景拼装后传入，保持委婉语气。
 * 依赖方向：util（db 薄封装 + 响应构造）/ security（authUser/requireAdminOrError）/ log（留档）。
 * 不依赖 db.js，避免循环。
 *
 * 广播批删（管理员）：广播一次为全体用户各插一行，同批共享 batch_id；
 * 删除按 batch_id 整批删（替代旧「同文案+同秒」匹配——同秒两批同文案会连带误删，已修）。
 * 历史行 / 单点推送无 batch_id，按 id 单删。
 */
import { dbAll, dbGet, dbRun, json, error, genCode, ensureColumns } from './util.js';
import { authUser, requireAdminOrError } from './security.js';
import { MSG, LIMITS } from './constants.js';
import { logEvent } from './log.js';

// 建表（幂等；batch_id 为广播批标识，旧表经 ensureColumns 补列）
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
  await ensureColumns(db, 'notifications', [['batch_id', 'TEXT DEFAULT NULL']]);
}

/** 推送咽喉：任何通知失败都不应影响主业务；文案截断 LIMITS.NOTIF_TEXT_MAX 防异常长串 */
export async function notifyUser(db, userId, text) {
  if (!userId || !text) return;
  try {
    await dbRun(db, 'INSERT INTO notifications (user_id, text) VALUES (?,?)',
      [userId, String(text).slice(0, LIMITS.NOTIF_TEXT_MAX)]);
  } catch (e) {
    console.warn('notify failed:', e && e.message);
  }
}

/**
 * 管理员广播：一条 SELECT-INSERT 给全体用户各插一条，同批共享 batch_id（供整批删除）。
 * 公告含正文可较长，截断 LIMITS.BROADCAST_TEXT_MAX；返回发送条数
 */
export async function dbBroadcastNotification(db, text) {
  const t = String(text || '').trim().slice(0, LIMITS.BROADCAST_TEXT_MAX);
  if (!t) return 0;
  const batchId = genCode(8);
  const res = await dbRun(db, 'INSERT INTO notifications (user_id, text, batch_id) SELECT id, ?, ? FROM users', [t, batchId]);
  return (res && res.meta && res.meta.changes) || 0;
}

async function dbGetNotifications(db, userId) {
  return await dbAll(db,
    `SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT ${LIMITS.NOTIF_LIST_MAX}`, [userId]);
}

// 进入通知页时一次标记全部已读
async function dbMarkNotificationsRead(db, userId) {
  await dbRun(db, 'UPDATE notifications SET is_read=1 WHERE user_id=? AND is_read=0', [userId]);
}

// GET /api/notifications → { notifications }（含 is_read，前端据此显示未读圆点；身份凭令牌）
export async function handleGetNotifications(db, req) {
  const me = await authUser(db, req);
  if (!me) return error(MSG.LOGIN_REQUIRED, 401);
  const notifications = await dbGetNotifications(db, me.id);
  return json({ notifications });
}

// POST /api/notifications/read → 全部已读（身份凭令牌）
export async function handleMarkNotificationsRead(db, body, req) {
  const me = await authUser(db, req);
  if (!me) return error(MSG.LOGIN_REQUIRED, 401);
  await dbMarkNotificationsRead(db, me.id);
  return json({ ok: true });
}

// DELETE /api/admin/notifications/:id —— 删除一整批广播通知（广播 = 全体用户同文案同秒各插一行，
// 同批共享 batch_id；传任一条的 id 即按 batch_id 删全批。历史行/单点推送无 batch_id 则单删。
// backoffice 接口：前端无调用，供管理员误发公告的撤销（CLAUDE.md 部署纪律引用了此接口）
export async function handleAdminDeleteNotification(db, notifId, req) {
  const { admin, err } = await requireAdmin(db, req);
  if (err) return err;
  const n = await dbGet(db, 'SELECT id, batch_id, text, created_at FROM notifications WHERE id=?', [notifId]);
  if (!n) return json({ ok: true, count: 0 });
  const res = n.batch_id
    ? await dbRun(db, 'DELETE FROM notifications WHERE batch_id=?', [n.batch_id])
    : await dbRun(db, 'DELETE FROM notifications WHERE id=?', [n.id]);
  const count = (res && res.meta && res.meta.changes) || 0;
  await logEvent(db, { action: 'admin.notification.delete', actorUserId: admin.id, actorUsername: admin.username,
    actorRole: 'admin', entity: 'notification', entityId: notifId,
    detail: { batch: count, len: (n.text || '').length }, req });
  return json({ ok: true, count });
}
