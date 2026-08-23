/**
 * 路由模块：站内沟通（会话列表 / 消息轮询 / 发送 / 附件暂存上传）
 * 消息发送走 logEvent 业务审计留档（detail 含正文元数据，不落 dataURL 本体；访问层读流量不入留档）
 * 图片/文件：kind=image/file；暂存上传走 uploads 表，发送时凭 uploadId 落入会话。
 * 安全补丁已并入主线：svg/html dataURL 黑名单（防钓鱼投递）、附件体积上限、暂存配额自愈+封顶、
 * 参与方 404 不泄露会话存在性。限额全部单源 constants.LIMITS。
 */
import { json, errorMsg, parseIdParam } from '../../core/util.js';
import { requireUser, requireAdmin } from '../../core/security.js';
import { encryptField, decryptField } from '../../core/crypto.js'; // 附件 dataURL 加密落库（网安 N-05）
import { MSG } from '../../../shared/codes.js';
import { STATUS, ROLES, TEMP_STATUS } from '../../../shared/enums.js';
import { LIMITS } from '../../../shared/config.js';
import {
  dbGetMyConversations, dbGetMyRelations, dbGetConversationById, dbGetConversationWithNames, dbGetMessages, dbMarkConversationRead,
  dbGetMessageAttachment,
  dbPurgeStaleUploads, dbCountUploads, dbCreateUpload, dbGetUpload, dbGetUploads, dbDeleteUpload,
  dbPrepareMessageInsert, dbPrepareUploadDelete, dbGetMessagesByClientKeys,
  dbCloseConversationCascade, dbGetConversationByTuple, dbDeleteConversation,
  dbGetUserById, dbUpsertConversation,
} from '../../../../server/db.js';
// S2-T3/T6: temp conversation repo functions. Imported directly from the domain repo (not the shim)
// because the shim has not re-exported them yet — same direct-repo pattern as contract/api.js.
import { dbCreateTempConversation, dbPrepareTempAdvance, dbPrepareTempMessageInsert, dbPrepareTempUploadDelete } from './repo.js';
import { logEvent } from '../../core/log.js';
import { notifyUser } from '../../core/notify.js'; // AI-1：结束关系通知（CONVERSATION_CLOSED 等）
import { confirmDangerOtp } from '../../core/danger-ops.js'; // AI-1：危险操作二次认证（结束关系同撤销合同口径 F-05）

const isParticipant = (conv, userId) =>
  conv && (conv.student_user_id === userId || conv.teacher_user_id === userId);

// AI-1：会话参与方 helper（通知对端判定 + 名字取用；conv 经 dbGetConversationWithNames 带双方名）
const otherSide = (conv, userId) => conv && (userId === conv.student_user_id ? conv.teacher_user_id : conv.student_user_id);
const nameOf = (conv, userId) => conv && (userId === conv.student_user_id ? conv.student_name : conv.teacher_name);

// S2-T3: temp conversation send quota (I-23/I-24). For a formal conversation (temp_status NULL) returns null.
// For a temp conversation: the initiator may send 1 message while it is 'init'; the receiver may send 1 reply
// while it is 'sent' (which formalizes it). Anyone who already used their side gets 0.
const quotaOf = (conv, meId) => {
  if (!conv || !conv.temp_status) return null;
  if (conv.temp_initiator_user_id === meId) return conv.temp_status === TEMP_STATUS.INIT ? 1 : 0;
  return conv.temp_status === TEMP_STATUS.SENT ? 1 : 0;
};

// 会话操作公共关口：取会话行 + 参与方校验（会话双方学生/教师）。
// 不存在或非参与方统一 404（不向外透露会话存在性）；失败返 { err: Response }，成功返 { conv }
// S2-T5 (I-18): temp 'init' conversation is hidden from the non-initiator — 404 with the same
// CONVERSATION_NOT_FOUND so no existence is leaked. Also blocks non-initiator sends to an init temp.
async function loadConversationFor(db, conversationId, userId) {
  const conv = await dbGetConversationById(db, conversationId);
  if (!conv || !isParticipant(conv, userId)) return { err: errorMsg('CONVERSATION_NOT_FOUND', 404) };
  if (conv.temp_status === TEMP_STATUS.INIT && conv.temp_initiator_user_id !== userId) {
    return { err: errorMsg('CONVERSATION_NOT_FOUND', 404) };
  }
  return { conv };
}

