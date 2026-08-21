/**
 * chat feature actions: conversation list + conversation lifecycle (polling,
 * attachment lazy-load, preview bump, pending-open flow). Send/upload pipeline
 * lives in actions-send.js (which depends on this module's bump — one-way edge).
 */
import { CONFIG } from '../../../shared/config.js';
import { STATUS } from '../../../shared/enums.js';
import { TEXT } from '../../constants/text.js';
import { chat } from './chat-state.js';
import { state, registerLogoutReset } from '../../core/state.js';
import { api, ensureAuth } from '../../core/api.js';
import { dhGet, dhPeek, dhOnDomainRefresh } from '../../core/datahub.js';
import { showToast } from '../../core/ui.js';
import { escHtml, loaderHtml } from '../../core/dom.js';
import { selectPage, setBadge } from '../../core/router.js';
import { renderConvList as renderConvListHtml, renderChatFrame, renderChatBubble, renderStageBox, renderChatMediaInner, chatInjectSignCaption } from './render.js';
import { setChatConvById } from '../contract/actions-chat-bridge.js';

/** Logout / identity switch: stop polling, abort staged uploads, reset per-conversation state. */
export function chatTeardown() {
  stopChatPolling();
  chatAbortStagedUploads();
  chat.convId = null;
  chat.lastMsgId = 0;
  chat.pollBusy = false;
  // Mobile list/chat switch reset (features/chat.css ≤860px contract): back-to-list,
  // page leave and logout all funnel through here; without the reset the class survives
  // page switches (the .chats-shell is persistent DOM) and the next visit shows a stale
  // chat pane instead of the default list.
  const shell = document.querySelector('.chats-shell');
  if (shell) shell.classList.remove('chats-show-chat');
}
// v1 app-auth parity: logout always stops chat polling and clears staging
// (prevents cross-account staged residue and orphan uploads on the server)
registerLogoutReset(chatTeardown);

// Q-3b-F2: chat cache re-bind — after dhRefreshDomain('chat') replaces the cache (version probe
// detects a chat-domain bump), chat.list still holds the old array reference, so list rows keep
// stale unread/preview counts while the badge poll (router reads dhGet directly) uses the new
// cache -> red dot with no matching list row. Mirror the fresh cache back into chat.list.
export function rebindChatCache() {
  const d = dhPeek('/api/conversations');
  if (d && Array.isArray(d.conversations)) {
    chat.list = d.conversations;
    renderConvList();
  }
}
dhOnDomainRefresh('chat', rebindChatCache);

/** Page leave hook (v1 selectPage parity): mark the open conversation read, then teardown. */
export function chatLeavePage() {
  if (chat.convId) markReadConv(chat.convId); // messages arriving in the last poll window get read
  chatTeardown();
}

export function chatConvById(id) { return chat.list.find(c => c.id === id) || null; }
setChatConvById(chatConvById);

export function enterMyChats() {
  stopChatPolling();
  setBadge('my-chats', 0); // entering the page kills the dot immediately (poll skips current page)
  const el = document.getElementById('my-chats-list');
  if (!el) return;
  el.innerHTML = `<div class="empty-state empty-state--small">${loaderHtml()}</div>`;
  loadConversations();
}

export async function loadConversations() {
  try {
    const data = await dhGet('/api/conversations', { domain: 'chat' });
    chat.list = data.conversations || [];
    renderConvList();
    // R26 parity: cross-page "chat with student" target opens once the list is ready
    // (goChatWithStudent sets the pending target; stale list would miss it)
    if (chat.pendingOpen != null) {
      const target = chat.pendingOpen;
      chat.pendingOpen = null;
      const conv = chat.list.find(c => c.student_user_id === target);
      if (conv) openConversation(conv.id);
      else showToast(TEXT.CHAT_CONV_NOT_FOUND);
    }
  } catch (err) {
    const el = document.getElementById('my-chats-list');
    if (el) el.innerHTML = `<div class="empty-state empty-state--small"><p>${TEXT.ERROR_LOAD_PREFIX}${escHtml(err.message)}</p></div>`;
  }
}

/** R26 cross-page entry: jump from a demand card to the conversation with that student. */
export function goChatWithStudent(studentId) {
  if (!ensureAuth()) return;
  if (!Number.isInteger(+studentId)) return;
  const conv = chat.list.find(c => c.student_user_id === +studentId);
  if (conv && state.page === 'my-chats') { openConversation(conv.id); return; }
  chat.pendingOpen = +studentId;
  if (state.page === 'my-chats') loadConversations(); // on the page: refresh list then auto-open (stale list guard)
  else selectPage('my-chats');
}

