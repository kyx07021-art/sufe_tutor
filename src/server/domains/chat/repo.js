/**
 * 聊天域数据层（V-1-4 从 server/db.js 提取）：conversations / messages / uploads / signing_requests。
 */
import { dbAll, dbGet, dbRun } from '../../core/util.js';
import { mapDemandRow } from '../demand/repo.js';
import { LIMITS } from '../../../shared/config.js';
import { STATUS } from '../../../shared/enums.js';

// 会话与消息（模块4）
// ============================================================

// 同一师生对唯一会话（UNIQUE(student,teacher)）；已存在则返回既有 id
export async function dbUpsertConversation(db, studentUserId, teacherUserId, demandId) {
  await dbRun(db,
    'INSERT OR IGNORE INTO conversations (student_user_id, teacher_user_id, demand_id) VALUES (?,?,?)',
    [studentUserId, teacherUserId, demandId || null]);
  const row = await dbGet(db,
    'SELECT id, demand_id FROM conversations WHERE student_user_id=? AND teacher_user_id=?',
    [studentUserId, teacherUserId]);
  // INSERT OR IGNORE 命中既有会话时不更新任何列——旧会话 demand_id 为空必须回填，
  // 否则教师起草合同选不到需求（会话需求绑定丢失事故根因）
  if (row && !row.demand_id && demandId) {
    await dbRun(db, 'UPDATE conversations SET demand_id=? WHERE id=?', [demandId, row.id]);
  }
  return row?.id || null;
}

export async function dbGetConversationById(db, id) {
  return await dbGet(db, 'SELECT * FROM conversations WHERE id=?', [id]);
}

// 会话行 + 双方用户名（合同模块的通知文案 / 对方判定 helper 共用；student_name/teacher_name 随行附带）
export async function dbGetConversationWithNames(db, conversationId) {
  return await dbGet(db, `SELECT c.*, us.username AS student_name, ut.username AS teacher_name
    FROM conversations c
    JOIN users us ON us.id = c.student_user_id
    JOIN users ut ON ut.id = c.teacher_user_id
    WHERE c.id = ?`, [conversationId]);
}

// 会话可绑定需求下拉单源（需求四·第2/3条：发起签约 / 起草合同共用）：
//   phase='signing'   会话学生方「开放」需求（可发起签约）
//   phase='contract'  会话学生方「已签约」需求（签约确认后可起草合同；已绑进行中/已签合同的需求除外；
//                     且须由本会话教师促成签约——被别教师 signed 签约驱动的需求不列出，
//                     防跨会话绑别教师签成的需求起草合同；同对师生换会话的 contracted 需求仍可列出）
// 归属硬约束：只取会话学生方（sd.user_id = c.student_user_id），师生身份由路由层参与方校验保证；
// 出口走 mapDemandRow（剥联系方式，师生双方均不可在绑定下拉里看到学生联系方式）
export async function dbGetConversationBindableDemands(db, conversationId, phase) {
  const cond = phase === 'contract'
    ? `AND sd.status='contracted'
       AND NOT EXISTS (SELECT 1 FROM contracts ct WHERE ct.demand_id=sd.id AND ct.status IN ('pending','signing','signed'))
       AND NOT EXISTS (SELECT 1 FROM signing_requests sr JOIN conversations c2 ON c2.id=sr.conversation_id
            WHERE sr.demand_id=sd.id AND sr.status='signed' AND c2.teacher_user_id != c.teacher_user_id)`
    : `AND sd.status='open'`;
  const rows = await dbAll(db, `
    SELECT sd.*, u.username
    FROM student_demands sd
    JOIN users u ON u.id=sd.user_id
    JOIN conversations c ON c.id=?
    WHERE sd.user_id=c.student_user_id ${cond}
    ORDER BY sd.created_at DESC, sd.id DESC`, [conversationId]);
  return rows.map(mapDemandRow);
}

