/**
 * 聊天域数据层（V-1-4 从 server/db.js 提取）：conversations / messages / uploads / signing_contracts（签约层）。
 */
import { dbAll, dbGet, dbRun } from '../../core/util.js';
import { mapDemandRow } from '../demand/repo.js';
import { LIMITS } from '../../../shared/config.js';
import { STATUS } from '../../../shared/enums.js';

// 会话与消息（模块4）
// ============================================================

// 同一师生对唯一会话（UNIQUE(student,teacher)）；已存在则返回既有 id。
// AI-6 会话重启：命中 closed 行 → 重启原会话（status→active + demand 回填，历史保留）——
// 用户模型「一对师生终身一个会话对象，closed 后再次合作 = 重启原会话，非新建」；双调用点
// （意向/推送接受）经同一元组命中即重启。重启不重设已读游标/不删历史（历史保留）。
export async function dbUpsertConversation(db, studentUserId, teacherUserId, demandId) {
  await dbRun(db,
    'INSERT OR IGNORE INTO conversations (student_user_id, teacher_user_id, demand_id) VALUES (?,?,?)',
    [studentUserId, teacherUserId, demandId || null]);
  const row = await dbGet(db,
    'SELECT id, demand_id, status FROM conversations WHERE student_user_id=? AND teacher_user_id=?',
    [studentUserId, teacherUserId]);
  // AI-6：closed → 重启（条件 UPDATE 幂等：并发双配对只一次生效；demand 回填为新合作需求）
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
       AND EXISTS (SELECT 1 FROM signing_contracts sc WHERE sc.demand_id=sd.id AND sc.stage='signing'
            AND sc.signing_status='signed' AND sc.revoked=0 AND sc.teacher_user_id=c.teacher_user_id) -- AI-4b: 起草须本会话教师已成交（正向定位，防他师陈旧 signed 行误挡）
       AND NOT EXISTS (SELECT 1 FROM signing_contracts sc2 WHERE sc2.demand_id=sd.id AND sc2.stage='contract'
            AND sc2.contract_status IN ('pending','signing','signed') AND sc2.revoked=0) -- Q-2e-F1 收口：撤销合同不算进行中（本查询是生产起草下拉唯一数据源，漏排除则 409 死锁变空下拉死锁）`
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
      FROM messages m JOIN (
        SELECT conversation_id, MAX(id) AS mid FROM messages
        WHERE conversation_id IN (SELECT id FROM conversations WHERE student_user_id=? OR teacher_user_id=?) -- Q-2d-F5：最近消息聚合限定本用户会话集，全表 GROUP BY → 会话集内
        GROUP BY conversation_id) x
        ON x.mid=m.id
    ) lm ON lm.conversation_id=c.id
    WHERE c.student_user_id=? OR c.teacher_user_id=?
    ORDER BY COALESCE(lm.created_at, c.created_at) DESC`, [userId, userId, userId, userId, userId, userId]);
}