// POST /api/conversations/:id/close — end relationship (AI-1): conversation active→closed + cascading
// contract revoke. S5 standalone contracts: the signing layer is gone; S3 single-subject: no demand
// release (see chat/repo.js dbCloseConversationCascade). Signed contracts are retained as historical
// evidence (A5 terminal-state gate). capToken second-factor auth required (dangerous operation).
// Idempotent: an already-closed conversation returns alreadyClosed without consuming capToken; a
// concurrent double-close runs the side effects only for the winner.
export async function handleCloseConversation(db, conversationId, body, req) {
  const { user: me, err } = await requireUser(db, req);
  if (err) return err;
  const g = await loadConversationFor(db, conversationId, me.id); // 参与方校验 + 404 不泄露存在性
  if (g.err) return g.err;
  if (g.conv.status !== STATUS.ACTIVE) return json({ ok: true, alreadyClosed: true }); // 幂等短路，不消耗 capToken
  // S2-T7 (I-16): temp close = delete the conversation row (FK cascade removes its messages) + ZERO
  // notification. capToken still required (same as formal). No cascade, no notifyUser.
  if (g.conv.temp_status) {
    if (!(await confirmDangerOtp(db, req, body))) return errorMsg('REAUTH_FAILED', 403);
    await dbDeleteConversation(db, conversationId);
    await logEvent(db, { action: 'conversation.temp_close', actorUserId: me.id, entity: 'conversation', entityId: conversationId,
      detail: { conversationId, tempStatus: g.conv.temp_status }, req });
    return json({ ok: true, closed: true, temp: true });
  }
  // 危险操作二次认证：参与方校验之后、业务写入之前（非法态不消耗一次性 token）
  if (!(await confirmDangerOtp(db, req, body))) return errorMsg('REAUTH_FAILED', 403);

  const conv = await dbGetConversationWithNames(db, conversationId); // 通知文案需要双方用户名
  if (!conv) return errorMsg('CONVERSATION_NOT_FOUND', 404);
  const res = await dbCloseConversationCascade(db, conversationId, conv.student_user_id, conv.teacher_user_id);
  if (!res.closeWon) return json({ ok: true, alreadyClosed: true }); // concurrent loser: peer already closed, cascade already ran

  // ---- side effects (E2): the main result (conversation closed + cascade landed) is set; notify/log
  // failures do not flip the 200 ----
  const other = otherSide(conv, me.id);
  const myName = nameOf(conv, me.id);
  let contractsRevoked = 0;
  for (const c of res.revoked) {
    if (!c.changes) continue; // snapshot drift: the contract was already revoked concurrently → zero side effects
    contractsRevoked++;
    await notifyUser(db, other, 'CONTRACT_REVOKED', { name: myName });
    await logEvent(db, { action: 'contract.auto_revoke', actorRole: 'system', actorUserId: me.id,
      entity: 'contract', entityId: c.id,
      detail: { conversationId, contractId: c.id, reason: 'conversation_closed' }, req });
  }
  await notifyUser(db, other, 'CONVERSATION_CLOSED', { name: myName });
  await logEvent(db, { action: 'conversation.close', actorUserId: me.id, entity: 'conversation', entityId: conversationId,
    detail: { conversationId, closedBy: me.id, contractsRevoked }, req });
  return json({ ok: true, closed: true, contractsRevoked });
}

// 文件类 dataURL 黑名单：html/svg 可投递钓鱼内容（现代浏览器阻断执行但仍可投递），一律拒收。
// 比较一律小写化（防 DATA:TEXT/HTML、Data:Image/SVG 大小写绕过）；对 image 与 file 两种 kind 同时生效
const fileDataBlocked = content => {
  const c = String(content).toLowerCase();
  return c.startsWith('data:text/html') || c.startsWith('data:image/svg')
      || c.startsWith('data:application/xhtml+xml') || c.startsWith('data:text/xml') || c.startsWith('data:application/xml')
      // Q-2d-F4：active-content 类补全（javascript/ecmascript data URL 可直接执行，拒绝投递）
      || c.startsWith('data:application/javascript') || c.startsWith('data:application/x-javascript')
      || c.startsWith('data:text/javascript') || c.startsWith('data:application/ecmascript') || c.startsWith('data:text/ecmascript');
};

// Q-2d-F4：附件文件名净化——剥离路径分隔（/、\，防 ../ 穿越/路径伪装）与控制字符（\x00-\x1f）
const sanitizeFileName = v => String(v || '')
  .replace(/[\\/\x00-\x1f]/g, '_')
  .slice(0, LIMITS.FILE_NAME_MAX);

