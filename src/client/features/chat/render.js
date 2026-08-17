/**
 * chat feature renderers: conversation list, chat frame, bubbles, attachments.
 * No inline handlers or inline style attributes.
 */
import { CONFIG } from '../../../shared/config.js';
import { TEXT } from './text.js';
import { state } from '../../core/state.js';
import { escHtml, mdRender, fmtDateTime } from '../../core/dom.js';
import { usernameHtml, deactivatedTag, expectedTimeText } from '../../core/display.js';

export function chatPeerOf(c) {
  const me = state.user ? state.user.id : null;
  return me === c.student_user_id ? c.teacher_name : c.student_name;
}

export function renderConvItem(c) {
  const peer = chatPeerOf(c);
  const preview = c.last_message || '';
  return `<div class="conv-item glass${c.unread_count ? ' conv-item--unread' : ''}" data-action="chat.openConv" data-id="${c.id}">
    <div class="conv-item-main">
      <span class="conv-item-name">${escHtml(peer)}</span>
      <span class="conv-item-preview">${escHtml(preview)}</span>
    </div>
    ${c.unread_count ? `<span class="conv-item-badge">${c.unread_count}</span>` : ''}
  </div>`;
}

export function renderConvList(list) {
  if (!list.length) return `<div class="empty-state"><p>${TEXT.CHAT_EMPTY_NO_CONVS}</p></div>`;
  return list.map(renderConvItem).join('');
}

export function renderChatFrame(conv) {
  const peer = chatPeerOf(conv);
  return `<div class="chat-header">
      <button type="button" class="btn-text glass" data-action="chat.back">${TEXT.CHAT_BACK_TO_LIST}</button>
      <span class="chat-peer-name">${escHtml(peer)}</span>
      <button type="button" class="btn btn-sm glass glass--pressable" data-action="chat.plus">${TEXT.CHAT_PLUS_ARIA}</button>
    </div>
    <div class="chat-plus-wrap" id="chat-plus-wrap">
      <button type="button" class="chat-pop-item glass glass--pressable" data-action="chat.plusSigning">${TEXT.SIGNING_MODAL_TITLE}</button>
      <button type="button" class="chat-pop-item glass glass--pressable" data-action="chat.plusDraft">${TEXT.CHAT_BTN_DRAFT_CONTRACT}</button>
    </div>
    <div class="chat-messages" id="chat-messages"><div class="empty-state">${TEXT.CHAT_EMPTY_NO_MESSAGES}</div></div>
    <div class="chat-stage hidden glass" id="chat-stage"></div>
    <div class="chat-composer">
      <textarea id="chat-input" class="form-input chat-input" rows="1" placeholder="${TEXT.CHAT_INPUT_PLACEHOLDER}" data-input="chat.input"></textarea>
      <input type="file" id="chat-image-input" accept="image/*" class="sr-file-input" data-action="chat.image">
      <input type="file" id="chat-file-input" class="sr-file-input" data-action="chat.file">
      <button type="button" class="btn glass glass--pressable" data-action="chat.send">${TEXT.CHAT_BTN_SEND}</button>
    </div>`;
}

export function renderChatPlaceholder() {
  return `<div class="chat-placeholder"><p class="text-muted">${TEXT.CHAT_PLACEHOLDER_TITLE}</p><p class="text-sm text-muted">${TEXT.CHAT_PLACEHOLDER_SUB}</p></div>`;
}


export function renderChatBubble(m, i) {
  const mine = state.user && m.sender_user_id === state.user.id;
  const cls = mine ? 'chat-bubble--mine' : 'chat-bubble--other';
  const time = fmtDateTime(m.created_at);
  return `<div class="chat-bubble ${cls}" data-mid="${m.id}">
    <div class="chat-bubble-inner">${renderChatMediaInner(m.kind, m.body, m.name, m.thumb, m.id, m)}</div>
    <span class="chat-bubble-time">${escHtml(time)}</span>
  </div>`;
}