// 我参与的会话列表（含对方用户名 + 最后一条消息预览 + 签约状态）
export async function dbGetMyConversations(db, userId) {
  // unread_count：对方发的、id 大于「我这一侧已读游标」的消息数（游标按我在会话中的角色取列）
  // contracted 字段连根拔——原仅供「签约确认后背景灰字提示」（.chat-sign-tip）判定，
  // 提示已并入签约请求气泡底下（status='signed' 模板渲染），会话列表字段无消费者后删除。
  // 显式列集（不用 c.*）：双方已读游标（student_last_read_id/teacher_last_read_id）不下发，
  // 避免向对方暴露己方已读位置（低敏信息泄露面收口）
  return await dbAll(db, `SELECT c.id, c.student_user_id, c.teacher_user_id, c.demand_id, c.status, c.created_at,
      us.username AS student_name, ut.username AS teacher_name,
      us.avatar AS student_avatar, ut.avatar AS teacher_avatar,
      CASE WHEN lm.kind IN ('image','file') THEN '' ELSE lm.body END AS last_body,
      lm.kind AS last_kind, lm.created_at AS last_at, lm.sender_user_id AS last_sender,
      (SELECT COUNT(*) FROM messages m WHERE m.conversation_id=c.id AND m.sender_user_id<>?
        AND m.id > (CASE WHEN c.student_user_id=? THEN c.student_last_read_id ELSE c.teacher_last_read_id END)
      ) AS unread_count
    FROM conversations c
    JOIN users us ON us.id=c.student_user_id
    JOIN users ut ON ut.id=c.teacher_user_id
    LEFT JOIN (
      SELECT m.conversation_id, m.body, m.kind, m.created_at, m.sender_user_id
      FROM messages m JOIN (SELECT conversation_id, MAX(id) AS mid FROM messages GROUP BY conversation_id) x
        ON x.mid=m.id
    ) lm ON lm.conversation_id=c.id
    WHERE c.student_user_id=? OR c.teacher_user_id=?
    ORDER BY COALESCE(lm.created_at, c.created_at) DESC`, [userId, userId, userId, userId]);
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
  return await dbAll(db, `SELECT m.id, m.conversation_id, m.sender_user_id, m.kind, m.name, m.created_at,
      CASE WHEN m.kind IN ('image','file') THEN '' ELSE m.body END AS body,
      CASE WHEN m.kind='image' THEN m.thumb ELSE '' END AS thumb
    FROM messages m
    WHERE m.conversation_id=? AND m.id>? ORDER BY m.id ASC LIMIT ?`, [convId, sinceId, limit]);
}

// messages INSERT 单源：路由层批量发送不得自持 SQL 直插——
// 数据层单写原则旁支通路，messages 加列时两处只改一处必静默缺列。业务 SQL 只此一份，批量经
// dbPrepareMessageInsert 取预编译语句，单条经 dbCreateMessage 落库。
const MSG_INSERT_SQL = 'INSERT INTO messages (conversation_id, sender_user_id, kind, body, name, thumb) VALUES (?,?,?,?,?,?)';
export function dbPrepareMessageInsert(db) { return db.prepare(MSG_INSERT_SQL); }

export async function dbCreateMessage(db, convId, senderUserId, kind, body, name = '', thumb = '') { // 缩略图随消息落库
  const result = await dbRun(db, MSG_INSERT_SQL, [convId, senderUserId, kind, body, name, thumb]);
  return Number(result.meta.last_row_id);
}

// 管理员删除消息前置查询：取会话/发送者/类型供留档
export async function dbGetMessageById(db, messageId) {
  return await dbGet(db, 'SELECT id, conversation_id, sender_user_id, kind FROM messages WHERE id=?', [messageId]);
}

// 单条附件懒加载取 body（图片/文件大字段不随列表下发，气泡骨架渲染后逐条补载）
export async function dbGetMessageAttachment(db, messageId, conversationId) {
  return await dbGet(db, 'SELECT body, name FROM messages WHERE id=? AND conversation_id=?', [messageId, conversationId]);
}

