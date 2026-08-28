/**
 * Chat domain data layer (extracted from server/db.js at ): conversations / messages / uploads.
 * S5 landed the standalone contracts table (signing_contracts DROPPED) — this module has no signing layer.
 */
import { dbAll, dbGet, dbRun } from '../../core/util.js';
import { LIMITS } from '../../../shared/config.js';
import { STATUS, TEMP_STATUS } from '../../../shared/enums.js';

// 会话与消息（模块4）
// ============================================================

// 同一师生对唯一会话（UNIQUE(student,teacher)）；已存在则返回既有 id。
// 会话重启：命中 closed 行 → 重启原会话（status→active + demand 回填，历史保留）——
// 用户模型「一对师生终身一个会话对象，closed 后再次合作 = 重启原会话，非新建」；双调用点
// （意向/推送接受）经同一元组命中即重启。重启不重设已读游标/不删历史（历史保留）。
export async function dbUpsertConversation(db, studentUserId, teacherUserId, demandId) {
  await dbRun(db,
    'INSERT OR IGNORE INTO conversations (student_user_id, teacher_user_id, demand_id) VALUES (?,?,?)',
    [studentUserId, teacherUserId, demandId || null]);
  const row = await dbGet(db,
    'SELECT id, demand_id, status FROM conversations WHERE student_user_id=? AND teacher_user_id=?',
    [studentUserId, teacherUserId]);
  // closed → 重启（条件 UPDATE 幂等：并发双配对只一次生效；demand 回填为新合作需求）
  if (row && row.status === STATUS.CLOSED) {
    await dbRun(db, "UPDATE conversations SET status='active', demand_id=? WHERE id=? AND status='closed'",
      [demandId || null, row.id]);
  } else if (row && !row.demand_id && demandId) {
    // INSERT OR IGNORE 命中既有会话时不更新任何列——旧会话 demand_id 为空必须回填，
    // 否则教师起草合同选不到需求（会话需求绑定丢失事故根因）
    await dbRun(db, 'UPDATE conversations SET demand_id=? WHERE id=?', [demandId, row.id]);
  }
  return row?.id || null;
}

export async function dbGetConversationById(db, id) {
  return await dbGet(db, 'SELECT * FROM conversations WHERE id=?', [id]);
}

// 按双方元组查会话（admin 永删关系定位用；与会话唯一约束 UNIQUE(student,teacher) 一致）
// S2-T3: tuple lookup also returns temp fields so api.js can decide formal reopen vs temp reuse ().
export async function dbGetConversationByTuple(db, studentUserId, teacherUserId) {
  return await dbGet(db,
    'SELECT id, demand_id, status, temp_status, temp_initiator_user_id FROM conversations WHERE student_user_id=? AND teacher_user_id=?',
    [studentUserId, teacherUserId]);
}

// S2-T3: temp conversation create (). INSERT OR IGNORE so a concurrent duplicate tuple resolves
// to the existing row (same pattern as dbUpsertConversation). A pre-existing formal conversation
// (temp_status NULL) is returned unchanged — api.js decides formal reopen vs temp reuse from the
// tuple lookup. Returns { id, temp_status, temp_initiator_user_id }, or null only on an impossible
// state (no row found after the insert).
export async function dbCreateTempConversation(db, studentUserId, teacherUserId, initiatorUserId) {
  await dbRun(db,
    `INSERT OR IGNORE INTO conversations (student_user_id, teacher_user_id, status, temp_status, temp_initiator_user_id)
     VALUES (?,?,?,?,?)`,
    [studentUserId, teacherUserId, STATUS.ACTIVE, TEMP_STATUS.INIT, initiatorUserId]);
  const row = await dbGetConversationByTuple(db, studentUserId, teacherUserId);
  if (!row) return null;
  return { id: row.id, temp_status: row.temp_status, temp_initiator_user_id: row.temp_initiator_user_id };
}

// S2-T6: prepared advance for the temp state machine (init -> sent -> NULL). api.js binds
// (next, convId, current) inside the same db.batch as the message insert so the transition is
// atomic with the first message landing. changes>0 = transition won; changes=0 = row already moved
// (concurrent/replay) and the caller skips temp-specific side effects.
export function dbPrepareTempAdvance(db) {
  return db.prepare('UPDATE conversations SET temp_status=? WHERE id=? AND temp_status=?');
}

