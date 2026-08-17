/**
 * chat feature actions: staging UI, plus menu, signing responses, navigation.
 */
import { TEXT } from './text.js';
import { chat } from './chat-state.js';
import { api } from '../../core/api.js';
import { showToast, openImageViewer, confirm } from '../../core/ui.js';
import { renderChatPlaceholder, renderStageBox, renderChatMediaInner } from './render.js';
import { chatStageFiles } from './actions-send.js';

export function chatStageRing(p) {
  const v = Math.max(0, Math.min(100, Math.round(p || 0)));
  const r = 10;
  const c = 2 * Math.PI * r;
  const off = c - (v / 100) * c;
  return `<svg class="chat-stage-ring" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
    <circle cx="12" cy="12" r="${r}" fill="none" stroke="currentColor" stroke-opacity="0.2" stroke-width="3"></circle>
    <circle cx="12" cy="12" r="${r}" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="${c}" stroke-dashoffset="${off}" transform="rotate(-90 12 12)"></circle>
  </svg>`;
}

export function renderChatStage() {
  renderStageBox(chat.staged, document.getElementById('chat-stage'));
}

export function chatBindDropzone() {
  const frame = document.getElementById('chat-frame');
  if (!frame) return;
  frame.addEventListener('dragover', e => { e.preventDefault(); frame.classList.add('chat-frame--drop'); });
  frame.addEventListener('dragleave', () => frame.classList.remove('chat-frame--drop'));
  frame.addEventListener('drop', e => {
    e.preventDefault();
    frame.classList.remove('chat-frame--drop');
    const files = e.dataTransfer ? [...e.dataTransfer.files] : [];
    if (files.length) chatStageFiles(files);
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

export function chatInjectSignCaption(signingId) {
  if (!/^\d+$/.test(String(signingId || ''))) return;
  const bubble = document.querySelector(`[data-signing-id="${signingId}"]`);
  if (!bubble) return;
  if (bubble.querySelector('.signing-bubble-draft-btn')) return;
  const tip = document.createElement('p');
  tip.className = 'signing-bubble-signed-tip';
  tip.textContent = TEXT.CHAT_SIGN_TIP;
  bubble.appendChild(tip);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn glass glass--pressable signing-bubble-draft-btn';
  btn.textContent = TEXT.CHAT_BTN_DRAFT_CONTRACT;
  btn.dataset.action = 'chat.plusDraft';
  bubble.appendChild(btn);
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
  chat.convId = null;
  stopChatPolling();
  const frame = document.getElementById('chat-frame');
  if (frame) frame.innerHTML = renderChatPlaceholder();
  loadConversations();
}

export function chatScrollToBottom(smooth) {
  const box = document.getElementById('chat-messages');
  if (!box) return;
  box.scrollTo({ top: box.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
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

export async function chatDownload(mid) {
  const convId = chat.convId;
  if (!convId || !mid) { showToast(TEXT.CHAT_ATTACH_FAIL); return; }
  try {
    const data = await api(`/api/conversations/${convId}/messages/${mid}/attachment`);
    const href = String(data.body || '').startsWith('data:') ? data.body : '#';
    const a = document.createElement('a');
    a.href = href; a.download = data.name || TEXT.CHAT_FILE_FALLBACK;
    document.body.appendChild(a); a.click(); a.remove();
  } catch { showToast(TEXT.CHAT_ATTACH_FAIL); }
}

export async function chatLazyLoadAttachments() {
  const convId = chat.convId;
  if (!convId) return;
  const pending = [...document.querySelectorAll('.chat-bubble--loading[data-attach]')];
  for (const el of pending) {
    if (chat.convId !== convId) return;
    const mid = el.dataset.attach;
    const kind = el.dataset.attachKind || 'image';
    try {
      const data = await api(`/api/conversations/${convId}/messages/${mid}/attachment`);
      if (chat.convId !== convId) return;
      el.innerHTML = renderChatMediaInner(kind, data.body || '', data.name || '', '', mid, null);
      el.classList.remove('chat-bubble--loading');
      delete el.dataset.attach;
      delete el.dataset.attachKind;
    } catch {
      el.classList.remove('chat-bubble--loading');
      delete el.dataset.attach;
      delete el.dataset.attachKind;
    }
  }
}

