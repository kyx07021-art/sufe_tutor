/**
 * chat feature actions: polling, optimistic send and upload pipeline.
 *
 * Optimistic send contract (B4 audit):
 * - temporary negative-id bubbles are rendered before the POST; input is cleared.
 * - while an optimistic send is in flight, polling is paused (no duplicate bubble).
 * - on success each temp bubble is replaced by a freshly rendered bubble merged
 *   from the local message + the server receipt id (receipt only carries
 *   {id,kind,name}; sender/body/thumb/created_at must come from the local copy,
 *   otherwise own messages render as theirs with empty content);
 *   if the real bubble already exists (polling race), the temp bubble is removed.
 * - on failure/partial success temp bubbles are removed and text restored.
 * - after send, the conversation list preview is bumped (parity with v1).
 */
import { CONFIG } from '../../../shared/config.js';
import { TEXT } from '../../constants/text.js';
import { chat } from './chat-state.js';
import { state } from '../../core/state.js';
import { api, apiUpload } from '../../core/api.js';
import { showToast, btnLoading, btnDone } from '../../core/ui.js';
import { renderChatBubble, renderStageBox, chatNowStamp } from './render.js';
import { chatBumpConvPreview } from './actions-list.js';

function tempId() {
  chat.optimisticSeq += 1;
  return -(900000 + chat.optimisticSeq);
}

function removeTempBubbles(ids) {
  const box = document.getElementById('chat-messages');
  if (!box) return;
  for (const id of ids) {
    const el = box.querySelector(`.chat-bubble[data-mid="${id}"]`);
    if (el) el.closest('.chat-msg')?.remove();
  }
}

function replaceTempWithReal(tempId, merged) {
  const box = document.getElementById('chat-messages');
  if (!box) return;
  const temp = box.querySelector(`.chat-bubble[data-mid="${tempId}"]`);
  if (!temp) return;
  if (box.querySelector(`.chat-bubble[data-mid="${merged.id}"]`)) {
    temp.closest('.chat-msg')?.remove();
    return;
  }
  const msg = temp.closest('.chat-msg');
  if (msg) msg.outerHTML = renderChatBubble(merged);
}

export async function sendChatMessage() {
  const ta = document.getElementById('chat-input');
  if (!ta) return;
  const text = ta.value.trim();
  const staged = chat.staged.slice();
  if (!text && !staged.length) { ta.focus(); return; }
  if (staged.some(it => !it.ready)) { showToast(TEXT.CHAT_STAGE_WAIT); return; }
  if (!chat.convId) return;
  if (chat.sending) return;
  const btn = document.getElementById('chat-send-btn');
  chat.sending = true;
  chat.optimisticSending = true;
  btnLoading(btn, TEXT.CHAT_BTN_SEND);
  const convId = chat.convId;
  const originalText = text;
  const optimistic = [];
  const batch = staged.map(it => ({ kind: it.kind, uploadId: it.uploadId }));
  if (text) batch.push({ kind: 'text', body: text });
  // Q-2d-F2 idempotency: a failed send retried with unchanged content reuses the same
  // batch keys (server dedups by key, so a timeout retry cannot insert twice); if the
  // content fingerprint changes (user edits before resending) it is treated as a new send.
  const fp = JSON.stringify([convId, batch]);
  const batchKey = (chat.pendingBatchKey && chat.pendingBatchFp === fp)
    ? chat.pendingBatchKey
    : `sb${(++chat.optimisticSeq).toString(36)}-${Date.now().toString(36)}`;
  chat.pendingBatchKey = batchKey;
  chat.pendingBatchFp = fp;
  const batchBody = batch.map((b, i) => ({ ...b, clientKey: `${batchKey}.${i}` }));

  // Server receipt only carries {id,kind,name}: keep the full local message with the
  // temp bubble and merge on replace so sender/body/thumb/created_at survive.
  batch.forEach((b, i) => {
    const id = tempId();
    const st = staged[i];
    const m = {
      id,
      sender_user_id: state.user ? state.user.id : null,
      kind: b.kind,
      body: b.kind === 'text' ? b.body : (st ? st.dataUrl : ''),
      name: st ? st.name : '',
      thumb: st ? st.thumb || '' : '',
      created_at: chatNowStamp(),
    };
    optimistic.push({ tempId: id, msg: m, text: b.kind === 'text' ? b.body : '' });
    const box = document.getElementById('chat-messages');
    if (box) {
      // v1 parity: first message into an empty conversation removes the empty-state
      // placeholder, otherwise the optimistic bubble stacks under it
      if (box.querySelector('.empty-state')) box.innerHTML = '';
      box.insertAdjacentHTML('beforeend', renderChatBubble(m));
    }
  });
  const box = document.getElementById('chat-messages'); if (box) box.scrollTop = box.scrollHeight;
  ta.value = '';
  chatAutogrow(ta);
  // clear the staging area immediately (v1 parity); restored on rollback below
  chat.staged = [];
  renderChatStage();

  try {
    const data = await api(`/api/conversations/${convId}/messages`, { method: 'POST', body: { batch: batchBody } });
    if (chat.convId !== convId) return;
    chat.pendingBatchKey = null; // Q-2d-F2: successful send retires the key (next send is fresh)
    chat.pendingBatchFp = '';
    const created = data.messages || [];
    const missingTexts = [];
    optimistic.forEach((o, i) => {
      const real = created[i];
      if (real && real.id > 0) {
        if (real.id > chat.lastMsgId) chat.lastMsgId = real.id;
        replaceTempWithReal(o.tempId, { ...o.msg, id: real.id });
      } else {
        removeTempBubbles([o.tempId]);
        if (o.msg.kind === 'text') missingTexts.push(o.text);
      }
    });
    const tempIds = optimistic.map(o => o.tempId);
    removeTempBubbles(tempIds);
    if (missingTexts.length) {
      const restored = [...missingTexts, ta.value].filter(Boolean).join('\n');
      ta.value = restored;
      chatAutogrow(ta);
      showToast(TEXT.CHAT_SEND_PARTIAL_FAILED);
    }
    if (optimistic.length) {
      const lastOp = optimistic[optimistic.length - 1].msg;
      // v1 parity: media messages bump with an empty body — never stuff a full
      // data URL (hundreds of KB) into the conversation list cache
      chatBumpConvPreview(convId, {
        body: lastOp.kind === 'text' ? lastOp.body : '',
        kind: lastOp.kind,
        name: lastOp.name || '',
        created_at: lastOp.created_at,
        sender_user_id: lastOp.sender_user_id,
      });
    }
  } catch (err) {
    // rollback: remove optimistic bubbles + restore input and staging area
    // (audit-flow rejection / network error are both retryable)
    if (chat.convId === convId) {
      removeTempBubbles(optimistic.map(o => o.tempId));
      ta.value = originalText ? [originalText, ta.value].filter(Boolean).join('\n') : ta.value;
      chatAutogrow(ta);
      chat.staged = staged;
      renderChatStage();
    }
    showToast(err.message);
  } finally {
    chat.sending = false;
    chat.optimisticSending = false;
    btnDone(btn, TEXT.CHAT_BTN_SEND);
  }
}

