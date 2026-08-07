/**
 * 路由模块：站内沟通（会话列表 / 消息轮询 / 发送 / 附件暂存上传）
 * 消息内容按模块5要求全量留档（detail 含正文元数据，走 logEvent 咽喉；dataURL 本体不落 detail）
 * 图片/文件：kind=image/file；暂存上传走 uploads 表，发送时凭 uploadId 落入会话。
 * 安全补丁已并入主线：svg/html dataURL 黑名单（防钓鱼投递）、附件体积上限、暂存配额自愈+封顶、
 * 参与方 404 不泄露会话存在性。限额全部单源 constants.LIMITS。
 */
import { json, error } from './util.js';
import { requireUser } from './security.js';
import { MSG, STATUS, LIMITS } from './constants.js';
import {
  dbGetMyConversations, dbGetConversationById, dbGetMessages, dbCreateMessage, dbMarkConversationRead,
  dbGetMessageAttachment,
  dbPurgeStaleUploads, dbCountUploads, dbCreateUpload, dbGetUpload, dbDeleteUpload,
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
  return json({ conversation: g.conv, messages });
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
  return json({ body: m.body, name: m.name || '' });
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
  const name = String(body.fileName ?? '').slice(0, LIMITS.FILE_NAME_MAX);
  // 暂存区配额自愈 + 上限：先清本人滞留暂存件（窗口见 LIMITS.STALE_UPLOAD_WINDOW），再按每人封顶（防弃传暂存填满库 / 刷大字段）
  await dbPurgeStaleUploads(db, me.id);
  if ((await dbCountUploads(db, me.id)) >= LIMITS.UPLOAD_STAGING_MAX) return error(MSG.UPLOAD_STAGING_LIMIT);
  const id = await dbCreateUpload(db, me.id, kind, content, name);
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
  const { kind = 'text' } = body;
  const g = await loadConversationFor(db, convId, userId);
  if (g.err) return g.err;
  if (g.conv.status !== STATUS.ACTIVE) return error(MSG.NO_PERMISSION, 403);

  // 暂存附件确认入会话：凭 uploadId 取出已上传文件，落成消息后删除暂存
  if (body.uploadId) {
    const up = await dbGetUpload(db, parseInt(body.uploadId));
    if (!up || up.user_id !== userId) return error(MSG.CONVERSATION_NOT_FOUND, 404);
    const id = await dbCreateMessage(db, convId, userId, up.kind, up.body, up.name);
    await dbDeleteUpload(db, up.id);
    await logEvent(db, { action: 'chat.send', actorUserId: userId, entity: 'conversation', entityId: convId,
      detail: { messageId: id, kind: up.kind, name: up.name, len: up.body.length }, req });
    return json({ id, kind: up.kind, name: up.name }, 201);
  }

  // 三种消息类型：text 纯文本 / image dataURL（前端已压缩）/ file dataURL + 文件名
  let content = '', name = '';
  if (kind === 'text') {
    content = String(body.body ?? '').trim();
    if (!content || content.length > LIMITS.MESSAGE_MAX_LEN) return error(MSG.MESSAGE_TOO_LONG);
  } else if (kind === 'image' || kind === 'file') {
    content = String(body.fileData ?? '');
    const prefixOk = kind === 'image' ? content.startsWith('data:image/') : content.startsWith('data:');
    if (!prefixOk || content.length > LIMITS.FILE_MAX_BYTES) return error(MSG.FILE_TOO_LARGE);
    if (fileDataBlocked(content)) return error(MSG.FILE_TYPE_BLOCKED); // svg/html 黑名单对图片同样生效
    name = String(body.fileName ?? '').slice(0, LIMITS.FILE_NAME_MAX);
  } else {
    return error(MSG.MESSAGE_TOO_LONG);
  }

  const id = await dbCreateMessage(db, convId, userId, kind, content, name);
  await logEvent(db, { action: 'chat.send', actorUserId: userId, entity: 'conversation', entityId: convId,
    detail: { messageId: id, kind, name, len: content.length }, req }); // 不记 dataURL 本体
  return json({ id, message: 'ok' }, 201);
}