// 管理员删除单条消息（聊天内容管理）
export async function dbDeleteMessage(db, messageId) {
  return dbRun(db, 'DELETE FROM messages WHERE id=?', [messageId]);
}

// 更新消息 body（signing.js 发起回填/终态覆写用；UPDATE 只此一处）
export async function dbSetMessageBody(db, messageId, body) {
  return dbRun(db, 'UPDATE messages SET body=? WHERE id=?', [body, messageId]);
}

// ============================================================
// 签约请求（signing_requests）——A5 收口：业务 SQL 自 signing.js 内收（DDL 仍由 signing.js 自持）
// ============================================================
export async function dbGetSigningById(db, id) {
  return await dbGet(db, 'SELECT * FROM signing_requests WHERE id=?', [id]);
}

/** 管理端硬删签约请求（D2 处罚；气泡消息本体留 messages，正文 JSON 自含快照不受影响） */
export async function dbDeleteSigning(db, signingId) {
  await dbRun(db, 'DELETE FROM signing_requests WHERE id=?', [signingId]);
}

export async function dbGetPendingSigningForConversation(db, conversationId) {
  return await dbGet(db,
    "SELECT id FROM signing_requests WHERE conversation_id=? AND status='pending' LIMIT 1", [conversationId]);
}

export async function dbCreateSigning(db, conversationId, demandId, userId, msgId, price, schedule, method) {
  const res = await dbRun(db,
    'INSERT INTO signing_requests (conversation_id, demand_id, initiator_user_id, message_id, price, schedule, method) VALUES (?,?,?,?,?,?,?)',
    [conversationId, demandId, userId, msgId, price, schedule, method]);
  return Number(res.meta.last_row_id);
}

// 确认签约原子事务：sr 置 signed + 需求置 contracted 同一 batch 事务，
// 需求守卫 EXISTS(open) 防同需求多会话并发双签（后到的批事务守卫失败 → changes[0]=0 → 调用方 410）。
// 返回 [srChanges, demandChanges]；auto-reject 副作用只由需求收缩赢家（demandChanges>0）驱动。
export async function dbConfirmSigning(db, signingId, demandId) {
  const results = await db.batch([
    db.prepare(`UPDATE signing_requests SET status='signed', responded_at=datetime('now','localtime')
      WHERE id=? AND status='pending'
      AND EXISTS(SELECT 1 FROM student_demands WHERE id=? AND status='open')`).bind(signingId, demandId),
    db.prepare(`UPDATE student_demands SET status='contracted' WHERE id=? AND status='open'`).bind(demandId),
  ]);
  return results.map(r => (r && r.meta && r.meta.changes) || 0);
}

// 拒绝/收束签约单条（respond 拒绝分支 + 注销收束共用）：条件 UPDATE + changes 判定（赢家模式）
export async function dbRejectSigning(db, signingId) {
  const res = await dbRun(db,
    `UPDATE signing_requests SET status=?, responded_at=datetime('now','localtime') WHERE id=? AND status='pending'`,
    [STATUS.REJECTED, signingId]);
  return !!(res && res.meta && res.meta.changes > 0);
}

// ============================================================
// 聊天附件暂存区（uploads）：文件拖入/选中即真实上传至此（XHR 进度），
// 发送时凭 uploadId 确认落入 messages 后删除暂存
// ============================================================
// 暂存配额自愈：清本人滞留暂存件（窗口单源自 constants.LIMITS，防弃传暂存填满库）
export async function dbPurgeStaleUploads(db, userId) {
  await dbRun(db, `DELETE FROM uploads WHERE user_id=? AND created_at < datetime('now','localtime', ?)`,
    [userId, LIMITS.STALE_UPLOAD_WINDOW]);
}

// 本人当前暂存件数（每人 12 件封顶用）
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
export function dbPrepareUploadDelete(db) { return db.prepare('DELETE FROM uploads WHERE id=? AND user_id=?'); } // Z-4-F2：条件 DELETE 带归属（纵深防御——上层归属校验之外的 DB 层兜底；重复/误删同 id 异主零影响）

// ============================================================
