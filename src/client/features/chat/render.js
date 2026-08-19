/**
 * chat feature renderers: conversation list, chat frame, bubbles, attachments,
 * stage box, caption injection. No inline handlers or inline style attributes.
 *
 * Bubble contract (parity with v1 app-chat.js, B4 audit):
 * - outer .chat-msg (side class) > .chat-bubble (data-mid + glass + skin classes).
 * - .chat-bubble carries white-space:pre-wrap (style-chat.css) — the bubble inner
 *   template must be single-line: newline/indent text nodes between child elements
 *   render as visible blank lines (v1 fixed the same bug via .signing-bubble
 *   white-space:normal; structured templates additionally stay single-line here).
 * - media bubbles: image/file both get --media (bleed), file also --file (inset).
 *   List messages carry no dataURL body; thumb-only images render inline, files and
 *   thumb-less images render a loading skeleton refilled by chatLazyLoadAttachments.
 * - signing_request: title is sender-perspective (mine = CHAT_SIGNING_MINE_TITLE),
 *   with price/schedule/method rows, pending actions for the recipient, rejected
 *   done-state, signed tip + draft button, funds note while not signed.
 * - CSS class contract: every class emitted here must exist in style-chat.css
 *   (.chat-msg-time not .chat-bubble-time; .ring-track/.ring-bar inside
 *   .chat-stage-ring; .chat-stage-item/.chat-stage-thumb/.chat-stage-name/
 *   .chat-stage-del — the preview/progress/x names are gone with v1's template).
 */
import { STATUS, ROLES } from '../../../shared/enums.js';
import { TEXT } from './text.js';
import { chat } from './chat-state.js';
import { state } from '../../core/state.js';
import { escHtml, fmtDateTime, loaderHtml, renderAvatarHtml } from '../../core/dom.js';
import { usernameHtml, deactivatedTag } from '../../core/display.js';
import { expectedTimeText } from '../student/display.js';

/** Peer info of a conversation from the viewer's perspective (v1 chatPeerOf parity). */
export function chatPeerOf(c) {
  const isTeacherViewer = state.user && state.user.role === ROLES.TEACHER;
  return {
    id: isTeacherViewer ? c.student_user_id : c.teacher_user_id,
    name: isTeacherViewer ? c.student_name : c.teacher_name,
    role: isTeacherViewer ? TEXT.ROLE_STUDENT : TEXT.ROLE_TEACHER,
    avatar: isTeacherViewer ? c.student_avatar : c.teacher_avatar,
  };
}

export function renderConvItem(c) {
  const peer = chatPeerOf(c);
  const me = state.user ? state.user.id : null;
  let preview = TEXT.CHAT_EMPTY_NO_MESSAGES;
  if (c.last_kind === 'contract') {
    preview = TEXT.CHAT_PREVIEW_CONTRACT;
  } else if (c.last_kind === 'signing_request' || c.last_kind === 'signing_response') {
    preview = c.last_kind === 'signing_request' ? TEXT.CHAT_PREVIEW_SIGNING_REQ : TEXT.CHAT_PREVIEW_SIGNING_RESP;
  } else if (c.last_kind && c.last_kind !== 'text') {
    preview = (c.last_sender === me ? TEXT.CHAT_PREVIEW_ME_PREFIX : '') + (c.last_kind === 'image' ? TEXT.CHAT_PREVIEW_IMAGE : TEXT.CHAT_PREVIEW_FILE);
  } else if (c.last_body) {
    preview = (c.last_sender === me ? TEXT.CHAT_PREVIEW_ME_PREFIX : '') + c.last_body;
  }
  const time = fmtDateTime(c.last_at || c.created_at);
  return `<button type="button" class="conv-item${c.id === chat.convId ? ' active' : ''}" data-action="chat.openConv" data-id="${c.id}">
    ${(c.unread_count || 0) > 0 ? `<span class="conv-unread-dot" data-unread-dot="${c.id}"></span>` : ''}
    ${renderAvatarHtml(peer.avatar, peer.name, 'conv-avatar', peer.id)}
    <span class="conv-item-top">
      <span class="conv-item-name">${usernameHtml(peer.name || TEXT.CHAT_UNKNOWN_USER)}${deactivatedTag(peer.name)}</span>
      <span class="conv-item-role glass glass--solid">${escHtml(peer.role)}</span>
      <span class="conv-item-time">${escHtml(time)}</span>
    </span>
    <span class="conv-item-preview">${escHtml(preview)}</span>
  </button>`;
}

