/**
 * posts editor actions: create/detail/delete/broadcast.
 */
import { CONFIG } from '../../../shared/config.js';
import { TEXT } from './text.js';
import { state } from '../../core/state.js';
import { api } from '../../core/api.js';
import { invalidate } from '../../core/datahub.js';
import { escHtml, mdRender, fmtDateTime } from '../../core/dom.js';
import { usernameHtml, deactivatedTag } from '../../core/display.js';
import { openModal, closeModal, showToast, btnLoading, btnDone, confirm, mdEditorHtml } from '../../core/ui.js';
import { likePillHtml, favPillHtml } from './render.js';
import { loadPosts, postsList, postsAuth as ensureAuth } from './actions-list.js';

let refreshNotifications = () => {};
export function setPostsRefreshNotifications(fn) { if (typeof fn === 'function') refreshNotifications = fn; }

export function openPostEditor() {
  if (!ensureAuth()) return;
  openModal({
    title: TEXT.POST_MODAL_TITLE_CREATE,
    closable: false,
    body: `
        <div class="form-group">
          <label class="form-label" for="post-title">${TEXT.POST_LABEL_TITLE} <span class="req">*</span></label>
          <input type="text" id="post-title" class="form-input" maxlength="${CONFIG.POST_TITLE_MAX}" placeholder="${TEXT.POST_TITLE_PLACEHOLDER}" data-input="posts.titleCount">
          <span class="title-count" id="post-title-count">0/${CONFIG.POST_TITLE_MAX}</span>
        </div>
        ${mdEditorHtml({ rows: 9, placeholder: TEXT.POST_BODY_PLACEHOLDER, labelFor: 'post-body' })}`,
    footer: `<button type="button" class="btn btn-outline glass glass--pressable" data-action="posts.closeModal">${TEXT.BTN_CANCEL}</button>
          <button type="button" class="btn glass glass--pressable" id="post-submit" data-action="posts.submit">${TEXT.BTN_PUBLISH}</button>`,
  });
  const t = document.getElementById('post-title');
  if (t) t.focus();
}

export function mdWrap(mode) {
  const ta = document.getElementById('post-body');
  if (!ta) return;
  const start = ta.selectionStart, end = ta.selectionEnd;
  if (mode === 'bold') {
    const sel = ta.value.slice(start, end);
    const surrounded = ta.value.slice(Math.max(0, start - 2), start) === '**'
                    && ta.value.slice(end, end + 2) === '**';
    if (sel.length >= 4 && sel.startsWith('**') && sel.endsWith('**')) {
      const inner = sel.slice(2, -2);
      ta.value = ta.value.slice(0, start) + inner + ta.value.slice(end);
      ta.setSelectionRange(start, start + inner.length);
    } else if (surrounded) {
      ta.value = ta.value.slice(0, start - 2) + sel + ta.value.slice(end + 2);
      ta.setSelectionRange(start - 2, start - 2 + sel.length);
    } else {
      const inner = sel || TEXT.POST_MD_BOLD_DEFAULT;
      ta.value = ta.value.slice(0, start) + '**' + inner + '**' + ta.value.slice(end);
      ta.setSelectionRange(start + 2, start + 2 + inner.length);
    }
  } else {
    const prefix = mode === 'h3' ? '### ' : '## ';
    const other  = mode === 'h3' ? '## ' : '### ';
    const lineStart = ta.value.lastIndexOf('\n', start - 1) + 1;
    let lineEnd = ta.value.indexOf('\n', end);
    if (lineEnd === -1) lineEnd = ta.value.length;
    const block = ta.value.slice(lineStart, lineEnd);
    const newBlock = block.split('\n').map(ln => {
      if (ln.startsWith(prefix)) return ln.slice(prefix.length);
      const bare = ln.startsWith(other) ? ln.slice(other.length) : ln;
      return prefix + bare;
    }).join('\n');
    ta.value = ta.value.slice(0, lineStart) + newBlock + ta.value.slice(lineEnd);
    ta.setSelectionRange(lineStart, lineStart + newBlock.length);
  }
  ta.focus();
}

export function insertPostImage(input) {
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  if (!file.type.startsWith('image/')) { showToast(TEXT.POST_IMAGE_ONLY); return; }
  const reader = new FileReader();
  reader.onload = () => {
    const ta = document.getElementById('post-body');
    if (!ta) return;
    const pos = ta.selectionStart ?? ta.value.length;
    const before = ta.value.slice(0, pos);
    const after = ta.value.slice(pos);
    const sep1 = before && !before.endsWith('\n') ? '\n' : '';
    const sep2 = after && !after.startsWith('\n') ? '\n' : '';
    ta.value = before + sep1 + `![${TEXT.POST_IMAGE_ALT}](${reader.result})` + sep2 + after;
    ta.focus();
  };
  reader.readAsDataURL(file);
}

export function openPostPreview() {
  const ta = document.getElementById('post-body');
  const html = ta ? mdRender(ta.value) : '';
  openModal({
    title: TEXT.POST_PREVIEW_TITLE,
    cls: 'modal--wide',
    bodyCls: 'contract-md',
    body: html || `<p class="md-preview-empty">${TEXT.POST_PREVIEW_EMPTY}</p>`,
  });
}

