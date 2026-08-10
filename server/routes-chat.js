/**
 * 路由模块：站内沟通（会话列表 / 消息轮询 / 发送 / 附件暂存上传）
 * 消息发送走 logEvent 业务审计留档（detail 含正文元数据，不落 dataURL 本体；访问层读流量不入留档）
 * 图片/文件：kind=image/file；暂存上传走 uploads 表，发送时凭 uploadId 落入会话。
 * 安全补丁已并入主线：svg/html dataURL 黑名单（防钓鱼投递）、附件体积上限、暂存配额自愈+封顶、
 * 参与方 404 不泄露会话存在性。限额全部单源 constants.LIMITS。
 */
import { json, error } from './util.js';
import { requireUser } from './security.js';
import { encryptField, decryptField } from './crypto.js'; // 附件 dataURL 加密落库（网安 N-05）
import { MSG, STATUS, LIMITS } from './constants.js';
import {
  dbGetMyConversations, dbGetConversationById, dbGetMessages, dbMarkConversationRead,
  dbGetMessageAttachment, dbGetConversationBindableDemands,
  dbPurgeStaleUploads, dbCountUploads, dbCreateUpload, dbGetUpload, dbGetUploads, dbDeleteUpload,
} from './db.js';
import { logEvent } from './log.js';

const isParticipant = (conv, userId) =>
  conv && (conv.student_user_id === userId || conv.teacher_user_id === userId);

// 会话操作公共关口：取会话行 + 参与方校验（会话双方学生/教师）。
// 不存在或非参与方统一 404（不向外透露会话存在性）；失败返 { err: Response }，成功返 { conv }
async function loadConversationFor(db, conversationId, userId) {
  const conv = await dbGetConversationById(db, conversationId);
  if (!conv || !isParticipant(conv, userId)) return { err: error(MSG.CONVERSATION_NOT_FOUND, 404) };
  return { conv };
}

// 文件类 dataURL 黑名单：html/svg 可投递钓鱼内容（现代浏览器阻断执行但仍可投递），一律拒收。
// 比较一律小写化（防 DATA:TEXT/HTML、Data:Image/SVG 大小写绕过）；对 image 与 file 两种 kind 同时生效
const fileDataBlocked = content => {
  const c = String(content).toLowerCase();
  return c.startsWith('data:text/html') || c.startsWith('data:image/svg')
      || c.startsWith('data:application/xhtml+xml') || c.startsWith('data:text/xml') || c.startsWith('data:application/xml');
};

export async function handleGetConversations(db, url, req) {
  const { user: me, err } = await requireUser(db, req);
  if (err) return err;
  const conversations = await dbGetMyConversations(db, me.id);
  return json({ conversations });
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
  // v0.25.36 缩略图加密落库，出门解密（附件大字段仍懒加载走 attachment 接口，thumb 小字段随列表）
  for (const m of messages) {
    if (m.thumb) { try { m.thumb = await decryptField(m.thumb); } catch { m.thumb = ''; } }
  }
  // 已读游标不下发（db.js 自述契约）：双方 last_read_id 属隐私，剥除再回传
  const { student_last_read_id, teacher_last_read_id, ...convPub } = g.conv;
  return json({ conversation: convPub, messages });
}

// GET /api/conversations/:id/bindable-demands?phase=signing|contract —— 会话可绑定需求下拉单源
// （需求四·第2/3条：发起签约列「开放」需求、起草合同列「已签约」需求；归属 = 会话学生方，
// 参与方校验 + db.js 归属约束双关，防越权拉他人需求）
export async function handleGetConversationBindableDemands(db, convId, url, req) {
  const { user: me, err } = await requireUser(db, req);
  if (err) return err;
  const g = await loadConversationFor(db, convId, me.id);
  if (g.err) return g.err;
  const phase = url.searchParams.get('phase') === 'contract' ? 'contract' : 'signing';
  return json({ demands: await dbGetConversationBindableDemands(db, convId, phase) });
}