export function renderConvList(list) {
  if (!list.length) return `<div class="empty-state empty-state--small"><p>${TEXT.CHAT_EMPTY_NO_CONVS}</p></div>`;
  return list.map(renderConvItem).join('');
}

/** Chat pane skeleton (v1 renderChatFrame parity): head, messages, drop hint, stage, input bar. */
export function renderChatFrame(conv) {
  const peer = conv && conv.id ? chatPeerOf(conv) : { id: null, name: '', role: '', avatar: '' };
  const closed = conv && conv.status && conv.status !== STATUS.ACTIVE;
  return `<div class="chat-head glass">
      <button type="button" class="chat-back glass" data-action="chat.back">&larr; ${TEXT.CHAT_BACK_TO_LIST}</button>
      <div class="chat-head-main">
        <span class="chat-peer-name">${peer.name ? usernameHtml(peer.name) : escHtml(TEXT.CHAT_UNKNOWN_USER)}${deactivatedTag(peer.name)}</span>
        <span class="chat-peer-tag glass glass--solid">${escHtml(peer.role)}</span>
      </div>
      ${peer.id ? `<button type="button" class="chat-peer-profile-btn" title="${TEXT.PROFILE_PANEL_TITLE}" data-action="chat.openProfile" data-id="${peer.id}">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
          <circle cx="12" cy="8" r="3.6"/><path d="M4.6 19.4c1.6-3.3 4.2-5 7.4-5s5.8 1.7 7.4 5"/>
        </svg>
      </button>` : ''}
    </div>
    <div class="chat-messages" id="chat-messages"><div class="empty-state empty-state--small">${loaderHtml()}</div></div>
    <div class="chat-drop-hint hidden" id="chat-drop-hint">${TEXT.CHAT_DROP_HINT}</div>
    <div class="chat-stage hidden glass" id="chat-stage"></div>
    <div class="chat-input-bar glass${closed ? ' chat-input-bar--closed' : ''}">
      ${closed
        ? `<p class="chat-closed-tip">${TEXT.CHAT_CLOSED_TIP}</p>`
        : `<textarea id="chat-input" class="form-input chat-textarea" rows="1" placeholder="${TEXT.CHAT_INPUT_PLACEHOLDER}"></textarea>
           <div class="chat-actions">
             <div class="chat-plus-wrap" id="chat-plus-wrap">
               <div class="chat-plus-pop glass glass--float">
                 <label class="chat-pop-item" for="chat-image-input">${TEXT.CHAT_ATTACH_IMAGE}</label>
                 <label class="chat-pop-item" for="chat-file-input">${TEXT.CHAT_ATTACH_FILE}</label>
                 <button type="button" class="chat-pop-item" data-action="chat.plusSigning">${TEXT.SIGNING_MODAL_TITLE}</button>
                 <button type="button" class="chat-pop-item" data-action="chat.plusDraft">${TEXT.CHAT_BTN_DRAFT_CONTRACT}</button>
               </div>
               <input type="file" id="chat-image-input" accept="image/*" class="sr-file-input" data-action="chat.image">
               <input type="file" id="chat-file-input" class="sr-file-input" data-action="chat.file">
               <button type="button" class="chat-plus-btn glass glass--pressable" aria-label="${TEXT.CHAT_PLUS_ARIA}" data-action="chat.plus">
                 <span class="plus-bar plus-h"></span><span class="plus-bar plus-v"></span>
               </button>
             </div>
             <button type="button" class="btn btn-sm chat-send glass glass--pressable" id="chat-send-btn" data-action="chat.send">${TEXT.CHAT_BTN_SEND}</button>
           </div>`}
    </div>`;
}