// S2-T3 (I-23): POST /api/conversations/temp — create or reuse a temp conversation.
//   Body { targetUserId, firstMessage? }. Response { conversationId, status, tempStatus, tempInitiatorId, iAmInitiator, quota }.
//   - me.role student → tuple (me.id, target); teacher → tuple (target, me.id). Target must exist,
//     be the opposite role, not self, not banned/deactivated → else 404 CONVERSATION_NOT_FOUND.
//   - Formal conversation already exists for the tuple (temp_status IS NULL): reuse; if closed, reopen via
//     dbUpsertConversation (status active, demand null). Response tempStatus null, iAmInitiator false, quota null.
//   - Temp conversation already exists (temp_status NOT NULL): reuse with its current state + quotaOf.
//   - None exists: dbCreateTempConversation → init row (temp_initiator = me). If firstMessage is provided
//     (trimmed, ≤ TEMP_FIRST_MSG_MAX) it is inserted in the SAME db.batch as the init→sent advance (atomic).
export async function handleCreateTempConversation(db, body, req) {
  const { user: me, err } = await requireUser(db, req);
  if (err) return err;
  const targetId = Number(body && body.targetUserId);
  if (!Number.isInteger(targetId) || targetId <= 0) return errorMsg('INVALID_PARAMS', 400);
  if (targetId === me.id) return errorMsg('CONVERSATION_NOT_FOUND', 404);

  const target = await dbGetUserById(db, targetId);
  if (!target || target.banned || target.deactivated) return errorMsg('CONVERSATION_NOT_FOUND', 404);
  // Opposite role only (student↔teacher); self excluded above.
  const meIsStudent = me.role === ROLES.STUDENT;
  const meIsTeacher = me.role === ROLES.TEACHER;
  if (!meIsStudent && !meIsTeacher) return errorMsg('CONVERSATION_NOT_FOUND', 404);
  const targetOk = meIsStudent ? target.role === ROLES.TEACHER : target.role === ROLES.STUDENT;
  if (!targetOk) return errorMsg('CONVERSATION_NOT_FOUND', 404);

  const studentUserId = meIsStudent ? me.id : targetId;
  const teacherUserId = meIsStudent ? targetId : me.id;

  const existing = await dbGetConversationByTuple(db, studentUserId, teacherUserId);
  if (existing) {
    if (existing.temp_status == null) {
      // Formal conversation exists for this tuple. Reopen if closed (dbUpsertConversation handles closed → active).
      if (existing.status === STATUS.CLOSED) {
        await dbUpsertConversation(db, studentUserId, teacherUserId, null);
      }
      return json({ conversationId: existing.id, status: STATUS.ACTIVE, tempStatus: null, tempInitiatorId: null, iAmInitiator: false, quota: null });
    }
    // Temp conversation already exists: reuse in its current state.
    // I-24/I-18: init is visible only to its initiator — a non-initiator must not learn the
    // session exists (same rule as the send path above). The tuple is UNIQUE, so a fresh create
    // would collide anyway; 404 surfaces "no usable conversation" without leaking the init row.
    if (existing.temp_status === TEMP_STATUS.INIT && existing.temp_initiator_user_id !== me.id) {
      return errorMsg('CONVERSATION_NOT_FOUND', 404);
    }
    return json({
      conversationId: existing.id,
      status: existing.status || STATUS.ACTIVE,
      tempStatus: existing.temp_status,
      tempInitiatorId: existing.temp_initiator_user_id,
      iAmInitiator: existing.temp_initiator_user_id === me.id,
      quota: quotaOf(existing, me.id),
    });
  }

  const created = await dbCreateTempConversation(db, studentUserId, teacherUserId, me.id);
  if (!created || !created.id) return errorMsg('SERVER_ERROR', 500);
  const conversationId = created.id;
  let tempStatus = created.temp_status || TEMP_STATUS.INIT;
  let quota = 1;

  const firstMessage = String(body && body.firstMessage != null ? body.firstMessage : '').trim();
  if (firstMessage) {
    if (firstMessage.length > LIMITS.TEMP_FIRST_MSG_MAX) return errorMsg('INVALID_PARAMS', 400);
    // Atomic: first message + init→sent advance in the SAME db.batch (I-24 first-message path).
    // The message insert is CAS-guarded (dbPrepareTempMessageInsert) so it only lands while the row is
    // still 'init'; a concurrent duplicate create that already moved it to 'sent' wins the advance and
    // this insert no-ops — idempotent reuse, not an error.
    const advanceIdx = 1; // stmts: [message insert, advance] — advance is the last statement
    const stmts = [
      dbPrepareTempMessageInsert(db).bind(conversationId, me.id, 'text', firstMessage, '', '', null, conversationId, TEMP_STATUS.INIT),
      dbPrepareTempAdvance(db).bind(TEMP_STATUS.SENT, conversationId, TEMP_STATUS.INIT),
    ];
    try {
      const results = await db.batch(stmts);
      const advanceChanges = (results[advanceIdx] && results[advanceIdx].meta && results[advanceIdx].meta.changes) || 0;
      if (advanceChanges === 0) {
        // CAS lost: the row is already past init. Return the current reuse shape (no message landed).
        return json({ conversationId, status: STATUS.ACTIVE, tempStatus: TEMP_STATUS.SENT, tempInitiatorId: me.id, iAmInitiator: true, quota: 0 });
      }
    }
    catch (e) { console.error('temp create batch failed:', e && e.message); return errorMsg('SERVER_ERROR', 500); }
    tempStatus = TEMP_STATUS.SENT;
    quota = 0;
  }
  return json({ conversationId, status: STATUS.ACTIVE, tempStatus, tempInitiatorId: me.id, iAmInitiator: true, quota });
}

