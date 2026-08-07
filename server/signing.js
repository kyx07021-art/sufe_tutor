/**
 * 发起签约模块（v0.24.0 极简签约流）—— 加号栏「发起签约」→ 极简浮窗（报价/时间/教学方式）
 * → 会话内发特制「对方向你发送了签约请求」气泡（三条信息 + 确认/拒绝按钮）→ 对方确认/拒绝后
 * 气泡变灰、按钮消失为小灰字（「已确认签约 / 已拒绝此次签约请求」）。靠它确认签约关系。
 *
 * 签约关系如何取消：**留待未来实现**（v0.24.0 明确暂不做——当前模型下签约关系一经确认即达成，
 * 取消仅能通过双方后续在会话内协商 + 平台无对应入口；接入时建议在 signing_requests 加 status
 * 迁移或独立撤销接口，并沿用危险操作 capToken 二次认证）。
 *
 * 需求-会话解耦（v0.24.0 删屎逻辑）：一条需求允许任意多会话并存（意向/推送接受不再锁需求，
 * routes-demands.js 已移除 dbLockDemandIntent），仅当某会话的签约请求被确认（signed）时，
 * 需求才原子置 contracted 并自动拒绝其余待处理意向/推送。合同文档（起草合同）与需求签约状态
 * 彻底解耦（contract.js 已移除需求联动）。
 *
 * 数据模型：
 *   signing_requests 表：id, conversation_id, demand_id, initiator_user_id, message_id,
 *     price, schedule, method, status(pending/signed/rejected), created_at, responded_at
 *   聊天消息 kind='signing_request'：body = JSON {id, price, schedule, method, status}（自包含气泡，
 *     重开会话渲染终态）；kind='signing_response'：body = JSON {requestId, accept}（在途会话实时刷新）。
 *   回应时更新原气泡 body 的 status（终态）并落一条响应气泡。
 *
 * 路由：POST /api/conversations/:id/signing {price, schedule, method} 发起
 *       POST /api/signing-requests/:id/respond {accept}               确认/拒绝
 */
import { dbGet, dbRun, json, error } from './util.js';
import { requireUser } from './security.js';
import { MSG, STATUS, LIMITS } from './constants.js';
import {
  dbGetConversationWithNames, dbGetDemandById, dbCreateMessage,
  dbGetPendingIntentsForDemand, dbGetPendingPushesForDemand,
} from './db.js';
import { notifyUser } from './notify.js';
import { logEvent } from './log.js';
import '../constants.js';
const UIC = globalThis.APP_CONSTANTS.UI;

const otherSide = (conv, userId) => (conv.student_user_id === userId ? conv.teacher_user_id : conv.student_user_id);
const nameOf = (conv, userId) => (conv.student_user_id === userId ? conv.teacher_name : conv.student_name);

export async function initSigningTable(db) {
  await dbRun(db, `CREATE TABLE IF NOT EXISTS signing_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    demand_id INTEGER,
    initiator_user_id INTEGER NOT NULL,
    message_id INTEGER,               -- 对应会话内 signing_request 气泡的消息 id（回应时更新其 body 终态）
    price REAL NOT NULL DEFAULT 0,
    schedule TEXT NOT NULL DEFAULT '',
    method TEXT NOT NULL DEFAULT 'offline',
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','signed','rejected')),
    created_at DATETIME DEFAULT (datetime('now','localtime')),
    responded_at DATETIME,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
    FOREIGN KEY (initiator_user_id) REFERENCES users(id) ON DELETE CASCADE)`);
  try { await dbRun(db, 'CREATE INDEX IF NOT EXISTS idx_signing_conv ON signing_requests(conversation_id, status)'); }
  catch { /* 已存在则忽略 */ }
}