// delete conversation (admin relation purge; messages cascade via FK ON DELETE CASCADE —
// chat/schema.js MESSAGES_DDL). Standalone contracts have no conversation FK (S5) so they survive.
export async function dbDeleteConversation(db, conversationId) {
  return await dbRun(db, 'DELETE FROM conversations WHERE id=?', [conversationId]);
}

// 会话行 + 双方用户名（合同模块的通知文案 / 对方判定 helper 共用；student_name/teacher_name 随行附带）
export async function dbGetConversationWithNames(db, conversationId) {
  return await dbGet(db, `SELECT c.*, us.username AS student_name, ut.username AS teacher_name
    FROM conversations c
    JOIN users us ON us.id = c.student_user_id
    JOIN users ut ON ut.id = c.teacher_user_id
    WHERE c.id = ?`, [conversationId]);
}

// My participating conversations list (peer usernames + last-message preview + temp status).
// S2-T4 temp visibility (): init rows visible only to the initiator; sent/formal rows visible to both participants.
export async function dbGetMyConversations(db, userId) {
  // unread_count：对方发的、id 大于「我这一侧已读游标」的消息数（游标按我在会话中的角色取列）
  // contracted 字段连根拔——原仅供「签约确认后背景灰字提示」（.chat-sign-tip）判定，
  // 提示已并入签约请求气泡底下（status='signed' 模板渲染），会话列表字段无消费者后删除。
  // 显式列集（不用 c.*）：双方已读游标（student_last_read_id/teacher_last_read_id）不下发，
  // 避免向对方暴露己方已读位置（低敏信息泄露面收口）
  // /teacher_name 取教师公开名（teacher_profiles.teacher_name 空回退 username）。
  return await dbAll(db, `SELECT c.id, c.student_user_id, c.teacher_user_id, c.demand_id, c.status, c.created_at,
      c.temp_status, c.temp_initiator_user_id,
      us.username AS student_name, COALESCE(NULLIF(tp.teacher_name, ''), ut.username) AS teacher_name,
      us.avatar AS student_avatar, ut.avatar AS teacher_avatar,
      CASE WHEN lm.kind IN ('image','file') THEN '' ELSE lm.body END AS last_body,
      lm.kind AS last_kind, lm.created_at AS last_at, lm.sender_user_id AS last_sender,
      (SELECT COUNT(*) FROM messages m WHERE m.conversation_id=c.id AND m.sender_user_id<>?
        AND m.id > (CASE WHEN c.student_user_id=? THEN c.student_last_read_id ELSE c.teacher_last_read_id END)
      ) AS unread_count
    FROM conversations c
    JOIN users us ON us.id=c.student_user_id
    JOIN users ut ON ut.id=c.teacher_user_id
    LEFT JOIN teacher_profiles tp ON tp.user_id = ut.id
    LEFT JOIN (
      SELECT m.conversation_id, m.body, m.kind, m.created_at, m.sender_user_id
      FROM messages m JOIN (
        SELECT conversation_id, MAX(id) AS mid FROM messages
        WHERE conversation_id IN (SELECT id FROM conversations WHERE student_user_id=? OR teacher_user_id=?) -- 最近消息聚合限定本用户会话集，全表 GROUP BY → 会话集内
        GROUP BY conversation_id) x
        ON x.mid=m.id
    ) lm ON lm.conversation_id=c.id
    WHERE (c.student_user_id=? OR c.teacher_user_id=?)
      AND (c.temp_status IS NULL OR c.temp_status <> 'init' OR c.temp_initiator_user_id = ?) -- S2-T4: init rows hidden from non-initiators (existence-leak prevention); sent/formal visible to both participants
    ORDER BY COALESCE(lm.created_at, c.created_at) DESC`, [userId, userId, userId, userId, userId, userId, userId]);
}

