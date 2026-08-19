/**
 * 通知推送模块（独立维护「通知信息」侧边栏模块的全部后端逻辑）
 *
 * 设计：本模块自持建表 + 推送咽喉 + 数据层 + 路由 handler，外部只通过
 *   initNotifyTable(db)  建表（由 db.js 的 initDb 调一次）
 *   notifyUser(db, userId, type, params)  推送一条结构化通知（V-2-4：type=NOTIFY_TYPES
 *     键 + params 数据，文案渲染移交客户端 constants/text.js 单源；text 列新行留空，
 *     旧行保留渲染串作历史兜底）
 *   handleGetNotifications / handleMarkNotificationRead  路由（#151：单条已读取代批量全读）
 * 依赖方向：util（db 薄封装 + 响应构造）/ security（authUser/requireAdmin）/ log（留档）。
 * 不依赖 db.js，避免循环。
 *
 * 广播批删（管理员）：广播一次为全体用户各插一行，同批共享 batch_id；
 * 删除按 batch_id 整批删（同秒两批同文案也不会连带误删）。
 * 历史行 / 单点推送无 batch_id，按 id 单删。
 */
import { dbAll, dbGet, dbRun, json, error, errorMsg, genCode, ensureColumns } from './util.js';
import { authUser, requireAdmin } from './security.js';
import { MSG } from '../../shared/codes.js';
import { LIMITS } from '../../shared/config.js';
import { logEvent } from './log.js';
import { bumpVersions } from '../../../server/version.js'; // 通知插入统一 bump notifications 域

// 建表（幂等；batch_id 为广播批标识，type/params 为 V-2-4 结构化通知，旧表经 ensureColumns 补列）
export async function initNotifyTable(db) {
  await dbRun(db, `CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    text TEXT NOT NULL,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`);
  try { await dbRun(db, 'CREATE INDEX IF NOT EXISTS idx_notify_user ON notifications(user_id, is_read)'); }
  catch { /* 已存在则忽略 */ }
  await ensureColumns(db, 'notifications', [
    ['batch_id', 'TEXT DEFAULT NULL'],
    ['type', 'TEXT DEFAULT NULL'],    // V-2-4: NOTIFY_TYPES 键（客户端渲染单源）
    ['params', 'TEXT DEFAULT NULL'],  // V-2-4: type 对应参数的 JSON
  ]);
}

/** 推送咽喉：任何通知失败都不应影响主业务。type 为 NOTIFY_TYPES 键，params 为
 *  渲染所需数据（客户端负责文案）；text 列新行写空、旧行保留历史渲染串兜底。 */
export async function notifyUser(db, userId, type, params = {}) {
  if (!userId || !type) return;
  try {
    await dbRun(db, 'INSERT INTO notifications (user_id, text, type, params) VALUES (?,?,?,?)',
      [userId, '', type, JSON.stringify(params)]);
    // 通知插入即 bump notifications 域——所有业务方（意向/推送/合同/反馈等）
    // 的逐用户通知都经此咽喉，对端客户端 8s 内静默重拉红点。低频，不成放大；失败静默不影响主业务
    await bumpVersions(db, ['notifications']);
  } catch (e) {
    console.warn('notify failed:', e && e.message);
  }
}

/**
 * 管理员广播：一条 SELECT-INSERT 给全体用户各插一条，同批共享 batch_id（供整批删除）。
 * 结构化：type='BROADCAST' + params {title, text}（标题前缀由客户端渲染拼装）；
 * 正文截断 LIMITS.BROADCAST_TEXT_MAX；返回发送条数
 */
export async function dbBroadcastNotification(db, title, text) {
  const t = String(text || '').trim().slice(0, LIMITS.BROADCAST_TEXT_MAX);
  if (!t) return 0;
  const titleC = String(title || '').trim().slice(0, LIMITS.BROADCAST_TITLE_MAX);
  const batchId = genCode(8);
  const params = JSON.stringify({ title: titleC, text: t });
  // 已注销用户不收广播（否则 purge 后再广播会为墓碑用户补插幽灵通知）
  const res = await dbRun(db, "INSERT INTO notifications (user_id, text, type, params, batch_id) SELECT id, '', 'BROADCAST', ?, ? FROM users WHERE deactivated=0", [params, batchId]);
  return (res && res.meta && res.meta.changes) || 0;
}