export function renderChatPlaceholder() {
  return `<div class="chat-placeholder">
    <span class="chat-placeholder-dots" aria-hidden="true"><span></span><span></span><span></span><span></span></span>
    <p class="chat-placeholder-title">${TEXT.CHAT_PLACEHOLDER_TITLE}</p>
    <p class="chat-placeholder-sub">${TEXT.CHAT_PLACEHOLDER_SUB}</p>
  </div>`;
}

/** Progress ring for stage items and attachment loading skeletons (v1 parity: ring-track/ring-bar). */
export function chatStageRing(p) {
  const C = 2 * Math.PI * 13;
  const off = C * (1 - Math.max(0, Math.min(100, p)) / 100);
  return `<svg class="chat-stage-ring" viewBox="0 0 32 32" aria-hidden="true">
    <circle class="ring-track" cx="16" cy="16" r="13"></circle>
    <circle class="ring-bar" cx="16" cy="16" r="13" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"></circle>
  </svg>`;
}

// `i` is the v1 stagger slot (--i entrance delay consumed by CSS in V-2-5);
// deliberately kept in the signature so call sites do not churn at that batch.
export function renderChatBubble(m, i) {
  const mine = state.user && m.sender_user_id === state.user.id;
  const sideCls = mine ? 'chat-bubble--mine' : 'chat-bubble--theirs';
  const msgCls = mine ? 'chat-msg--mine' : 'chat-msg--theirs';
  const time = `<span class="chat-msg-time">${escHtml(fmtDateTime(m.created_at))}</span>`;
  if (m.kind === 'signing_request') return renderSigningRequestBubble(m, mine, msgCls, sideCls, time);
  if (m.kind === 'signing_response') {
    const text = renderSigningResponseText(m, mine);
    return `<div class="chat-msg ${msgCls}"><div class="chat-bubble glass ${sideCls} chat-bubble--breathe" data-mid="${m.id}">${text}</div>${time}</div>`;
  }
  if (m.kind === 'image' || m.kind === 'file') {
    const mediaCls = m.kind === 'file' ? ' chat-bubble--file' : '';
    const hasContent = !!(m.body || m.thumb);
    const inner = hasContent
      ? renderChatMediaInner(m.kind, m.body, m.name, m.thumb, m.id)
      : chatStageRing(30);
    const loading = hasContent ? '' : ' chat-bubble--loading';
    const attach = hasContent ? '' : ` data-attach="${m.id}" data-attach-kind="${m.kind}"`;
    return `<div class="chat-msg ${msgCls}"><div class="chat-bubble glass ${sideCls} chat-bubble--media${mediaCls}${loading}"${attach} data-mid="${m.id}">${inner}</div>${time}</div>`;
  }
  // contract event bubbles keep the same breath highlight as the signing flow (v1 parity)
  const inner = m.kind === 'contract'
    ? renderContractInner(m)
    : escHtml(m.body || '');
  const breathe = m.kind === 'contract' ? ' chat-bubble--breathe' : '';
  return `<div class="chat-msg ${msgCls}"><div class="chat-bubble glass ${sideCls}${breathe}" data-mid="${m.id}">${inner}</div>${time}</div>`;
}