export function renderConvList() {
  const el = document.getElementById('my-chats-list');
  if (el) el.innerHTML = renderConvListHtml(chat.list);
}

/**
 * AI-9: local sync of a conversation to closed after a close success / 403 correction
 * (F7 immediate — not waiting for the next fetch). chat.list is a module-private array
 * (invalidate only clears the datahub cache, not it), so it must be mutated in place +
 * re-rendered; when the conversation is currently open, doCloseRelation re-opens the
 * frame afterwards to run the closed branch.
 */
export function syncClosedConversation(convId) {
  const c = chat.list.find(x => x.id === convId);
  if (c && c.status !== STATUS.CLOSED) { c.status = STATUS.CLOSED; renderConvList(); }
}

/** Mark conversation read: local unread clear + re-render immediately, silent POST after. */
export function markReadConv(convId) {
  const c = chat.list.find(x => x.id === convId);
  if (c) c.unread_count = 0;
  renderConvList();
  api(`/api/conversations/${convId}/read`, { method: 'POST', body: {} }).catch(() => {});
}

/** Bump the conversation preview after send/poll and move it to list top (v1 parity). */
export function chatBumpConvPreview(convId, lastMsg) {
  const c = chat.list.find(x => x.id === convId);
  if (!c) return;
  c.last_body = lastMsg.body;
  c.last_kind = lastMsg.kind;
  c.last_at = lastMsg.created_at;
  c.last_sender = lastMsg.sender_user_id;
  chat.list.splice(chat.list.indexOf(c), 1);
  chat.list.unshift(c);
  renderConvList();
}

export function chatAbortStagedUploads() {
  chat.staged.forEach(it => {
    if (it._xhr) { it._xhr.abort(); it._aborted = true; }
    if (it.uploadId) api(`/api/uploads/${it.uploadId}`, { method: 'DELETE', body: {} }).catch(() => {});
  });
  chat.staged = [];
  renderStageBox(chat.staged, document.getElementById('chat-stage'));
}

export async function openConversation(convId) {
  chatAbortStagedUploads();
  stopChatPolling();
  chat.convId = convId;
  markReadConv(convId); // unread dot off + active highlight (renderConvList re-renders both)
  const frame = document.getElementById('chat-frame');
  if (frame) frame.innerHTML = renderChatFrame(chatConvById(convId));
  // Mobile switch to the chat pane (features/chat.css ≤860px media query). Set
  // synchronously right after the frame renders — before the message fetch — so the
  // pane is visible even on a load failure, not only on the happy path.
  const shell = frame ? frame.closest('.chats-shell') : null;
  if (shell) shell.classList.add('chats-show-chat');
  try {
    const data = await api(`/api/conversations/${convId}/messages`, { method: 'GET' });
    if (chat.convId !== convId) return; // stale response: user already switched conversations
    // conversation snapshot refresh: the messages endpoint carries the conversation's
    // current public row (demand_id backfill / status change since the list loaded) —
    // merge it into the list cache in place (v1 parity; stale fields otherwise persist
    // until the next full list reload)
    if (data.conversation) {
      const ex = chat.list.find(c => c.id === convId);
      if (ex) {
        const wasClosed = ex.status === STATUS.CLOSED;
        Object.assign(ex, data.conversation);
        renderConvList();
        // AI-9: the peer closed the conversation (snapshot status flips active→closed) —
        // input-bar disable / action-entry hiding is carried by the frame re-render (before
        // this the list was updated only, leaving the frame writable until the next 403).
        if (!wasClosed && ex.status === STATUS.CLOSED) {
          const frame = document.getElementById('chat-frame');
          if (frame) frame.innerHTML = renderChatFrame(chatConvById(convId));
        }
      }
    }
    const msgs = data.messages || [];
    const box = document.getElementById('chat-messages');
    if (!box) return;
    box.innerHTML = msgs.length
      ? msgs.map(renderChatBubble).join('')
      : `<div class="empty-state empty-state--small"><p>${TEXT.CHAT_EMPTY_NO_MESSAGES}</p></div>`;
    chat.lastMsgId = msgs.length ? msgs[msgs.length - 1].id : 0;
    box.scrollTop = box.scrollHeight;
    if (msgs.some(m => (m.kind === 'image' || m.kind === 'file') && !m.body)) chatLazyLoadAttachments();
    chatStartPolling();
    if (typeof window !== 'undefined' && window.innerWidth > CONFIG.BREAKPOINT_MOBILE) {
      const ta = document.getElementById('chat-input');
      if (ta) ta.focus();
    }
  } catch (err) {
    if (chat.convId !== convId) return; // stale error: do not overwrite the new conversation's box
    const box = document.getElementById('chat-messages');
    if (box) box.innerHTML = `<div class="empty-state empty-state--small"><p>${TEXT.ERROR_LOAD_PREFIX}${escHtml(err.message)}</p></div>`;
  }
}