// GET /api/conversations/:cid/messages/:mid/attachment —— 单条附件懒加载
// （列表接口不下发图片/文件的 dataURL 本体，前端先渲染骨架，页面可操作后逐条补载）
export async function handleGetAttachment(db, convId, messageId, url, req) {
  const { user: me, err } = await requireUser(db, req);
  if (err) return err;
  const g = await loadConversationFor(db, convId, me.id);
  if (g.err) return g.err;
  const m = await dbGetMessageAttachment(db, messageId, convId);
  if (!m) return error(MSG.CONVERSATION_NOT_FOUND, 404);
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
  if (!prefixOk || content.length > LIMITS.FILE_MAX_BYTES) return error(MSG.FILE_TOO_LARGE);
  if (fileDataBlocked(content)) return error(MSG.FILE_TYPE_BLOCKED); // svg/html 黑名单对图片同样生效
  // v0.25.36 缩略图（仅图片携带）：data:image 前缀 + 小体积钳制（防刷大字段）+ 黑名单同款拦截
  const thumbRaw = kind === 'image' ? String(body.thumb ?? '') : '';
  if (thumbRaw && (!thumbRaw.startsWith('data:image/') || thumbRaw.length > LIMITS.THUMB_MAX_BYTES)) return error(MSG.FILE_TOO_LARGE);
  if (thumbRaw && fileDataBlocked(thumbRaw)) return error(MSG.FILE_TYPE_BLOCKED);
  const name = String(body.fileName ?? '').slice(0, LIMITS.FILE_NAME_MAX);
  // 暂存区配额自愈 + 上限：先清本人滞留暂存件（窗口见 LIMITS.STALE_UPLOAD_WINDOW），再按每人封顶（防弃传暂存填满库 / 刷大字段）
  await dbPurgeStaleUploads(db, me.id);
  if ((await dbCountUploads(db, me.id)) >= LIMITS.UPLOAD_STAGING_MAX) return error(MSG.UPLOAD_STAGING_LIMIT); // 快路径
  // 网安 N-05：附件 dataURL 加密落库（暂存区与消息正文同口径；发送落消息时密文原样搬移，不再二次加密）；缩略图同款加密
  const contentEnc = await encryptField(content);
  const thumbEnc = thumbRaw ? await encryptField(thumbRaw) : '';
  const id = await dbCreateUpload(db, me.id, kind, contentEnc, name, thumbEnc); // 条件 INSERT 原子化：0 = 并发已满配额（TOCTOU 缺口补）
  if (!id) return error(MSG.UPLOAD_STAGING_LIMIT);
  return json({ id }, 201);
}

// DELETE /api/uploads/:id —— 移除暂存项（删已上传的文件，仅本人）
export async function handleDeleteUpload(db, uploadId, body, req) {
  const { user: me, err } = await requireUser(db, req);
  if (err) return err;
  const u = await dbGetUpload(db, uploadId);
  if (!u || u.user_id !== me.id) return error(MSG.NO_PERMISSION, 403);
  await dbDeleteUpload(db, uploadId);
  return json({ ok: true });
}

export async function handleSendMessage(db, convId, body, req) {
  const { user: me, err } = await requireUser(db, req);
  if (err) return err;
  const userId = me.id;
  const g = await loadConversationFor(db, convId, userId);
  if (g.err) return g.err;
  if (g.conv.status !== STATUS.ACTIVE) return error(MSG.NO_PERMISSION, 403);

  // F9（v0.27.0 网络层重构）：批量发送——一次写往返落多条（暂存附件确认 + 文字），2N+1 串行写 → 1。
  // 前端暂存附件已上传（带进度），发送阶段只凭 uploadId 落消息 + 删暂存；整批单事务 db.batch。
  // v0.27.0 审计：单消息分支（body.body / body.uploadId / fileData 直发）已无前端调用者（前端恒发
  // batch），按「不保留向后兼容」连根删——text/image/file 直发语义全部由 batch 项覆盖。
  if (!Array.isArray(body.batch)) return error(MSG.INVALID_PARAMS, 400);
  return handleSendBatch(db, convId, body.batch, userId, req);
}