// POST /api/conversations/:id/signing —— 发起签约请求（极简三要素：报价/时间/教学方式）
export async function handleCreateSigning(db, body, req) {
  const { user: me, err: authErr } = await requireUser(db, req);
  if (authErr) return authErr;
  const userId = me.id;
  const conversationId = parseInt(body.conversationId);
  const conv = await dbGetConversationWithNames(db, conversationId);
  if (!conv || (conv.student_user_id !== userId && conv.teacher_user_id !== userId)) return error(MSG.NO_PERMISSION, 403);
  if (conv.status !== STATUS.ACTIVE) return error(MSG.NO_PERMISSION, 403); // 已关闭会话不可再发起签约（与发消息同款状态门禁）

  const price = Math.min(LIMITS.BUDGET_MAX, Math.max(0, parseInt(body.price) || 0)); // 报价钳制上限（LIMITS 单源）
  if (price <= 0) return error(MSG.INVALID_PARAMS, 400); // 报价必填
  const schedule = String(body.schedule || '').trim().slice(0, 200);
  if (!schedule) return error(MSG.INVALID_PARAMS, 400); // 时间（自然语言）必填
  const method = body.method === 'online' ? 'online' : 'offline'; // 线上/线下

  // 会话所绑需求须为 open（已签约/撤销的需求不可再发起签约）
  const demandId = conv.demand_id || null;
  if (demandId) {
    const dm = await dbGetDemandById(db, demandId);
    if (!dm || dm.status === STATUS.CONTRACTED || dm.status === STATUS.REVOKED) return error(MSG.DEMAND_CONTRACTED_CLOSED, 410);
  }
  // 同会话 pending 去重：已有待处理的签约请求则拒绝（防同会话堆积多条 pending 气泡、逐条确认变多签）
  const dup = await dbGet(db, `SELECT id FROM signing_requests WHERE conversation_id=? AND status='pending' LIMIT 1`, [conversationId]);
  if (dup) return error(MSG.SIGNING_ALREADY_PENDING, 409);

  // 先落气泡（body 带临时 id），再建请求记录（message_id 关联），最后回填真实 id。
  // 任一步失败回滚气泡——防「死气泡」：id=0 却带可点按钮的 pending 签约请求（点了必 404 且永不可消解）
  let msgId = null;
  let id = 0;
  try {
    msgId = await dbCreateMessage(db, conversationId, userId, 'signing_request',
      JSON.stringify({ id: 0, price, schedule, method, status: STATUS.PENDING }));
    const res = await dbRun(db,
      `INSERT INTO signing_requests (conversation_id, demand_id, initiator_user_id, message_id, price, schedule, method)
       VALUES (?,?,?,?,?,?,?)`,
      [conversationId, demandId, userId, msgId, price, schedule, method]);
    id = (res && res.meta && res.meta.last_row_id) || 0;
    await dbRun(db, 'UPDATE messages SET body=? WHERE id=?',
      [JSON.stringify({ id, price, schedule, method, status: STATUS.PENDING }), msgId]);
  } catch (e) {
    if (msgId != null) { try { await dbRun(db, 'DELETE FROM messages WHERE id=?', [msgId]); } catch { /* 回滚失败不影响主错误 */ } }
    throw e;
  }

  await notifyUser(db, otherSide(conv, userId), UIC.SIGNING_REQUEST_SENT.replace('{name}', nameOf(conv, userId)));
  await logEvent(db, { action: 'signing.create', actorUserId: userId, entity: 'signing_request', entityId: id,
    detail: { conversationId, demandId, price, method }, req });
  return json({ id, message: UIC.SIGNING_REQUEST_SENT_TOAST }, 201);
}