function renderSigningRequestBubble(m, mine, msgCls, sideCls, time) {
  let s = {};
  try { s = typeof m.body === 'string' ? JSON.parse(m.body) : (m.body || {}); } catch { /* bad body: empty state */ }
  const recipient = !mine;
  // signing id must be numeric only (audit hardening): arbitrary strings would leak
  // into data attributes / attribute selectors
  const signingId = /^\d+$/.test(String(s.id || '')) ? String(s.id) : '';
  const pending = s.status === STATUS.PENDING;
  const rejected = s.status === STATUS.REJECTED;
  const signed = s.status === STATUS.SIGNED;
  const price = Number(s.price) || 0;
  const methodName = s.method === 'online' ? TEXT.SIGNING_METHOD_ONLINE : TEXT.SIGNING_METHOD_OFFLINE;
  const title = mine ? TEXT.CHAT_SIGNING_MINE_TITLE : TEXT.CHAT_SIGNING_REQUEST_TITLE;
  const actions = (pending && recipient && signingId)
    ? `<span class="signing-bubble-actions"><button type="button" class="btn btn-sm glass glass--pressable" data-action="chat.respond" data-id="${escHtml(signingId)}" data-accept="1">${TEXT.BTN_SIGNING_CONFIRM}</button><button type="button" class="btn btn-sm btn-outline glass glass--pressable" data-action="chat.respond" data-id="${escHtml(signingId)}" data-accept="0">${TEXT.BTN_SIGNING_REJECT}</button></span>`
    : '';
  const done = rejected ? ' signing-bubble--done' : '';
  return `<div class="chat-msg ${msgCls}"><div class="chat-bubble glass ${sideCls} signing-bubble chat-bubble--breathe${done}" data-signing-id="${escHtml(signingId)}" data-mid="${m.id}"><div class="signing-bubble-title">${escHtml(title)}</div><div class="signing-bubble-row"><span>${TEXT.CHAT_SIGNING_PRICE}</span><b>${price} ${TEXT.PRICE_UNIT}</b></div><div class="signing-bubble-row"><span>${TEXT.CHAT_SIGNING_SCHEDULE}</span><b>${escHtml(expectedTimeText(s.schedule))}</b></div><div class="signing-bubble-row"><span>${TEXT.CHAT_SIGNING_METHOD}</span><b>${methodName}</b></div>${actions}${rejected ? `<p class="signing-bubble-status">${TEXT.SIGNING_REJECTED_TEXT}</p>` : ''}${signed ? `<p class="signing-bubble-signed-tip">${escHtml(TEXT.CHAT_SIGN_TIP)}</p><button type="button" class="btn glass glass--pressable signing-bubble-draft-btn" data-action="chat.plusDraft">${TEXT.CHAT_BTN_DRAFT_CONTRACT}</button>` : ''}${signed ? '' : `<p class="signing-bubble-funds">${TEXT.FUNDS_NOTE_SHORT}</p>`}</div>${time}</div>`;
}

function renderSigningResponseText(m, mine) {
  let r = {};
  try { r = typeof m.body === 'string' ? JSON.parse(m.body) : (m.body || {}); } catch { /* empty */ }
  const label = mine
    ? (r.accept ? TEXT.SIGNING_MY_CONFIRMED : TEXT.SIGNING_MY_REJECTED)
    : (r.accept ? TEXT.SIGNING_CONFIRMED : TEXT.SIGNING_REJECTED);
  return escHtml(label);
}

// contract bubble text goes directly into the bubble (v1 parity — no extra wrapper
// class; a wrapper would need its own CSS rule and add zero visual value)
function renderContractInner(m) {
  const mine = state.user && m.sender_user_id === state.user.id;
  return escHtml(mine ? TEXT.CHAT_CONTRACT_BUBBLE_MINE : TEXT.CHAT_CONTRACT_BUBBLE_OTHER);
}