// unified relationship list — aggregate by two-party tuple (conversation + last message + latest
// contracts status), for the relation graph / relationship management. Read-only.
// The conversation is the tuple (UNIQUE(student,teacher)) one-to-one; the latest contract status is taken
// by tuple MAX(id) (contracts.conversation_id may be NULL for standalone rows, matching cascade scope).
// Explicit column list (not c.*): read cursors (student_last_read_id/teacher_last_read_id) are not exposed
// (same low-sensitivity leak closure as dbGetMyConversations).
export async function dbGetMyRelations(db, userId) {
  return await dbAll(db, `SELECT c.id, c.student_user_id, c.teacher_user_id, c.status, c.created_at,
      c.temp_status, c.temp_initiator_user_id,
      us.username AS student_name, ut.username AS teacher_name,
      us.avatar AS student_avatar, ut.avatar AS teacher_avatar,
      CASE WHEN lm.kind IN ('image','file') THEN '' ELSE lm.body END AS last_body,
      lm.kind AS last_kind, lm.created_at AS last_at, lm.sender_user_id AS last_sender,
      sc.id AS sc_id, sc.contract_status AS sc_contract_status, sc.revoked AS sc_revoked
    FROM conversations c
    JOIN users us ON us.id=c.student_user_id
    JOIN users ut ON ut.id=c.teacher_user_id
    LEFT JOIN (
      SELECT m.conversation_id, m.body, m.kind, m.created_at, m.sender_user_id
      FROM messages m JOIN (
        SELECT conversation_id, MAX(id) AS mid FROM messages
        WHERE conversation_id IN (SELECT id FROM conversations WHERE student_user_id=? OR teacher_user_id=?)
        GROUP BY conversation_id) x
        ON x.mid=m.id
    ) lm ON lm.conversation_id=c.id
    LEFT JOIN contracts sc ON sc.id = (
      SELECT MAX(id) FROM contracts sc2
      WHERE sc2.student_user_id=c.student_user_id AND sc2.teacher_user_id=c.teacher_user_id)
    WHERE (c.student_user_id=? OR c.teacher_user_id=?)
      AND (c.temp_status IS NULL OR c.temp_status <> 'init' OR c.temp_initiator_user_id = ?) -- I-24: init rows hidden from non-initiators (same rule as dbGetMyConversations S2-T4); sent/formal visible to both participants
    ORDER BY COALESCE(lm.created_at, c.created_at) DESC`, [userId, userId, userId, userId, userId]);
}

// 标记已读：把我在该会话的已读游标推到最新一条消息（按角色更新对应列）
export async function dbMarkConversationRead(db, convId, userId) {
  await dbRun(db, `UPDATE conversations SET
      student_last_read_id=CASE WHEN student_user_id=? THEN (SELECT COALESCE(MAX(id),0) FROM messages WHERE conversation_id=?) ELSE student_last_read_id END,
      teacher_last_read_id=CASE WHEN teacher_user_id=? THEN (SELECT COALESCE(MAX(id),0) FROM messages WHERE conversation_id=?) ELSE teacher_last_read_id END
    WHERE id=?`, [userId, convId, userId, convId, convId]);
}

export async function dbGetMessages(db, convId, sinceId = 0, limit = LIMITS.MSG_LIMIT) {
  // 图片/文件消息不在列表查询里下发 dataURL 本体（大字段懒加载，走 attachment 接口）；
  // 缩略图随列表下发（小字段）：thumb 列（加密）由路由层解密；图片无缩略图（历史数据）回 ''
  // 初始加载（sinceId=0）取最近 limit 条——先 DESC 取最新再反转成升序（前端按序渲染
  // 并取末条 id 作轮询游标）；旧实现 sinceId=0 取最早 limit 条，长会话一打开就掉进最早历史，
  // 轮询从最末条接续直接跳号断带。增量轮询（sinceId>0）保持升序追加新消息。
  const rows = await dbAll(db, `SELECT m.id, m.conversation_id, m.sender_user_id, m.kind, m.name, m.created_at,
      CASE WHEN m.kind IN ('image','file') THEN '' ELSE m.body END AS body,
      CASE WHEN m.kind='image' THEN m.thumb ELSE '' END AS thumb
    FROM messages m
    WHERE m.conversation_id=? AND m.id>? ORDER BY m.id ${sinceId ? 'ASC' : 'DESC'} LIMIT ?`, [convId, sinceId, limit]);
  return sinceId ? rows : rows.reverse();
}