export async function handleGetConversations(db, url, req) {
  const { user: me, err } = await requireUser(db, req);
  if (err) return err;
  const conversations = await dbGetMyConversations(db, me.id);
  // I-17 (interfaces.md §19): camelCase contract row. The peer is the opposite party of the
  // two-party tuple (one student + one teacher); otherName is the peer display name (teacher_name
  // preferred when the peer is a teacher, username fallback via the repo SQL) and avatar the peer
  // avatar. The raw snake_case columns are intentionally not spread — the API surface is the contract.
  return json({ conversations: conversations.map(c => {
    const peerIsTeacher = c.student_user_id === me.id; // I am the student → the peer is the teacher
    const otherName = peerIsTeacher ? (c.teacher_name || c.student_name || '') : (c.student_name || c.teacher_name || '');
    const avatar = peerIsTeacher ? (c.teacher_avatar || c.student_avatar || '') : (c.student_avatar || c.teacher_avatar || '');
    return {
      conversationId: c.id,
      status: c.status,
      otherName,
      avatar,
      // Image/file messages carry no text preview (same rule as the repo last_body CASE).
      lastMessage: c.last_kind && (c.last_kind === 'image' || c.last_kind === 'file') ? '' : (c.last_body || ''),
      lastMessageKind: c.last_kind || null,
      lastAt: c.last_at || null,
      unread: Number(c.unread_count) || 0,
      tempStatus: c.temp_status || null,
      tempInitiatorId: c.temp_initiator_user_id || null,
      iAmInitiator: !!c.temp_initiator_user_id && c.temp_initiator_user_id === me.id,
      // I-17 quota semantics: quota = original temp allocation (TEMP_SEND_QUOTA), quotaRemaining =
      // what the current user still has (quotaOf); both null for a formal conversation.
      quota: c.temp_status ? LIMITS.TEMP_SEND_QUOTA : null,
      quotaRemaining: quotaOf({ temp_status: c.temp_status, temp_initiator_user_id: c.temp_initiator_user_id }, me.id),
    };
  }) });
}

// AI-7: unified relationship list — aggregate by two-party tuple (conversation state / last message /
// latest contracts status / peer info), for the relation graph / relationship management. Read-only.
// Peer role is derived from me.role (a conversation's two parties are always one student + one teacher).
export async function handleGetMyRelations(db, req) {
  const { user: me, err } = await requireUser(db, req);
  if (err) return err;
  const rows = await dbGetMyRelations(db, me.id);
  return json({ relations: rows.map(r => {
    const isStudent = r.student_user_id === me.id;
    return {
      conversationId: r.id,
      status: r.status,
      // S2-T4 (I-15): expose temp fields on the relation object.
      tempStatus: r.temp_status || null,
      tempInitiatorId: r.temp_initiator_user_id || null,
      other: {
        id: isStudent ? r.teacher_user_id : r.student_user_id,
        role: isStudent ? ROLES.TEACHER : ROLES.STUDENT,
        name: isStudent ? r.teacher_name : r.student_name,
        avatar: isStudent ? r.teacher_avatar : r.student_avatar,
      },
      last: r.last_kind ? { kind: r.last_kind, body: r.last_body || '', at: r.last_at, senderId: r.last_sender } : null,
      // I-15: signing is the latest contracts row (or null); consumed by M4 for contract gray-out.
      signing: r.sc_id ? {
        id: r.sc_id, contractStatus: r.sc_contract_status, revoked: Number(r.sc_revoked),
      } : null,
    };
  }) });
}