export async function submitPost() {
  const titleEl = document.getElementById('post-title');
  const bodyEl = document.getElementById('post-body');
  const btn = document.getElementById('post-submit');
  const title = (titleEl.value || '').trim();
  if (!title) { showToast(TEXT.POST_TITLE_REQUIRED, 'error'); titleEl.focus(); return; }
  try {
    btnLoading(btn, TEXT.POST_PUBLISHING);
    await api('/api/posts', { method: 'POST', body: { title, bodyMd: bodyEl.value || '' } });
    closeModal();
    showToast(TEXT.POST_PUBLISHED);
    invalidate('posts');
    loadPosts();
  } catch (err) {
    showToast(err.message, 'error');
    btnDone(btn, TEXT.BTN_PUBLISH);
  }
}


export function postConfirmDelete(id) {
  confirm({ title: TEXT.POST_DELETE_TITLE, message: TEXT.POST_DELETE_CONFIRM, okText: TEXT.BTN_CONFIRM_DELETE, onConfirm: () => deletePost(id) });
}

export async function deletePost(id) {
  closeModal();
  const card = document.querySelector(`.post-card[data-post-id="${id}"]`);
  if (card) card.remove();
  try {
    await api(`/api/posts/${id}`, { method: 'DELETE', body: {} });
    showToast(TEXT.POST_DELETED);
    invalidate('posts');
  } catch (err) {
    loadPosts();
    if (err.code === 'POST_NOT_FOUND') { closeModal(); loadPosts(); }
    showToast(err.message);
  }
}

export function updateTitleCount() {
  const inp = document.getElementById('post-title');
  const el = document.getElementById('post-title-count');
  if (!inp || !el) return;
  if (inp.value.length > CONFIG.POST_TITLE_MAX) inp.value = inp.value.slice(0, CONFIG.POST_TITLE_MAX);
  el.textContent = `${inp.value.length}/${CONFIG.POST_TITLE_MAX}`;
  el.classList.toggle('over', inp.value.length > CONFIG.POST_TITLE_WARN);
}

export function postCardClick(event, id) {
  if (!event || (event.target.closest && event.target.closest('.post-like, .post-fav, .post-del'))) return;
  openPostDetail(id);
}

export function openPostDetail(id) {
  const p = postsList.find(x => x.id === id);
  if (!p) return;
  const mine = state.user && p.user_id === state.user.id;
  const time = p.created_at ? fmtDateTime(p.created_at) : '';
  openModal({
    title: p.title,
    cls: 'modal--wide',
    bodyCls: 'md-preview md-preview--full',
    body: `
      <div class="post-meta">
        <span class="post-author">${usernameHtml(p.username || TEXT.POST_ANONYMOUS)}${deactivatedTag(p.username)}</span>
        <span class="post-time">${escHtml(time)}</span>
      </div>
      <div class="post-detail-body">${mdRender(p.body_md) || `<p>${TEXT.POST_PREVIEW_EMPTY}</p>`}</div>`,
    footer: `<div class="post-detail-foot">${likePillHtml(p)}${favPillHtml(p)}${mine ? `<button type="button" class="btn btn-text-danger glass glass--pressable" data-action="posts.confirmDelete" data-id="${p.id}">${TEXT.POST_BTN_DELETE}</button>` : ''}</div>`,
  });
}

export function openBroadcastModal() {
  openModal({
    title: TEXT.BROADCAST_MODAL_TITLE,
    closable: false,
    body: `
        <div class="form-group">
          <label class="form-label" for="post-title">${TEXT.POST_LABEL_TITLE}</label>
          <input type="text" id="post-title" class="form-input" maxlength="${CONFIG.POST_TITLE_MAX}" placeholder="${TEXT.BROADCAST_TITLE_PLACEHOLDER}" data-input="posts.titleCount">
          <span class="title-count" id="post-title-count">0/${CONFIG.POST_TITLE_MAX}</span>
        </div>
        ${mdEditorHtml({ rows: 7, placeholder: TEXT.BROADCAST_BODY_PLACEHOLDER })}`,
    footer: `<button type="button" class="btn btn-outline glass glass--pressable" data-action="posts.closeModal">${TEXT.BTN_CANCEL}</button>
          <button type="button" class="btn glass glass--pressable" id="broadcast-submit" data-action="posts.submitBroadcast">${TEXT.BTN_SEND_NOTIFICATION}</button>`,
  });
  const b = document.getElementById('post-body');
  if (b) b.focus();
}

export async function submitBroadcast() {
  const title = (document.getElementById('post-title').value || '').trim();
  const text = (document.getElementById('post-body').value || '').trim();
  if (!title) { showToast(TEXT.POST_TITLE_REQUIRED, 'error'); return; }
  if (!text) { showToast(TEXT.VALIDATE_BROADCAST_EMPTY, 'error'); return; }
  closeModal();
  confirm({
    title: TEXT.BROADCAST_MODAL_TITLE,
    message: TEXT.BROADCAST_CONFIRM_TEXT,
    needReAuth: true,
    onConfirm: (capToken) => doBroadcast(title, text, capToken),
  });
}

export async function doBroadcast(title, text, capToken) {
  try {
    await api('/api/notifications/broadcast', { method: 'POST', body: { title, text, capToken } });
    closeModal();
    showToast(TEXT.BROADCAST_SENT_TOAST);
    if (state.page === 'notifications') refreshNotifications();
  } catch (err) {
    showToast(err.message, 'error');
  }
}