// F9（v0.27.0）：批量发送——附件确认 + 文字一次 db.batch 落库（单事务）。
// 往返口径（审计修正）：写落库 1 次往返；附件归属读经 dbGetUploads WHERE IN 一次单查（N 读 → 1，
// 同 B5 模式），总往返 = 1 读 + 1 写批（边界受 MSG_BATCH_MAX=13 封顶）。
// 校验与单条路径同口径（归属/长度），任一校验失败整批 400/404（不落半批）；db.batch 失败整体回滚。
const MSG_INSERT_SQL = 'INSERT INTO messages (conversation_id, sender_user_id, kind, body, name, thumb) VALUES (?,?,?,?,?,?)';
async function handleSendBatch(db, convId, batch, userId, req) {
  if (!batch.length || batch.length > LIMITS.MSG_BATCH_MAX) return error(MSG.INVALID_PARAMS, 400);
  // 第一遍（for...of 保留 return 语义）：文字项校验 + 收集附件 id（非数字/重复整批拒绝）
  const uploadIds = [];
  const seenUploads = new Set(); // 审计 C-4：重复 uploadId 整批拒绝（防同附件双消息双删 + 乐观批序错位）
  for (const item of batch) {
    if (item && item.uploadId) {
      const upId = parseInt(item.uploadId);
      if (Number.isNaN(upId) || seenUploads.has(upId)) return error(MSG.INVALID_PARAMS, 400);
      seenUploads.add(upId);
      uploadIds.push(upId);
    } else if (item && item.kind === 'text') {
      const content = String(item.body ?? '').trim();
      if (!content || content.length > LIMITS.MESSAGE_MAX_LEN) return error(MSG.MESSAGE_TOO_LONG);
    } else {
      return error(MSG.INVALID_PARAMS, 400);
    }
  }
  // 第二遍：附件归属单查（B5 模式：N 串行 dbGetUpload → 1 次 WHERE IN，往返 N 读 → 1）
  const uploadRows = uploadIds.length ? await dbGetUploads(db, uploadIds) : [];
  const uploadById = new Map(uploadRows.map(u => [u.id, u]));
  const stmts = [];
  const items = []; // { resultIndex, kind, name }
  for (const item of batch) {
    if (item && item.uploadId) {
      const up = uploadById.get(parseInt(item.uploadId));
      if (!up || up.user_id !== userId) return error(MSG.CONVERSATION_NOT_FOUND, 404);
      items.push({ resultIndex: stmts.length, kind: up.kind, name: up.name });
      stmts.push(db.prepare(MSG_INSERT_SQL).bind(convId, userId, up.kind, up.body, up.name, up.thumb)); // 密文随 uploads 转正
      stmts.push(db.prepare('DELETE FROM uploads WHERE id=?').bind(up.id));
    } else if (item && item.kind === 'text') {
      const content = String(item.body ?? '').trim();
      items.push({ resultIndex: stmts.length, kind: 'text', name: '' });
      stmts.push(db.prepare(MSG_INSERT_SQL).bind(convId, userId, 'text', content, '', ''));
    }
  }
  let results;
  try { results = await db.batch(stmts); }
  catch (e) { console.error('send batch failed:', e && e.message); return error(MSG.SERVER_ERROR, 500); }
  const created = items.map(it => ({
    id: Number((results[it.resultIndex] && results[it.resultIndex].meta && results[it.resultIndex].meta.last_row_id) || 0),
    kind: it.kind, name: it.name,
  }));
  await logEvent(db, { action: 'chat.send_batch', actorUserId: userId, entity: 'conversation', entityId: convId,
    detail: { count: created.length, kinds: created.map(c => c.kind) }, req });
  return json({ messages: created }, 201);
}