// messages INSERT 单源：路由层批量发送不得自持 SQL 直插——
// 数据层单写原则旁支通路，messages 加列时两处只改一处必静默缺列。业务 SQL 只此一份，批量经
// dbPrepareMessageInsert 取预编译语句，单条经 dbCreateMessage 落库。
const MSG_INSERT_SQL = 'INSERT INTO messages (conversation_id, sender_user_id, kind, body, name, thumb, client_key) VALUES (?,?,?,?,?,?,?)';
export function dbPrepareMessageInsert(db) { return db.prepare(MSG_INSERT_SQL); }

export async function dbCreateMessage(db, convId, senderUserId, kind, body, name = '', thumb = '') { // 缩略图随消息落库
  const result = await dbRun(db, MSG_INSERT_SQL, [convId, senderUserId, kind, body, name, thumb, null]); // 非 chat 域（合同/签约气泡）不带幂等键
  return Number(result.meta.last_row_id);
}

// 按幂等键批量查已落消息（handleSendBatch 去重判据——键全命中 = 超时重发，返回既有回执）
export async function dbGetMessagesByClientKeys(db, convId, userId, keys) {
  if (!keys || !keys.length) return [];
  const placeholders = keys.map(() => '?').join(',');
  return await dbAll(db,
    `SELECT id, kind, name, client_key FROM messages
     WHERE conversation_id=? AND sender_user_id=? AND client_key IN (${placeholders})`,
    [convId, userId, ...keys]);
}

// 管理员删除消息前置查询：取会话/发送者/类型供留档
export async function dbGetMessageById(db, messageId) {
  return await dbGet(db, 'SELECT id, conversation_id, sender_user_id, kind FROM messages WHERE id=?', [messageId]);
}

// 单条附件懒加载取 body（图片/文件大字段不随列表下发，气泡骨架渲染后逐条补载）
export async function dbGetMessageAttachment(db, messageId, conversationId) {
  return await dbGet(db, 'SELECT body, name FROM messages WHERE id=? AND conversation_id=?', [messageId, conversationId]);
}

export async function dbDeleteMessage(db, messageId) {
  return dbRun(db, 'DELETE FROM messages WHERE id=?', [messageId]);
}

// S2-T6: CAS-guarded message insert for the temp state machine — the message only lands while the
// conversation is still in the expected temp_state (mirrors dbPrepareTempAdvance's WHERE guard), so a
// concurrent send that lost the transition inserts 0 rows (no ghost message past quota).
export function dbPrepareTempMessageInsert(db) {
  return db.prepare(`INSERT INTO messages (conversation_id, sender_user_id, kind, body, name, thumb, client_key)
    SELECT ?,?,?,?,?,?,?
    WHERE (SELECT temp_status FROM conversations WHERE id=?) IS ?`);
}
// S2-T6: CAS-guarded upload delete — a lost temp batch must not destroy the sender's staged upload.
export function dbPrepareTempUploadDelete(db) {
  return db.prepare(`DELETE FROM uploads WHERE id=? AND user_id=?
    AND (SELECT temp_status FROM conversations WHERE id=?) IS ?`);
}