export function renderChatMediaInner(kind, body, name, thumb, mid) {
  if (!body && !thumb) return `<span class="chat-attach-fail">${TEXT.CHAT_ATTACH_REMOVED}</span>`;
  if (kind === 'image') {
    // body present = full image (own optimistic send / lazy-load refilled) -> data-full
    // opens the viewer directly; thumb-only = click fetches the attachment
    const full = body ? ' data-full="1"' : '';
    return `<img src="${escHtml(thumb || body || '')}" alt="${TEXT.CHAT_ATTACH_IMAGE}" loading="lazy" data-mid="${escHtml(String(mid || ''))}"${full} data-action="chat.openImage">`;
  }
  // file card: icon + info (name, size) + download anchor. Client scheme self-guard:
  // only data: URLs become a downloadable href (server already enforces the data:
  // prefix; this is defense in depth against javascript: and friends).
  const href = String(body || '').startsWith('data:') ? body : '#';
  return `<div class="chat-file">
    <span class="chat-file-icon">${escHtml(chatFileExt(name))}</span>
    <span class="chat-file-info">
      <span class="chat-file-name">${escHtml(name || TEXT.CHAT_FILE_FALLBACK)}</span>
      <span class="chat-file-size">${chatFileSize(body)}</span>
    </span>
    <a class="chat-file-dl" href="${escHtml(href)}" download="${escHtml(name || '')}">${TEXT.CHAT_DOWNLOAD}</a>
  </div>`;
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

/**
 * Pre-send staging area: thumb + progress ring + name + delete (v1 renderStageBox
 * parity). Shared with the complaints attach staging UI (same v1 global component;
 * the del button's data-action differs per caller).
 */
export function renderStageBox(items, el, unstageAction = 'chat.unstage') {
  if (!el) return;
  if (!items.length) { el.classList.add('hidden'); el.innerHTML = ''; return; }
  el.classList.remove('hidden');
  el.innerHTML = items.map(it => {
    const media = it.kind === 'image' && it.dataUrl
      ? `<img src="${escHtml(it.dataUrl)}" alt="">`
      : `<span class="chat-stage-file"><span class="chat-stage-ext">${escHtml(chatFileExt(it.name))}</span></span>`;
    const nameRow = it.kind === 'file' ? `<span class="chat-stage-name">${escHtml(it.name)}</span>` : '';
    return `<div class="chat-stage-item glass glass--solid${it.kind === 'file' ? ' chat-stage-item--file' : ''}">
      <div class="chat-stage-thumb glass glass--solid">${media}${it.ready ? '' : chatStageRing(it.progress)}</div>
      ${nameRow}
      <button type="button" class="chat-stage-del glass glass--float" data-action="${unstageAction}" data-id="${it.id}" aria-label="${TEXT.BTN_CANCEL}">✕</button>
    </div>`;
  }).join('');
}

/**
 * In-place signed-caption injection into a signing_request bubble (idempotent, v1 parity).
 * Rebuilds the bubble bottom to: ① merged tip (funds note folded into CHAT_SIGN_TIP)
 * ② full-width draft-contract button. Removes the standalone funds line.
 */
export function chatInjectSignCaption(signingId) {
  if (!/^\d+$/.test(String(signingId || ''))) return;
  const bubble = document.querySelector(`.chat-bubble[data-signing-id="${signingId}"]`);
  if (!bubble) return;
  if (bubble.querySelector('.signing-bubble-draft-btn')) return; // idempotent: already rebuilt
  let tip = bubble.querySelector('.signing-bubble-status');
  if (!tip) { tip = document.createElement('p'); bubble.appendChild(tip); }
  tip.className = 'signing-bubble-signed-tip';
  tip.textContent = TEXT.CHAT_SIGN_TIP;
  const funds = bubble.querySelector('.signing-bubble-funds');
  if (funds) funds.remove();
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn glass glass--pressable signing-bubble-draft-btn';
  btn.textContent = TEXT.CHAT_BTN_DRAFT_CONTRACT;
  btn.dataset.action = 'chat.plusDraft';
  bubble.appendChild(btn);
}

export function chatNowStamp() { return new Date().toISOString(); }