// AI-7：统一关系清单——按双方元组聚合（会话 + 最后消息 + 最新 signing_contracts 状态），供连线图/关系管理。
// 会话 = 双方元组（UNIQUE(student,teacher)）天然一一对应；最新签约/合同状态按元组 MAX(id) 取
// （signing_contracts conversation_id 可能为 NULL——AI-4b 兜底 INSERT 行，故按元组聚合与 AI-1 级联口径一致）。
// 显式列集（不用 c.*）：已读游标（student_last_read_id/teacher_last_read_id）不下发（同 dbGetMyConversations 低敏泄露收口）。
export async function dbGetMyRelations(db, userId) {
  return await dbAll(db, `SELECT c.id, c.student_user_id, c.teacher_user_id, c.status, c.created_at,
      us.username AS student_name, ut.username AS teacher_name,
      us.avatar AS student_avatar, ut.avatar AS teacher_avatar,
      CASE WHEN lm.kind IN ('image','file') THEN '' ELSE lm.body END AS last_body,
      lm.kind AS last_kind, lm.created_at AS last_at, lm.sender_user_id AS last_sender,
      sc.id AS sc_id, sc.stage AS sc_stage, sc.signing_status AS sc_signing_status,
      sc.contract_status AS sc_contract_status, sc.revoked AS sc_revoked
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
    LEFT JOIN signing_contracts sc ON sc.id = (
      SELECT MAX(id) FROM signing_contracts sc2
      WHERE sc2.student_user_id=c.student_user_id AND sc2.teacher_user_id=c.teacher_user_id)
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
  // Q-2d-F1：初始加载（sinceId=0）取最近 limit 条——先 DESC 取最新再反转成升序（前端按序渲染
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
  const result = await dbRun(db, MSG_INSERT_SQL, [convId, senderUserId, kind, body, name, thumb, null]); // Q-2d-F2：非 chat 域（合同/签约气泡）不带幂等键
  return Number(result.meta.last_row_id);
}

// Q-2d-F2：按幂等键批量查已落消息（handleSendBatch 去重判据——键全命中 = 超时重发，返回既有回执）
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

// 更新消息 body（signing.js 发起回填/终态覆写用；UPDATE 只此一处）
export async function dbSetMessageBody(db, messageId, body) {
  return dbRun(db, 'UPDATE messages SET body=? WHERE id=?', [body, messageId]);
}

// ============================================================
// 签约请求（signing_contracts stage='signing' 层）——AI-4b 读写切换合并表（签约/合同同一实体不同 stage）
// ============================================================
export async function dbGetSigningById(db, id) {
  return await dbGet(db, "SELECT sc.*, sc.signing_status AS status FROM signing_contracts sc WHERE id=? AND stage='signing'", [id]);
}

/** 管理端硬删签约请求（D2 处罚；气泡消息本体留 messages，正文 JSON 自含快照不受影响） */
export async function dbDeleteSigning(db, signingId) {
  await dbRun(db, "DELETE FROM signing_contracts WHERE id=? AND stage='signing'", [signingId]);
}

export async function dbGetPendingSigningForConversation(db, conversationId) {
  return await dbGet(db,
    "SELECT id FROM signing_contracts WHERE conversation_id=? AND stage='signing' AND signing_status='pending' LIMIT 1", [conversationId]);
}

export async function dbCreateSigning(db, conversationId, studentUserId, teacherUserId, demandId, userId, msgId, price, schedule, method) {
  const res = await dbRun(db,
    'INSERT INTO signing_contracts (conversation_id, student_user_id, teacher_user_id, demand_id, initiator_user_id, message_id, price, schedule, method, stage, signing_status) VALUES (?,?,?,?,?,?,?,?,?,\'signing\',\'pending\')',
    [conversationId, studentUserId, teacherUserId, demandId, userId, msgId, price, schedule, method]);
  return Number(res.meta.last_row_id);
}

// 确认签约原子事务：sr 置 signed + 需求置 contracted 同一 batch 事务，
// 需求守卫 EXISTS(open) 防同需求多会话并发双签（后到的批事务守卫失败 → changes[0]=0 → 调用方 410）。
// 返回 [srChanges, demandChanges]；auto-reject 副作用只由需求收缩赢家（demandChanges>0）驱动。
export async function dbConfirmSigning(db, signingId, demandId) {
  const results = await db.batch([
    db.prepare(`UPDATE signing_contracts SET signing_status='signed', responded_at=datetime('now')
      WHERE id=? AND stage='signing' AND signing_status='pending'
      AND EXISTS(SELECT 1 FROM student_demands WHERE id=? AND status='open')`).bind(signingId, demandId),
    db.prepare(`UPDATE student_demands SET status='contracted' WHERE id=? AND status='open'`).bind(demandId),
  ]);
  return results.map(r => (r && r.meta && r.meta.changes) || 0);
}

// 拒绝/收束签约单条（respond 拒绝分支 + 注销收束共用）：条件 UPDATE + changes 判定（赢家模式）
export async function dbRejectSigning(db, signingId) {
  const res = await dbRun(db,
    `UPDATE signing_contracts SET signing_status=?, responded_at=datetime('now') WHERE id=? AND stage='signing' AND signing_status='pending'`,
    [STATUS.REJECTED, signingId]);
  return !!(res && res.meta && res.meta.changes > 0);
}

// AI-1：结束关系原子事务——会话 active→closed + 级联自动收束（pending 签约拒绝 + 进行中合同撤销 + 需求释放）
// 单 db.batch 原子。幂等/并发：会话 UPDATE 的 status='active' 守卫是承重闸门（并发双 close 仅赢家
// closeWon=true 触发副作用；级联各行自身条件 UPDATE 幂等，重复 close 全 changes=0 零副作用）。
// 级联按双方元组匹配（relationship 抽象父类的物理表达，不依赖 conversation_id——该列可 NULL、
// AI-4b 兜底独立合同行也覆盖；命中 idx_sc_tuple 索引）。
// 需求释放与合同撤销同事务（AI-1 有意决定：防「合同已 revoked 但需求滞留 contracted 死锁」，
// Q-2e-F1 教训；SQL 与 demand/repo.js dbReleaseDemandAfterRevoke 同口径，batch 内联）。
// 边界（A5 终态门禁由 WHERE 守卫天然保证）：已成交未起草（signing signed）/已签署合同（contract signed）/
// 已拒绝/已撤销行全部不命中；已撤销合同置 revoked=1+contract_status='signed' 沿 handleRevokeContract 标记口径
// （revoked 主导显示，contractStatusMeta 先判 revoked）。
// 返回 { closeWon, rejected:[{行..., changes}], revoked:[{行..., changes}], demandsReleased }
export async function dbCloseConversationCascade(db, conversationId, studentUserId, teacherUserId) {
  const signings = await dbAll(db,
    `SELECT id, demand_id, initiator_user_id, message_id, price, schedule, method
     FROM signing_contracts
     WHERE student_user_id=? AND teacher_user_id=? AND stage='signing' AND signing_status='pending'`,
    [studentUserId, teacherUserId]);
  const contracts = await dbAll(db,
    `SELECT id, demand_id FROM signing_contracts
     WHERE student_user_id=? AND teacher_user_id=? AND stage='contract'
       AND contract_status IN ('pending','signing') AND revoked=0`,
    [studentUserId, teacherUserId]);
  const demandIds = [...new Set(contracts.map(c => c.demand_id).filter(Boolean))];
  const stmts = [
    db.prepare("UPDATE conversations SET status='closed' WHERE id=? AND status='active'").bind(conversationId),
    ...signings.map(s => db.prepare(
      `UPDATE signing_contracts SET signing_status=?, responded_at=datetime('now')
       WHERE id=? AND stage='signing' AND signing_status='pending'`).bind(STATUS.REJECTED, s.id)),
    ...contracts.map(c => db.prepare(
      `UPDATE signing_contracts SET revoked=1, revoked_by=0, contract_status='signed', version=version+1, updated_at=datetime('now')
       WHERE id=? AND stage='contract' AND contract_status IN ('pending','signing') AND revoked=0`).bind(c.id)),
    ...demandIds.map(d => db.prepare(
      `UPDATE student_demands SET status='revoked' WHERE id=? AND status='contracted'`).bind(d)),
  ];
  const results = await db.batch(stmts);
  const changes = i => (results[i] && results[i].meta && results[i].meta.changes) || 0;
  let idx = 1;
  const rejected = signings.map(s => ({ ...s, changes: changes(idx++) }));
  const revoked = contracts.map(c => ({ ...c, changes: changes(idx++) }));
  // 需求释放实际命中数（并发已释放的行 changes=0 不计入；审计 AI-1 发现 3 修正统计口径）
  let demandsReleased = 0;
  for (let j = 0; j < demandIds.length; j++) { if (changes(idx++) > 0) demandsReleased++; }
  return { closeWon: changes(0) > 0, rejected, revoked, demandsReleased };
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
export function dbPrepareUploadDelete(db) { return db.prepare('DELETE FROM uploads WHERE id=? AND user_id=?'); } // Z-4-F2：条件 DELETE 带归属（纵深防御——上层归属校验之外的 DB 层兜底；重复/误删同 id 异主零影响）

// ============================================================
