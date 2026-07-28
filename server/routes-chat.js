/**
 * 路由模块：站内沟通（会话列表 / 消息轮询 / 发送）
 * 消息内容按模块5要求全量留档（detail 含正文，走 logEvent 咽喉，后期统一加密）
 * 图片/文件：schema 已预留 kind，发送端暂返回 FEATURE_TODO
 */
import { json, error, MSG } from './core.js';
import {
  dbGetMyConversations, dbGetConversationById, dbGetMessages, dbCreateMessage, dbMarkConversationRead,
} from './db.js';
import { logEvent } from './log.js';

const isParticipant = (conv, userId) =>
  conv && (conv.student_user_id === userId || conv.teacher_user_id === userId);

export async function handleGetConversations(db, url) {
  const userId = parseInt(url.searchParams.get('userId'));
  if (!userId) return error(MSG.LOGIN_REQUIRED);
  const conversations = await dbGetMyConversations(db, userId);
  return json({ conversations });
}

// 标记已读：我的已读游标推到该会话最新一条（红点点掉即消的后端支撑）
export async function handleMarkRead(db, convId, body) {
  const userId = parseInt(body.userId);
  const conv = await dbGetConversationById(db, convId);
  if (!conv || !isParticipant(conv, userId)) return error(MSG.CONVERSATION_NOT_FOUND, 404);
  await dbMarkConversationRead(db, convId, userId);
  return json({ ok: true });
}

export async function handleGetMessages(db, convId, url) {
  const userId = parseInt(url.searchParams.get('userId'));
  const sinceId = parseInt(url.searchParams.get('sinceId')) || 0;
  const conv = await dbGetConversationById(db, convId);
  if (!conv || !isParticipant(conv, userId)) return error(MSG.CONVERSATION_NOT_FOUND, 404);

  const messages = await dbGetMessages(db, convId, sinceId);
  return json({ conversation: conv, messages });
}

export async function handleSendMessage(db, convId, body, req) {
  const { userId, kind = 'text' } = body;
  const conv = await dbGetConversationById(db, convId);
  if (!conv || !isParticipant(conv, userId)) return error(MSG.CONVERSATION_NOT_FOUND, 404);
  if (conv.status !== 'active') return error(MSG.NO_PERMISSION, 403);

  if (kind !== 'text') return error(MSG.FEATURE_TODO, 501); // 图片/文件后续迭代
  const text = String(body.body ?? '').trim();
  if (!text) return error(MSG.MESSAGE_TOO_LONG); // 空消息复用长度错误提示位
  if (text.length > 2000) return error(MSG.MESSAGE_TOO_LONG);

  const id = await dbCreateMessage(db, convId, userId, 'text', text);
  logEvent(db, { action: 'chat.send', actorUserId: userId, entity: 'conversation', entityId: convId,
    detail: { messageId: id, kind: 'text', body: text }, req });
  return json({ id, message: 'ok' }, 201);
}