// POST /api/signing-requests/:id/respond { accept } —— 确认/拒绝签约请求
export async function handleRespondSigning(db, signingId, body, req) {
  const accept = body.accept === true || body.accept === 'true' || body.accept === 1;
  const { user: me, err: authErr } = await requireUser(db, req);
  if (authErr) return authErr;
  const userId = me.id;
  const sr = await dbGet(db, 'SELECT * FROM signing_requests WHERE id=?', [signingId]);
  if (!sr) return error(MSG.CONTRACT_NOT_FOUND, 404);
  const conv = await dbGetConversationWithNames(db, sr.conversation_id);
  if (!conv || (conv.student_user_id !== userId && conv.teacher_user_id !== userId)) return error(MSG.NO_PERMISSION, 403);
  if (sr.initiator_user_id === userId) return error(MSG.NO_PERMISSION, 403); // 发起者不能确认自己的请求
  if (sr.status !== STATUS.PENDING) return error(MSG.SIGNING_ALREADY_RESPONDED, 409); // 已回应过

  const newStatus = accept ? STATUS.SIGNED : STATUS.REJECTED;
  // 赢家模式 + 需求态守卫：确认签约须需求仍 open（同需求多会话并存下，若另一会话已签约成交则拒绝——
  // 否则两条签约请求都可置 signed，形成「一条需求绑定多份签约」，dbIsContracted 对两对师生都放行）；
  // 拒绝不需要需求守卫。需求被撤销/删除后同样拦下（需求不复 open）
  let up;
  if (accept && sr.demand_id) {
    up = await dbRun(db, `UPDATE signing_requests SET status='signed', responded_at=datetime('now','localtime')
      WHERE id=? AND status='pending'
      AND EXISTS(SELECT 1 FROM student_demands WHERE id=? AND status='open')`, [signingId, sr.demand_id]);
    if (!(up && up.meta && up.meta.changes > 0)) return error(MSG.DEMAND_CONTRACTED_CLOSED, 410); // 需求已非 open（已回应由上行守卫拦）
  } else {
    up = await dbRun(db, `UPDATE signing_requests SET status=?, responded_at=datetime('now','localtime')
      WHERE id=? AND status='pending'`, [newStatus, signingId]);
    if (!(up && up.meta && up.meta.changes > 0)) return error(MSG.SIGNING_ALREADY_RESPONDED, 409); // 赢家模式
  }

  // 确认签约：需求原子置 contracted（WHERE open），并自动拒绝其余待处理意向/推送
  if (accept && sr.demand_id) {
    const dm = await dbRun(db, `UPDATE student_demands SET status='contracted' WHERE id=? AND status='open'`, [sr.demand_id]);
    if (dm && dm.meta && dm.meta.changes > 0) {
      const pending = await dbGetPendingIntentsForDemand(db, sr.demand_id);
      for (const it of pending) {
        const r = await dbRun(db, `UPDATE demand_intents SET status='rejected', resolved_at=datetime('now','localtime') WHERE id=? AND status='pending'`, [it.id]);
        if (!(r && r.meta && r.meta.changes > 0)) continue; // 赢家模式：已被并发处理的行不重复留档
        await logEvent(db, { action: 'intent.auto_reject', actorRole: 'system', entity: 'intent', entityId: it.id,
          detail: { demandId: sr.demand_id, teacherUserId: it.teacher_user_id, reason: 'signing_confirmed' }, req });
      }
      const pendingPushes = await dbGetPendingPushesForDemand(db, sr.demand_id);
      for (const pp of pendingPushes) {
        const r = await dbRun(db, `UPDATE demand_pushes SET status='rejected' WHERE id=? AND status='pending'`, [pp.id]);
        if (!(r && r.meta && r.meta.changes > 0)) continue;
        await logEvent(db, { action: 'demand_push.auto_reject', actorRole: 'system', entity: 'demand_push', entityId: pp.id,
          detail: { demandId: sr.demand_id, teacherUserId: pp.teacher_user_id, reason: 'signing_confirmed' }, req });
      }
    }
  }

  // 更新原气泡 body 为终态（重开会话渲染灰字）+ 落一条响应气泡（在途会话实时刷新）
  if (sr.message_id) {
    await dbRun(db, 'UPDATE messages SET body=? WHERE id=?',
      [JSON.stringify({ id: signingId, price: sr.price, schedule: sr.schedule, method: sr.method, status: newStatus }), sr.message_id]);
  }
  await dbCreateMessage(db, sr.conversation_id, userId, 'signing_response',
    JSON.stringify({ requestId: signingId, accept }));
  await notifyUser(db, sr.initiator_user_id, accept ? UIC.SIGNING_CONFIRMED : UIC.SIGNING_REJECTED);
  await logEvent(db, { action: `signing.${accept ? 'accept' : 'reject'}`, actorUserId: userId,
    entity: 'signing_request', entityId: signingId,
    detail: { conversationId: sr.conversation_id, demandId: sr.demand_id }, req });
  return json({ ok: true, status: newStatus });
}