// DELETE /api/admin/relations — admin relation purge (AI-8): delete the conversation by tuple.
// messages cascade via FK ON DELETE CASCADE (chat/schema.js MESSAGES_DDL); standalone contracts have no
// conversation FK (S5) so they survive. S3 single-subject: demands are not released with the delete.
// Reviews survive too (reviews FK points at users, not conversations) — public reviewed content, deleting
// it would corrupt rating history (deliberate decision).
export async function handleAdminDeleteRelation(db, body, req) {
  const { admin, err } = await requireAdmin(db, req);
  if (err) return err;
  const s = body && body.studentUserId, t = body && body.teacherUserId;
  // C5 严格解析：正整数白名单（拒绝 NaN/负/小数/字符串注入，同 parseIdParam 语义）
  if (!Number.isInteger(s) || s <= 0 || !Number.isInteger(t) || t <= 0) return errorMsg('INVALID_PARAMS', 400);
  const conv = await dbGetConversationByTuple(db, s, t);
  if (!conv) return errorMsg('CONVERSATION_NOT_FOUND', 404);
  // P12：admin 永删关系 = 危险操作（删会话 + 级联消息/合同），须 capToken 二次认证（同 handleAdminRemoveContract 口径）
  if (!(await confirmDangerOtp(db, req, body))) return errorMsg('REAUTH_FAILED', 403);
  await dbDeleteConversation(db, conv.id);
  await logEvent(db, { action: 'admin.relation.remove', actorUserId: admin.id, actorUsername: admin.username,
    actorRole: 'admin', entity: 'conversation', entityId: conv.id,
    detail: { studentUserId: s, teacherUserId: t, demandId: conv.demand_id, status: conv.status }, req });
  return json({ ok: true });
}

// 标记已读：我的已读游标推到该会话最新一条（红点点掉即消的后端支撑）
export async function handleMarkRead(db, convId, body, req) {
  const { user: me, err } = await requireUser(db, req);
  if (err) return err;
  const g = await loadConversationFor(db, convId, me.id);
  if (g.err) return g.err;
  await dbMarkConversationRead(db, convId, me.id);
  return json({ ok: true });
}

export async function handleGetMessages(db, convId, url, req) {
  const { user: me, err } = await requireUser(db, req);
  if (err) return err;
  const sinceId = parseInt(url.searchParams.get('sinceId')) || 0;
  const g = await loadConversationFor(db, convId, me.id);
  if (g.err) return g.err;

  const messages = await dbGetMessages(db, convId, sinceId);
  // 缩略图加密落库，出门解密（附件大字段仍懒加载走 attachment 接口，thumb 小字段随列表）
  for (const m of messages) {
    if (m.thumb) { try { m.thumb = await decryptField(m.thumb); } catch { m.thumb = ''; } }
  }
  // 已读游标不下发（db.js 自述契约）：双方 last_read_id 属隐私，剥除再回传
  const { student_last_read_id, teacher_last_read_id, temp_status, temp_initiator_user_id, ...convPub } = g.conv;
  // S2-T5 (I-18): expose temp fields on the detail conversation object (camelCase, raw columns stripped).
  const convOut = {
    ...convPub,
    tempStatus: temp_status || null,
    tempInitiatorId: temp_initiator_user_id || null,
  };
  return json({ conversation: convOut, messages });
}

// GET /api/conversations/:cid/messages/:mid/attachment —— 单条附件懒加载
// （列表接口不下发图片/文件的 dataURL 本体，前端先渲染骨架，页面可操作后逐条补载）
export async function handleGetAttachment(db, convId, messageId, url, req) {
  const { user: me, err } = await requireUser(db, req);
  if (err) return err;
  const g = await loadConversationFor(db, convId, me.id);
  if (g.err) return g.err;
  const m = await dbGetMessageAttachment(db, messageId, convId);
  if (!m) return errorMsg('CONVERSATION_NOT_FOUND', 404);
  return json({ body: await decryptField(m.body), name: m.name || '' }); // N-05：附件密文出门解密
}

// POST /api/uploads —— 文件进入暂存区即真实上传（前端 XHR upload.onprogress = 本请求进度），
// 只暂存不入会话；发送时凭 uploadId 确认落入会话
export async function handleCreateUpload(db, body, req) {
  const { user: me, err } = await requireUser(db, req);
  if (err) return err;
  const kind = body.kind === 'image' ? 'image' : 'file';
  const content = String(body.fileData ?? '');
  const prefixOk = kind === 'image' ? content.startsWith('data:image/') : content.startsWith('data:');
  if (!prefixOk || content.length > LIMITS.FILE_MAX_BYTES) return errorMsg('FILE_TOO_LARGE');
  if (fileDataBlocked(content)) return errorMsg('FILE_TYPE_BLOCKED'); // svg/html 黑名单对图片同样生效
  // 缩略图（仅图片携带）：data:image 前缀 + 小体积钳制（防刷大字段）+ 黑名单同款拦截
  const thumbRaw = kind === 'image' ? String(body.thumb ?? '') : '';
  if (thumbRaw && (!thumbRaw.startsWith('data:image/') || thumbRaw.length > LIMITS.THUMB_MAX_BYTES)) return errorMsg('FILE_TOO_LARGE');
  if (thumbRaw && fileDataBlocked(thumbRaw)) return errorMsg('FILE_TYPE_BLOCKED');
  const name = sanitizeFileName(body.fileName); // Q-2d-F4：净化路径分隔/控制字符后落库
  // 暂存区配额自愈 + 上限：先清本人滞留暂存件（窗口见 LIMITS.STALE_UPLOAD_WINDOW），再按每人封顶（防弃传暂存填满库 / 刷大字段）
  await dbPurgeStaleUploads(db, me.id);
  if ((await dbCountUploads(db, me.id)) >= LIMITS.UPLOAD_STAGING_MAX) return errorMsg('UPLOAD_STAGING_LIMIT'); // 快路径
  // 网安 N-05：附件 dataURL 加密落库（暂存区与消息正文同口径；发送落消息时密文原样搬移，不再二次加密）；缩略图同款加密
  const contentEnc = await encryptField(content);
  const thumbEnc = thumbRaw ? await encryptField(thumbRaw) : '';
  const id = await dbCreateUpload(db, me.id, kind, contentEnc, name, thumbEnc); // 条件 INSERT 原子化：0 = 并发已满配额（TOCTOU 缺口补）
  if (!id) return errorMsg('UPLOAD_STAGING_LIMIT');
  return json({ id }, 201);
}

