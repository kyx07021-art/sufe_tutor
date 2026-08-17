/**
 * chat feature actions: polling, send and upload pipeline.
 */
import { CONFIG } from '../../../shared/config.js';
import { TEXT } from './text.js';
import { chat } from './chat-state.js';
import { state } from '../../core/state.js';
import { api, apiUpload } from '../../core/api.js';
import { showToast } from '../../core/ui.js';
import { renderChatBubble, renderStageBox, chatFileExt, chatNowStamp } from './render.js';

export function chatStartPolling() {
  stopChatPolling();
  chat.pollTimer = setInterval(chatPollTick, CONFIG.CHAT_POLL_MS);
}

export function stopChatPolling() {
  if (chat.pollTimer) { clearInterval(chat.pollTimer); chat.pollTimer = null; }
}

export async function chatPollTick() {
  if (!chat.convId || chat.pollBusy) return;
  chat.pollBusy = true;
  try {
    const data = await api(`/api/conversations/${chat.convId}/messages?sinceId=${chat.lastMsgId}`, { method: 'GET' });
    const msgs = data.messages || [];
    if (msgs.length) {
      const fresh = msgs.filter(m => m.id > chat.lastMsgId);
      if (fresh.length) {
        chat.lastMsgId = fresh[fresh.length - 1].id;
        const box = document.getElementById('chat-messages');
        if (box) {
          const existing = new Set([...box.querySelectorAll('[data-mid]')].map(x => x.dataset.mid));
          const html = fresh.filter(m => !existing.has(String(m.id))).map(renderChatBubble).join('');
          if (html) box.insertAdjacentHTML('beforeend', html);
        }
        const box2 = document.getElementById('chat-messages'); if (box2) box2.scrollTop = box2.scrollHeight;
      }
    }
  } catch { /* poll silently */ }
  finally { chat.pollBusy = false; }
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
  chat.sending = true;
  const convId = chat.convId;
  try {
    const batch = staged.map(it => ({ kind: it.kind, uploadId: it.uploadId }));
    if (text) batch.push({ kind: 'text', body: text });
    const data = await api(`/api/conversations/${convId}/messages`, { method: 'POST', body: { batch } });
    if (chat.convId !== convId) return;
    const created = data.messages || [];
    const local = batch.map((b, i) => ({
      id: created[i] && created[i].id ? created[i].id : -(i + 1),
      sender_user_id: state.user ? state.user.id : null,
      kind: b.kind,
      body: b.kind === 'text' ? b.body : (staged[i] ? staged[i].dataUrl : ''),
      name: staged[i] ? staged[i].name : '',
      created_at: chatNowStamp(),
    }));
    if (local.length) {
      const maxId = local.reduce((m, x) => Math.max(m, x.id > 0 ? x.id : 0), chat.lastMsgId);
      chat.lastMsgId = maxId;
      const box = document.getElementById('chat-messages');
      if (box) box.insertAdjacentHTML('beforeend', local.map(renderChatBubble).join(''));
      const box2 = document.getElementById('chat-messages'); if (box2) box2.scrollTop = box2.scrollHeight;
    }
    chat.staged = [];
    renderStageBox(chat.staged, document.getElementById('chat-stage'));
    ta.value = '';
    chatAutogrow(ta);
  } catch (err) {
    showToast(err.message);
  } finally { chat.sending = false; }
}

export function chatInputKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
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