export function chatStartPolling() {
  stopChatPolling();
  chat.pollTimer = setInterval(chatPollTick, CONFIG.CHAT_POLL_MS);
}

export function stopChatPolling() {
  if (chat.pollTimer) { clearInterval(chat.pollTimer); chat.pollTimer = null; }
}

export async function chatPollTick() {
  // tick self-check: page switch / logout / closed conversation / previous round in
  // flight / optimistic send in flight -> no request (v1 parity)
  if (state.page !== 'my-chats' || !state.user || !chat.convId || chat.pollBusy || chat.optimisticSending) return;
  const convId = chat.convId;
  chat.pollBusy = true;
  try {
    const data = await api(`/api/conversations/${convId}/messages?sinceId=${chat.lastMsgId}`, { method: 'GET' });
    if (chat.convId !== convId) return; // conversation switched, discard stale response
    const fresh = (data.messages || []).filter(m => m.id > chat.lastMsgId);
    if (!fresh.length) return;
    const box = document.getElementById('chat-messages');
    if (!box) return;
    if (box.querySelector('.empty-state')) box.innerHTML = '';
    fresh.forEach(m => {
      if (!box.querySelector(`.chat-bubble[data-mid="${m.id}"]`)) box.insertAdjacentHTML('beforeend', renderChatBubble(m));
    });
    chat.lastMsgId = fresh[fresh.length - 1].id;
    box.scrollTop = box.scrollHeight;
    if (fresh.some(m => (m.kind === 'image' || m.kind === 'file') && !m.body)) chatLazyLoadAttachments();
    chatBumpConvPreview(convId, fresh[fresh.length - 1]);
    // #150 parity: peer confirmed signing -> inject the caption into the paired
    // request bubble (idempotent; reopening the conversation renders the final state)
    fresh.filter(m => m.kind === 'signing_response').forEach(m => {
      let r = {};
      try { r = typeof m.body === 'string' ? JSON.parse(m.body) : (m.body || {}); } catch { /* bad body */ }
      if (r.accept && /^\d+$/.test(String(r.requestId || ''))) chatInjectSignCaption(r.requestId);
    });
    // conversation on screen received the other side's messages -> mark read in place
    if (fresh.some(m => m.sender_user_id !== state.user.id)) markReadConv(convId);
  } catch { /* network blips are silent; next tick self-heals */ }
  finally { chat.pollBusy = false; }
}

/** Attachment lazy-load: refill loading skeletons; bounded concurrency; failure shows fail text. */
export function chatLazyLoadAttachments() {
  const convId = chat.convId;
  if (!convId) return;
  setTimeout(async () => {
    const pending = [...document.querySelectorAll('.chat-bubble--loading[data-attach]')];
    const CONCURRENCY = CONFIG.CHAT_ATTACH_CONCURRENCY;
    let i = 0;
    const worker = async () => {
      while (i < pending.length) {
        const el = pending[i++];
        if (chat.convId !== convId) return; // conversation switched, drop the wave
        const mid = el.dataset.attach;
        const kind = el.dataset.attachKind || 'image';
        try {
          const data = await api(`/api/conversations/${convId}/messages/${mid}/attachment`);
          if (chat.convId !== convId) return;
          el.innerHTML = renderChatMediaInner(kind, data.body || '', data.name || '');
          el.classList.remove('chat-bubble--loading');
          delete el.dataset.attach;
        } catch {
          el.classList.remove('chat-bubble--loading');
          el.innerHTML = `<span class="chat-attach-fail">${TEXT.CHAT_ATTACH_FAIL}</span>`;
          // delete data-attach on failure too — otherwise permanently failed attachments
          // (deactivated sender's files were cleared) get re-fetched on every lazy-load trigger
          delete el.dataset.attach;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker));
  }, CONFIG.CHAT_SLIDE_DELAY_MS);
}
