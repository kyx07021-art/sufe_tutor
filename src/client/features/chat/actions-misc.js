/**
 * chat feature actions: dropzone, plus menu, signing responses, image viewer,
 * navigation. (chatStageRing/renderChatStage live in render.js / actions-send.js —
 * single definition each; chatInjectSignCaption lives in render.js.)
 */
import { TEXT } from '../../constants/text.js';
import { chat } from './chat-state.js';
import { api } from '../../core/api.js';
import { showToast, openImageViewer, confirm } from '../../core/ui.js';
import { renderChatPlaceholder, chatInjectSignCaption } from './render.js';
import { chatStageFiles } from './actions-send.js';
import { loadConversations, chatTeardown } from './actions-list.js';
import { openProfilePanel } from '../teacher/actions.js';

// Dropzone is bound once at document level (the chat frame gets its innerHTML
// replaced per conversation; a frame-level binding would die with the first switch).
// Handlers filter by #chat-frame so drags anywhere else are ignored.
let dropBound = false;
export function chatBindDropzone() {
  if (dropBound || typeof document === 'undefined') return;
  dropBound = true;
  document.addEventListener('dragover', e => {
    const frame = e.target && e.target.closest ? e.target.closest('#chat-frame') : null;
    if (!frame) return;
    e.preventDefault();
    const hint = frame.querySelector('.chat-drop-hint');
    if (hint) hint.classList.remove('hidden');
  });
  document.addEventListener('dragleave', e => {
    const frame = e.target && e.target.closest ? e.target.closest('#chat-frame') : null;
    if (!frame) return;
    const hint = frame.querySelector('.chat-drop-hint');
    if (hint && !frame.contains(e.relatedTarget)) hint.classList.add('hidden');
  });
  document.addEventListener('drop', e => {
    const frame = e.target && e.target.closest ? e.target.closest('#chat-frame') : null;
    if (!frame) return;
    e.preventDefault();
    const hint = frame.querySelector('.chat-drop-hint');
    if (hint) hint.classList.add('hidden');
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) chatStageFiles(e.dataTransfer.files);
  });
}

export function toggleChatPlus() {
  const w = document.getElementById('chat-plus-wrap');
  if (w) w.classList.toggle('open');
}

export function closeChatPlus() {
  const w = document.getElementById('chat-plus-wrap');
  if (w) w.classList.remove('open');
}

/** Head profile button: open the peer's profile panel (v1 chat-head parity). */
export function chatOpenProfile(userId) {
  const id = Number(userId);
  if (!Number.isInteger(id) || !id) return;
  openProfilePanel(id);
}

export async function chatPlusDraft() {
  closeChatPlus();
  if (chat.convId) {
    const mod = await import('../contract/index.js');
    mod.actions.openContractDraftModal(chat.convId);
  }
}

export async function chatPlusSigning() {
  closeChatPlus();
  if (chat.convId) {
    const mod = await import('../contract/index.js');
    mod.actions.openSigningModal(chat.convId);
  }
}

export async function respondSigning(signingId, accept) {
  const doRespond = async capToken => {
    try {
      await api(`/api/signing-requests/${signingId}/respond`, { method: 'POST', body: accept ? { accept, capToken } : { accept } });
      document.querySelectorAll(`[data-signing-id="${signingId}"]`).forEach(el => {
        const actions = el.querySelector('.signing-bubble-actions');
        if (actions) actions.remove();
        if (!accept) {
          el.classList.add('signing-bubble--done');
          const status = el.querySelector('.signing-bubble-status');
          if (status) status.textContent = TEXT.SIGNING_REJECTED_TEXT;
          else { const p = document.createElement('p'); p.className = 'signing-bubble-status'; p.textContent = TEXT.SIGNING_REJECTED_TEXT; el.appendChild(p); }
        }
      });
      if (accept) chatInjectSignCaption(signingId);
      showToast(accept ? TEXT.SIGNING_MY_CONFIRMED : TEXT.SIGNING_MY_REJECTED);
    } catch (err) { showToast(err.message); }
  };
  if (accept) {
    confirm({ message: TEXT.CONFIRM_SIGNING_ACCEPT, needReAuth: true, onConfirm: capToken => doRespond(capToken) });
    return;
  }
  doRespond();
}

export function backToConvList() {
  chatTeardown(); // stop polling + abort staged uploads + reset per-conversation state
  const frame = document.getElementById('chat-frame');
  if (frame) frame.innerHTML = renderChatPlaceholder();
  loadConversations();
}

export async function chatOpenImage(mid, img) {
  if (img && img.dataset.full === '1') { openImageViewer(img.src); return; }
  const convId = chat.convId;
  if (!convId || !mid) { showToast(TEXT.CHAT_ATTACH_FAIL); return; }
  try {
    const data = await api(`/api/conversations/${convId}/messages/${mid}/attachment`);
    if (!data.body) { showToast(TEXT.CHAT_ATTACH_FAIL); return; }
    if (img) { img.dataset.full = '1'; img.src = data.body; }
    openImageViewer(data.body);
  } catch { showToast(TEXT.CHAT_ATTACH_FAIL); }
}