export function renderChatMediaInner(kind, body, name, thumb, mid, m) {
  if (kind === 'text') return escHtml(body);
  if (kind === 'image') {
    return `<button type="button" class="chat-img" data-action="chat.openImage" data-mid="${mid}">
      <img src="${escHtml(thumb || body)}" alt="${TEXT.CHAT_ATTACH_IMAGE}" loading="lazy"></button>`;
  }
  if (kind === 'file') {
    return `<button type="button" class="chat-file" data-action="chat.download" data-mid="${mid}">
      <span class="chat-file-ext">${escHtml(chatFileExt(name))}</span>
      <span>${escHtml(name || TEXT.CHAT_FILE_FALLBACK)}</span></button>`;
  }
  if (kind === 'contract') {
    const mine = state.user && m && m.sender_user_id === state.user.id;
    return `<div class="chat-contract-bubble">${escHtml(mine ? TEXT.CHAT_CONTRACT_BUBBLE_MINE : TEXT.CHAT_CONTRACT_BUBBLE_OTHER)}</div>`;
  }
  if (kind === 'signing_request' || kind === 'signing_response') {
    let s = body;
    try { s = typeof body === 'string' ? JSON.parse(body) : body; } catch {}
    const label = kind === 'signing_request' ? TEXT.CHAT_SIGNING_REQUEST_TITLE : TEXT.CHAT_SIGNING_RESPONSE_TITLE;
    const isRecipient = !(state.user && m && m.sender_user_id === state.user.id);
    const actions = kind === 'signing_request' && isRecipient && s.status === 'pending'
      ? `<span class="signing-bubble-actions">
          <button type="button" class="btn btn-sm glass glass--pressable" data-action="chat.respond" data-id="${escHtml(String(s.id || ''))}" data-accept="1">${TEXT.BTN_SIGNING_CONFIRM}</button>
          <button type="button" class="btn btn-sm btn-outline glass glass--pressable" data-action="chat.respond" data-id="${escHtml(String(s.id || ''))}" data-accept="0">${TEXT.BTN_SIGNING_REJECT}</button>
        </span>`
      : '';
    return `<div class="chat-signing-bubble" data-signing-id="${escHtml(String(s.id || ''))}">
      <p>${label}</p>
      ${s.price != null ? `<p>${TEXT.CHAT_SIGNING_PRICE} ${escHtml(String(s.price))}${TEXT.PRICE_UNIT}</p>` : ''}
      ${s.schedule ? `<p>${TEXT.CHAT_SIGNING_SCHEDULE} ${escHtml(expectedTimeText(s.schedule))}</p>` : ''}
      ${actions}
    </div>`;
  }
  return escHtml(body || '');
}

export function chatFileSize(dataUrl) {
  try {
    const s = String(dataUrl || '');
    const b64Idx = s.indexOf(';base64,');
    const bytes = b64Idx >= 0 ? Math.round((s.length - b64Idx - 8) * 3 / 4) : s.length;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(2)} MB`;
  } catch { return ''; }
}

export function chatFileExt(name) {
  const m = /\.([a-zA-Z0-9]+)$/.exec(name || '');
  return m ? m[1].toUpperCase() : 'FILE';
}

export function renderStageBox(items, el) {
  if (!el) return;
  if (!items.length) { el.classList.add('hidden'); el.innerHTML = ''; return; }
  el.classList.remove('hidden');
  el.innerHTML = items.map(it => {
    const body = it.kind === 'image'
      ? `<img src="${escHtml(it.thumb || it.dataUrl || '')}" alt="">`
      : `<span class="chat-stage-ext">${escHtml(chatFileExt(it.name))}</span>`;
    return `<span class="chat-stage-item" data-stage-id="${it.id}">
      <span class="chat-stage-preview">${body}</span>
      ${it.progress < 100 ? `<span class="chat-stage-progress">${Math.round(it.progress || 0)}%</span>` : ''}
      <button type="button" class="chat-stage-x" data-action="chat.unstage" data-id="${it.id}">×</button>
    </span>`;
  }).join('');
}

export function fmtChatTime(t) { return fmtDateTime(t); }
export function chatNowStamp() { return new Date().toISOString(); }