// DELETE /api/uploads/:id —— 移除暂存项（删已上传的文件，仅本人）
export async function handleDeleteUpload(db, uploadId, body, req) {
  const { user: me, err } = await requireUser(db, req);
  if (err) return err;
  const u = await dbGetUpload(db, uploadId);
  if (!u || u.user_id !== me.id) return errorMsg('NO_PERMISSION', 403);
  await dbDeleteUpload(db, uploadId);
  return json({ ok: true });
}

export async function handleSendMessage(db, convId, body, req) {
  const { user: me, err } = await requireUser(db, req);
  if (err) return err;
  const userId = me.id;
  const g = await loadConversationFor(db, convId, userId);
  if (g.err) return g.err;
  if (g.conv.status !== STATUS.ACTIVE) return errorMsg('NO_PERMISSION', 403);

  // 批量发送——一次写往返落多条（暂存附件确认 + 文字），2N+1 串行写 → 1。
  // 前端暂存附件已上传（带进度），发送阶段只凭 uploadId 落消息 + 删暂存；整批单事务 db.batch。
  // 单消息分支（body.body / body.uploadId / fileData 直发）已无前端调用者（前端恒发
  // batch），按「不保留向后兼容」连根删——text/image/file 直发语义全部由 batch 项覆盖。
  if (!Array.isArray(body.batch)) return errorMsg('INVALID_PARAMS', 400);
  return handleSendBatch(db, convId, body.batch, userId, req, g.conv);
}