/** Mapper 单点：解析结构化 params JSON（损坏 JSON 回落 null，客户端走 type 缺失兜底） */
function mapNotification(row) {
  let params = null;
  if (row.params) { try { params = JSON.parse(row.params); } catch { params = null; } }
  return { ...row, params };
}

async function dbGetNotifications(db, userId) {
  const rows = await dbAll(db,
    `SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT ${LIMITS.NOTIF_LIST_MAX}`, [userId]);
  return rows.map(mapNotification);
}

// 单条标记已读（#151：未读持久到点击消除；归属硬约束——只翻本人的通知行，跨用户调用静默 0 行）
async function dbMarkNotificationRead(db, notifId, userId) {
  await dbRun(db, 'UPDATE notifications SET is_read=1 WHERE id=? AND user_id=? AND is_read=0', [notifId, userId]);
}

// GET /api/notifications → { notifications }（含 is_read，前端据此显示未读圆点；身份凭令牌）
export async function handleGetNotifications(db, req) {
  const me = await authUser(db, req);
  if (!me) return errorMsg('LOGIN_REQUIRED', 401);
  const notifications = await dbGetNotifications(db, me.id);
  return json({ notifications });
}

// POST /api/notifications/:id/read → 单条已读（#151 取代原批量全读；纯个人游标，不 bump 版本域）
export async function handleMarkNotificationRead(db, notifId, req) {
  const me = await authUser(db, req);
  if (!me) return errorMsg('LOGIN_REQUIRED', 401);
  const id = /^\d+$/.test(String(notifId)) ? Number(notifId) : 0;
  if (!id) return errorMsg('INVALID_PARAMS', 400);
  await dbMarkNotificationRead(db, id, me.id);
  return json({ ok: true });
}

// POST /api/notifications/read-all → 全部已读（2026-08-09 反馈：离开通知页时把本次已展示的未读批量标记，
// 免逐条点击；纯个人游标，不 bump 版本域，与单条已读同口径。进入页面不再自动全读——未读呼吸先展示，切出才消）
export async function handleMarkAllNotificationsRead(db, req) {
  const me = await authUser(db, req);
  if (!me) return errorMsg('LOGIN_REQUIRED', 401);
  await dbRun(db, 'UPDATE notifications SET is_read=1 WHERE user_id=? AND is_read=0', [me.id]);
  return json({ ok: true });
}

// DELETE /api/admin/notifications/:id —— 删除一整批广播通知（广播 = 全体用户同文案同秒各插一行，
// 同批共享 batch_id；传任一条的 id 即按 batch_id 删全批。历史行/单点推送无 batch_id 则单删。
// backoffice 接口：前端无调用，供管理员误发公告的撤销（CLAUDE.md 部署纪律引用了此接口）
export async function handleAdminDeleteNotification(db, notifId, req) {
  const { admin, err } = await requireAdmin(db, req);
  if (err) return err;
  const n = await dbGet(db, 'SELECT id, batch_id, text, params, created_at FROM notifications WHERE id=?', [notifId]);
  if (!n) return json({ ok: true, count: 0 });
  const res = n.batch_id
    ? await dbRun(db, 'DELETE FROM notifications WHERE batch_id=?', [n.batch_id])
    : await dbRun(db, 'DELETE FROM notifications WHERE id=?', [n.id]);
  const count = (res && res.meta && res.meta.changes) || 0;
  // V-2-4 结构化行正文在 params.text（text 列留空），审计 len 取真实正文长
  let bodyLen = (n.text || '').length;
  if (!bodyLen && n.params) { try { const p = JSON.parse(n.params); bodyLen = (p.text || '').length; } catch { /* 损坏 params 视为无正文 */ } }
  await logEvent(db, { action: 'admin.notification.delete', actorUserId: admin.id, actorUsername: admin.username,
    actorRole: 'admin', entity: 'notification', entityId: notifId,
    detail: { batch: count, len: bodyLen }, req });
  return json({ ok: true, count });
}
