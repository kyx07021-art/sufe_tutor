/**
 * chat feature actions: conversation list, polling, send, uploads, signing.
 */
import { CONFIG } from '../../../shared/config.js';
import { TEXT } from './text.js';
import { chat } from './chat-state.js';
import { state } from '../../core/state.js';
import { api, apiUpload } from '../../core/api.js';
import { dhGet, dhOnDomainRefresh } from '../../core/datahub.js';
import { openModal, closeModal, showToast, openImageViewer, withCaptcha } from '../../core/ui.js';
import { escHtml, mdRender, fmtDateTime } from '../../core/dom.js';
import { renderConvList as renderConvListHtml, renderChatFrame, renderChatPlaceholder, renderChatBubble, renderStageBox, chatFileSize, chatFileExt, fmtChatTime, chatNowStamp } from './render.js';
import { setChatConvById } from '../contract/actions-chat-bridge.js';


let ensureAuth = () => true;
export function setChatEnsureAuth(fn) { if (typeof fn === 'function') ensureAuth = fn; }

export function chatConvById(id) { return chat.list.find(c => c.id === id) || null; }
setChatConvById(chatConvById);

export function enterMyChats() {
  const el = document.getElementById('my-chats-list');
  if (!el) return;
  el.innerHTML = '<div class="empty-state">' + escHtml('') + '</div>';
  loadConversations();
}

export async function loadConversations() {
  try {
    const data = await dhGet('/api/conversations', { domain: 'chat' });
    chat.list = data.conversations || [];
    renderConvList();
  } catch (err) {
    const el = document.getElementById('my-chats-list');
    if (el) el.innerHTML = `<div class="empty-state"><p>${TEXT.ERROR_LOAD_PREFIX}${escHtml(err.message)}</p></div>`;
  }
}

export function goChatWithStudent(studentId) {
  const conv = chat.list.find(c => c.student_user_id === studentId) || null;
  if (conv) { openConversation(conv.id); return; }
  // If no existing conversation, server creates on first message; open placeholder.
  chat.pendingOpen = studentId;
  const frame = document.getElementById('chat-frame');
  if (frame) frame.innerHTML = renderChatFrame({ id: 0, student_user_id: studentId, teacher_user_id: state.user.id, student_name: '', teacher_name: '' });
}

export function renderConvList() {
  const el = document.getElementById('my-chats-list');
  if (el) el.innerHTML = renderConvListHtml(chat.list);
}

export function chatsUnreadTotal() { return chat.list.reduce((s, c) => s + (c.unread_count || 0), 0); }

export async function markReadConv(convId) {
  await api(`/api/conversations/${convId}/read`, { method: 'POST', body: {} }).catch(() => {});
  const c = chat.list.find(x => x.id === convId);
  if (c) c.unread_count = 0;
  renderConvList();
}

export function markActiveConvRead() { if (chat.convId) markReadConv(chat.convId); }

export function chatBumpConvPreview(convId, lastMsg) {
  const c = chat.list.find(x => x.id === convId);
  if (!c) return;
  c.last_message = lastMsg;
  renderConvList();
}

export function chatAbortStagedUploads() {
  chat.staged.forEach(it => { if (it._xhr) it._xhr.abort(); it._aborted = true; if (it.uploadId) api(`/api/uploads/${it.uploadId}`, { method: 'DELETE', body: {} }).catch(() => {}); });
  chat.staged = [];
  renderStageBox(chat.staged, document.getElementById('chat-stage'));
}

export async function openConversation(convId) {
  chatAbortStagedUploads();
  chat.convId = convId;
  markReadConv(convId);
  const frame = document.getElementById('chat-frame');
  if (frame) frame.innerHTML = renderChatFrame(chatConvById(convId) || {});
  try {
    const data = await api(`/api/conversations/${convId}/messages`, { method: 'GET' });
    const box = document.getElementById('chat-messages');
    if (box) box.innerHTML = (data.messages || []).map(renderChatBubble).join('') || `<div class="empty-state">${TEXT.CHAT_EMPTY_NO_MESSAGES}</div>`;
    const msgs = data.messages || [];
    chat.lastMsgId = msgs.length ? msgs[msgs.length - 1].id : 0;
    chatStartPolling();
  } catch (err) {
    const box = document.getElementById('chat-messages');
    if (box) box.innerHTML = `<div class="empty-state"><p>${escHtml(err.message)}</p></div>`;
  }
}

export function renderChatPlaceholderAction() { return renderChatPlaceholder(); }