// 批量发送——附件确认 + 文字一次 db.batch 落库（单事务）。
// 往返口径（审计修正）：写落库 1 次往返；附件归属读经 dbGetUploads WHERE IN 一次单查（N 读 → 1，
// 同 B5 模式），总往返 = 1 读 + 1 写批（边界受 MSG_BATCH_MAX=13 封顶）。
// 校验与单条路径同口径（归属/长度），任一校验失败整批 400/404（不落半批）；db.batch 失败整体回滚。
// INSERT SQL 收口 db.js 单源（dbPrepareMessageInsert）——自持一份会加列双处漂移。
// S2-T6 (I-24): temp conversation send-path state machine — the temp transition statement is appended
// to the SAME db.batch as the message inserts so the state change is atomic with the message landing.
//   - temp_status='init': only the initiator may send (non-initiator is already 404'd by the init gate
//     in loadConversationFor). This is the first message → advance init→sent in the same batch.
//   - temp_status='sent': initiator is over-quota → 409 TEMP_QUOTA_EXCEEDED; the receiver's reply
//     formalizes → advance sent→NULL (temp_initiator retained as wasTemp).
// The advance statement sits after all message statements, so the `created` resultIndex mapping
// (recorded before the advance is pushed) is unaffected.
async function handleSendBatch(db, convId, batch, userId, req, conv) {
  if (!batch.length || batch.length > LIMITS.MSG_BATCH_MAX) return errorMsg('INVALID_PARAMS', 400);
  // 第一遍（for...of 保留 return 语义）：文字项校验 + 收集附件 id（非数字/重复整批拒绝）+ 逐项幂等键
  const uploadIds = [];
  const seenUploads = new Set(); // 审计 C-4：重复 uploadId 整批拒绝（防同附件双消息双删 + 乐观批序错位）
  const seenClientKeys = new Set(); // PA-1c-F2 (C-4): duplicate clientKey in one batch → 400, not a 500 on idx_messages_client_key
  const clientKeys = batch.map(it => (it && typeof it.clientKey === 'string' ? it.clientKey.slice(0, LIMITS.CLIENT_KEY_MAX) : '')); // Q-2d-F2：空/非串视为不带键
  for (let i = 0; i < batch.length; i++) {
    const item = batch[i];
    const ck = clientKeys[i]; // PA-1c-F2: normalized per-item key; '' = no key (not deduped)
    if (ck && seenClientKeys.has(ck)) return errorMsg('INVALID_PARAMS', 400);
    if (ck) seenClientKeys.add(ck);
    if (item && item.uploadId) {
      const upId = parseInt(item.uploadId);
      if (Number.isNaN(upId) || seenUploads.has(upId)) return errorMsg('INVALID_PARAMS', 400);
      seenUploads.add(upId);
      uploadIds.push(upId);
    } else if (item && item.kind === 'text') {
      const content = String(item.body ?? '').trim();
      if (!content) return errorMsg('INVALID_PARAMS', 400); // Q-2d-F3：空消息是参数错误，不是"太长"
      if (content.length > LIMITS.MESSAGE_MAX_LEN) return errorMsg('MESSAGE_TOO_LONG');
    } else {
      return errorMsg('INVALID_PARAMS', 400);
    }
  }
  // Q-2d-F2 幂等去重：整批全部带非空键且全部已落库 → 视为超时重发，返回既有回执（不重复落库、
  // 不重复删暂存——首次成功已删 uploads，重发若再查附件归属必 404，早退是唯一正确路径）。
  // 部分命中 = 键被复用的异常形状（客户端内容指纹已防）→ 409 拒绝，防半新半旧混插。
  if (clientKeys.every(k => k)) {
    const existing = await dbGetMessagesByClientKeys(db, convId, userId, clientKeys);
    if (existing.length === batch.length) {
      const byKey = new Map(existing.map(e => [e.client_key, e]));
      return json({ messages: clientKeys.map(k => {
        const e = byKey.get(k);
        return { id: Number(e ? e.id : 0), kind: e ? e.kind : '', name: e ? e.name || '' : '', clientKey: k };
      }) }, 201);
    }
    if (existing.length) return errorMsg('INVALID_PARAMS', 409);
  }

  // S2-T6 (I-24): temp conversation send-path state machine.
  //   - init: only the initiator can reach here (non-initiator is 404'd by the init gate in
  //     loadConversationFor). First message → advance init→sent in the same batch.
  //   - sent: initiator already used quota → 409; receiver reply formalizes → advance sent→NULL.
  const tempStatus = conv && conv.temp_status;
  let tempAdvance = null; // { next, current } | null (appended to the same db.batch)
  let tempConvStatus = null; // 'temp' | 'active' | null (added to the response)
  if (tempStatus) {
    if (tempStatus === TEMP_STATUS.INIT) {
      // I-24 (PA-1c-F1): the initiator's temp quota is exactly one message. The temp-advance CAS
      // guard only validates temp_status, not how many messages ride the batch, so an unguarded
      // multi-item batch would blast up to MSG_BATCH_MAX messages at a stranger. Non-initiators
      // are 404'd in loadConversationFor, so reaching here with init implies the sender is the
      // initiator — enforce batch.length === 1.
      if (batch.length !== 1) return errorMsg('INVALID_PARAMS', 400);
      tempAdvance = { next: TEMP_STATUS.SENT, current: TEMP_STATUS.INIT };
      tempConvStatus = 'temp';
    } else if (tempStatus === TEMP_STATUS.SENT) {
      if (conv.temp_initiator_user_id === userId) return errorMsg('TEMP_QUOTA_EXCEEDED', 409);
      tempAdvance = { next: null, current: TEMP_STATUS.SENT };
      tempConvStatus = 'active';
    }
  }

  // Second pass: attachment ownership single query (B5: N serial dbGetUpload → one WHERE IN).
  const uploadRows = uploadIds.length ? await dbGetUploads(db, uploadIds) : [];
  const uploadById = new Map(uploadRows.map(u => [u.id, u]));
  const stmts = [];
  const items = []; // { resultIndex, kind, name }
  for (let i = 0; i < batch.length; i++) {
    const item = batch[i];
    if (item && item.uploadId) {
      const up = uploadById.get(parseInt(item.uploadId));
      if (!up || up.user_id !== userId) return errorMsg('CONVERSATION_NOT_FOUND', 404);
      items.push({ resultIndex: stmts.length, kind: up.kind, name: up.name });
      if (tempAdvance) {
        // S2-T6: CAS-guarded — the message only lands while temp_status is still tempAdvance.current,
        // and a lost temp batch must not destroy the sender's staged upload.
        stmts.push(dbPrepareTempMessageInsert(db).bind(convId, userId, up.kind, up.body, up.name, up.thumb, clientKeys[i] || null, convId, tempAdvance.current));
        stmts.push(dbPrepareTempUploadDelete(db).bind(up.id, userId, convId, tempAdvance.current));
      } else {
        stmts.push(dbPrepareMessageInsert(db).bind(convId, userId, up.kind, up.body, up.name, up.thumb, clientKeys[i] || null)); // ciphertext carried over from uploads
        stmts.push(dbPrepareUploadDelete(db).bind(up.id, userId)); // Z-4-F2: ownership-scoped DELETE (id+user_id)
      }
    } else if (item && item.kind === 'text') {
      const content = String(item.body ?? '').trim();
      items.push({ resultIndex: stmts.length, kind: 'text', name: '' });
      if (tempAdvance) {
        stmts.push(dbPrepareTempMessageInsert(db).bind(convId, userId, 'text', content, '', '', clientKeys[i] || null, convId, tempAdvance.current));
      } else {
        stmts.push(dbPrepareMessageInsert(db).bind(convId, userId, 'text', content, '', '', clientKeys[i] || null));
      }
    }
  }
  // Temp transition stmt appended AFTER all message stmts so items[].resultIndex stays correct
  // (the advance stmt result is mapped separately, not into `created`).
  let advanceIdx = -1;
  if (tempAdvance) {
    advanceIdx = stmts.length;
    stmts.push(dbPrepareTempAdvance(db).bind(tempAdvance.next, convId, tempAdvance.current));
  }
  let results;
  try { results = await db.batch(stmts); }
  catch (e) { console.error('send batch failed:', e && e.message); return errorMsg('SERVER_ERROR', 500); }
  // S2-T6: the temp transition is CAS-guarded. If the advance lost (changes=0), a concurrent send won the
  // transition — the guarded inserts no-oped in the same transaction (nothing landed) and the guarded
  // upload delete did not destroy the staged upload. Clean loser path → 409.
  if (tempAdvance && ((results[advanceIdx] && results[advanceIdx].meta && results[advanceIdx].meta.changes) || 0) === 0) {
    return errorMsg('TEMP_QUOTA_EXCEEDED', 409);
  }
  const created = items.map((it, i) => ({
    id: Number((results[it.resultIndex] && results[it.resultIndex].meta && results[it.resultIndex].meta.last_row_id) || 0),
    kind: it.kind, name: it.name,
    // PA-2-F3: echo the idempotency key so the front-end can replace its optimistic
    // pending row (realByKey in chat/logic/send.js) — without this the client shows
    // every own message twice (optimistic row + polled real row, ids never dedupe).
    clientKey: clientKeys[i] || '',
  }));
  await logEvent(db, { action: 'chat.send_batch', actorUserId: userId, entity: 'conversation', entityId: convId,
    detail: { count: created.length, kinds: created.map(c => c.kind) }, req });
  const out = { messages: created };
  if (tempConvStatus) { out.tempQuota = 0; out.convStatus = tempConvStatus; }
  return json(out, 201);
}