export function chatAutogrow(ta) {
  if (!ta) return;
  ta.style.height = 'auto';
  ta.style.height = Math.min(120, Math.max(40, ta.scrollHeight)) + 'px';
}

export function chatOnImagePicked(input) {
  const files = input ? [...input.files] : [];
  if (input) input.value = '';
  if (files.length) chatStageFiles(files);
}

export function chatOnFilePicked(input) {
  const files = input ? [...input.files] : [];
  if (input) input.value = '';
  if (files.length) chatStageFiles(files);
}

export function chatStageFiles(files) {
  files.forEach(f => {
    const item = { id: ++chat.stageSeq, name: f.name || TEXT.CHAT_FILE_FALLBACK, progress: 0, ready: false, uploadId: null, dataUrl: '', thumb: '', kind: 'file' };
    if ((f.type || '').startsWith('image/')) {
      item.kind = 'image';
      chat.staged.push(item);
      renderChatStage();
      const reader = new FileReader();
      reader.onload = () => chatShrinkImage(reader.result, (url, thumb) => chatDoUpload(item, url, thumb));
      reader.onerror = () => { chatUnstage(item.id); showToast(TEXT.CHAT_FILE_TOO_LARGE); };
      reader.readAsDataURL(f);
    } else {
      if (f.size > CONFIG.CHAT_FILE_MAX_BYTES) { showToast(TEXT.CHAT_FILE_TOO_LARGE); return; }
      chat.staged.push(item);
      renderChatStage();
      const reader = new FileReader();
      reader.onload = () => chatDoUpload(item, reader.result);
      reader.onerror = () => { chatUnstage(item.id); showToast(TEXT.CHAT_FILE_TOO_LARGE); };
      reader.readAsDataURL(f);
    }
  });
}

export async function chatUploadToServer(item, dataUrl, onProgress) {
  return apiUpload({ kind: item.kind, fileData: dataUrl, fileName: item.name, thumb: item.thumb || '' }, onProgress, xhr => { item._xhr = xhr; });
}

export async function chatDoUpload(item, dataUrl, thumbUrl) {
  item.dataUrl = dataUrl;
  item.thumb = thumbUrl || '';
  renderChatStage();
  try {
    const data = await chatUploadToServer(item, dataUrl, p => { item.progress = p == null ? 0 : Math.round(p * 100); renderChatStage(); });
    if (item._aborted) return;
    item.uploadId = data.id;
    item.progress = 100;
    item.ready = true;
    renderChatStage();
  } catch (err) {
    if (item._aborted) return;
    chatUnstage(item.id);
    showToast(err.message);
  }
}

export function chatShrinkImage(src, cb) {
  const img = new Image();
  img.onload = () => {
    const max = CONFIG.CHAT_IMG_MAX_SIDE;
    const k = Math.min(1, max / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * k));
    const h = Math.max(1, Math.round(img.height * k));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    cv.getContext('2d').drawImage(img, 0, 0, w, h);
    const url = cv.toDataURL('image/jpeg', CONFIG.CHAT_IMG_QUALITY);
    const tv = document.createElement('canvas');
    const ts = CONFIG.CHAT_IMG_THUMB_SIDE;
    const tk = Math.min(1, ts / Math.max(w, h));
    tv.width = Math.max(1, Math.round(w * tk));
    tv.height = Math.max(1, Math.round(h * tk));
    tv.getContext('2d').drawImage(cv, 0, 0, tv.width, tv.height);
    cb(url, tv.toDataURL('image/jpeg', CONFIG.CHAT_IMG_THUMB_QUALITY));
  };
  img.onerror = () => cb(src, '');
  img.src = src;
}

export function chatUnstage(id) {
  const it = chat.staged.find(x => x.id === id);
  chat.staged = chat.staged.filter(x => x.id !== id);
  renderChatStage();
  if (it && it.uploadId) api(`/api/uploads/${it.uploadId}`, { method: 'DELETE', body: {} }).catch(() => {});
}

export function renderChatStage() {
  // renderStageBox owns the hidden toggle + innerHTML (single definition)
  renderStageBox(chat.staged, document.getElementById('chat-stage'));
}