// end-relationship atomic transaction — conversation active→closed + cascading contract revoke.
// S3/S5 single-subject + standalone contracts: the signing layer is gone (signing_contracts DROPPED by
// S5); demand release no longer applies (demand status converges to open/closed, contracts do not bind
// demands). Close only revokes in-progress contracts (contract_status='signing' AND revoked=0) matched
// by the two-party tuple — the physical expression of the relationship abstraction, independent of
// conversation_id (which may be NULL for standalone rows; hits idx_contracts_tuple).
// Single db.batch, atomic. Idempotent/concurrent: the conversation UPDATE's status='active' guard is the
// winner gate (concurrent double-close → only the winner runs side effects); each cascade row's own
// conditional UPDATE is idempotent (re-close → all changes=0, zero side effects).
// Boundary (A5 terminal-state gate, guaranteed by the WHERE guards): signed contracts (contract_status
// 'signed') and already-revoked rows are not matched; the revoke marks revoked=1 + contract_status
// 'signed' + revoked_by=0 (system), following handleRevokeContract's marking semantics.
// Returns { closeWon, rejected: [], revoked: [{ id, conversation_id, changes }] } — rejected is always
// empty (no signing layer to reject); the shape is kept so callers do not crash.
export async function dbCloseConversationCascade(db, conversationId, studentUserId, teacherUserId) {
  const contracts = await dbAll(db,
    `SELECT id, conversation_id FROM contracts
     WHERE student_user_id=? AND teacher_user_id=? AND contract_status='signing' AND revoked=0`,
    [studentUserId, teacherUserId]);
  const stmts = [
    db.prepare("UPDATE conversations SET status='closed' WHERE id=? AND status='active'").bind(conversationId),
    ...contracts.map(c => db.prepare(
      `UPDATE contracts SET revoked=1, revoked_by=0, contract_status='signed', version=version+1, updated_at=datetime('now')
       WHERE id=? AND contract_status='signing' AND revoked=0`).bind(c.id)),
  ];
  const results = await db.batch(stmts);
  const changes = i => (results[i] && results[i].meta && results[i].meta.changes) || 0;
  let idx = 1;
  const revoked = contracts.map(c => ({ id: c.id, conversation_id: c.conversation_id, changes: changes(idx++) }));
  return { closeWon: changes(0) > 0, rejected: [], revoked };
}

// ============================================================
// 聊天附件暂存区（uploads）：文件拖入/选中即真实上传至此（XHR 进度），
// 发送时凭 uploadId 确认落入 messages 后删除暂存
// ============================================================
// 暂存配额自愈：清本人滞留暂存件（窗口单源自 constants.LIMITS，防弃传暂存填满库）
export async function dbPurgeStaleUploads(db, userId) {
  await dbRun(db, `DELETE FROM uploads WHERE user_id=? AND created_at < datetime('now', ?)`,
    [userId, LIMITS.STALE_UPLOAD_WINDOW]);
}

export async function dbCountUploads(db, userId) {
  const row = await dbGet(db, 'SELECT COUNT(*) AS cnt FROM uploads WHERE user_id=?', [userId]);
  return row?.cnt || 0;
}

// 上传创建原子化（网安审计 TOCTOU：配额 check-then-act 有窗口——并发上传可越过 LIMITS.UPLOAD_STAGING_MAX。
// 改为条件 INSERT：仅当本人暂存件数 < 上限才插入，changes=0 即超配额，调用方据返回 0 判定 413）
export async function dbCreateUpload(db, userId, kind, body, name, thumb = '') { // 缩略图随传
  const res = await dbRun(db,
    `INSERT INTO uploads (user_id, kind, body, name, thumb)
     SELECT ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM uploads WHERE user_id=?) < ${LIMITS.UPLOAD_STAGING_MAX}`,
    [userId, kind, body, name, thumb, userId]);
  return (res && res.meta && res.meta.changes > 0) ? Number(res.meta.last_row_id) : 0;
}

export async function dbGetUpload(db, uploadId) {
  return await dbGet(db, 'SELECT * FROM uploads WHERE id=?', [uploadId]);
}

// 批量取上传（投诉附件归属校验 N+1 → 单查 WHERE IN，上限附件配额 4）
export async function dbGetUploads(db, ids) {
  if (!ids || !ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  return await dbAll(db, `SELECT * FROM uploads WHERE id IN (${placeholders})`, ids);
}

export async function dbDeleteUpload(db, uploadId) {
  await dbRun(db, 'DELETE FROM uploads WHERE id=?', [uploadId]);
}

// 批量事务内的上传删除语句（同 dbPrepareMessageInsert 模式）：DELETE SQL 单源在 db.js，
// 路由层批量发送不得自持 SQL（加列/改表两处漂移）
export function dbPrepareUploadDelete(db) { return db.prepare('DELETE FROM uploads WHERE id=? AND user_id=?'); } // 条件 DELETE 带归属（纵深防御——上层归属校验之外的 DB 层兜底；重复/误删同 id 异主零影响）

// ============================================================