// ============================================================
// chat 域路由表（V-1-4c：会话 / 消息 / 附件）
// ============================================================
const S = (method, path, handler) => ({ method, path, handler });
export const routes = [
  S('GET', '/api/conversations', c => handleGetConversations(c.db, c.url, c.req)),
  S('POST', '/api/conversations/temp', c => handleCreateTempConversation(c.db, c.body, c.req)),
  S('GET', '/api/my-relations', c => handleGetMyRelations(c.db, c.req)),
  S('DELETE', '/api/admin/relations', c => handleAdminDeleteRelation(c.db, c.body, c.req)),
  S('POST', '/api/conversations/:id/close', c => handleCloseConversation(c.db, parseIdParam(c.params.id), c.body, c.req)),
  S('POST', '/api/conversations/:id/read', c => handleMarkRead(c.db, parseIdParam(c.params.id), c.body, c.req)),
  S('GET', '/api/conversations/:id/messages', c => handleGetMessages(c.db, parseIdParam(c.params.id), c.url, c.req)),
  S('POST', '/api/conversations/:id/messages', c => handleSendMessage(c.db, parseIdParam(c.params.id), c.body, c.req)),
  S('GET', '/api/conversations/:id/messages/:mid/attachment', c => handleGetAttachment(c.db, parseIdParam(c.params.id), parseIdParam(c.params.mid), c.url, c.req)),
  S('POST', '/api/uploads', c => handleCreateUpload(c.db, c.body, c.req)),
  S('DELETE', '/api/uploads/:id', c => handleDeleteUpload(c.db, parseIdParam(c.params.id), c.body, c.req)),
];
