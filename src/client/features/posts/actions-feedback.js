/**
 * posts feedback actions: complaint/feedback chooser, feedback submit, my feedback.
 */
import { CONFIG } from '../../../shared/config.js';
import { STATUS } from '../../../shared/enums.js';
import { TEXT } from '../../constants/text.js';
import { postsAuth as ensureAuth } from './actions-list.js';
import { api } from '../../core/api.js';
import { invalidate } from '../../core/datahub.js'; // AF-8: admin feedback list refresh after submit

let feedbackKind = 'bug';
import { openModal, closeModal, showToast, mdEditorHtml } from '../../core/ui.js';
import { escHtml, mdRender, fmtDateTime, loaderHtml } from '../../core/dom.js';
import { feedbackKindName, feedbackKindCls, feedbackSubjectName } from '../complaints/display.js';

export function openFeedbackComplaintChooser() {
  if (!ensureAuth()) return;
  openModal({
    title: TEXT.BTN_COMPLAINT_FEEDBACK,
    body: `
      <div class="chooser-grid">
        <button type="button" class="btn glass glass--pressable chooser-item" data-action="posts.feedbackBug">${escHtml(TEXT.FEEDBACK_CHOOSE_BUG)}</button>
        <button type="button" class="btn glass glass--pressable chooser-item" data-action="posts.feedbackSuggestion">${escHtml(TEXT.FEEDBACK_CHOOSE_SUGGESTION)}</button>
        <button type="button" class="btn glass glass--pressable chooser-item" data-action="posts.openComplaint">${escHtml(TEXT.FEEDBACK_CHOOSE_COMPLAINT)}</button>
      </div>`,
  });
}

export function openFeedbackModal(kind) {
  if (!ensureAuth()) return;
  feedbackKind = (kind === 'bug') ? kind : 'suggestion';
  openModal({
    title: feedbackKind === 'bug' ? TEXT.FEEDBACK_MODAL_TITLE_BUG : TEXT.FEEDBACK_MODAL_TITLE_SUGGEST,
    closable: false,
    body: `
        <div class="form-group">
          <label class="form-label" for="post-title">${TEXT.POST_LABEL_TITLE}</label>
          <input type="text" id="post-title" class="form-input" maxlength="${CONFIG.POST_TITLE_MAX}" placeholder="${TEXT.FEEDBACK_TITLE_PLACEHOLDER}" data-input="posts.titleCount">
          <span class="title-count" id="post-title-count">0/${CONFIG.POST_TITLE_MAX}</span>
        </div>
        ${mdEditorHtml({ rows: 7, placeholder: TEXT.FEEDBACK_PLACEHOLDER })}`,
    footer: `<button type="button" class="btn btn-outline glass glass--pressable" data-action="posts.closeModal">${TEXT.BTN_CANCEL}</button>
          <button type="button" class="btn glass glass--pressable" data-action="posts.submitFeedback">${TEXT.BTN_SEND}</button>`,
  });
}

export async function submitFeedback() {
  const title = (document.getElementById('post-title').value || '').trim();
  const content = (document.getElementById('post-body').value || '').trim();
  if (!title) { showToast(TEXT.POST_TITLE_REQUIRED, 'error'); return; }
  if (!content) { showToast(TEXT.FEEDBACK_EMPTY, 'error'); return; }
  try {
    await api('/api/feedbacks', { method: 'POST', body: { kind: feedbackKind, title, content } });
    invalidate('admin'); // AF-8: refresh the admin feedback list immediately (same-session consistency, Q-3b-L2)
    closeModal();
    showToast(TEXT.FEEDBACK_SENT_TOAST);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

export async function openMyFeedback() {
  if (!ensureAuth()) return;
  openModal({
    title: TEXT.MY_FEEDBACK_TITLE,
    cls: 'modal--wide',
    bodyCls: 'my-feedback-body',
    body: `<div class="my-feedback-list">${loaderHtml()}</div>`,
  });
  try {
    const [fb, cp] = await Promise.all([
      api('/api/feedbacks/mine', { method: 'GET' }),
      api('/api/complaints/mine', { method: 'GET' }),
    ]);
    const feedbacks = fb.feedbacks || [];
    const complaints = cp.complaints || [];
    const bodyEl = document.querySelector('#modal-container .my-feedback-list');
    if (!bodyEl) return;
    if (!feedbacks.length && !complaints.length) { bodyEl.innerHTML = `<div class="empty-state">${TEXT.MY_FEEDBACK_EMPTY}</div>`; return; }
    const fbHtml = feedbacks.map(f => {
      const resolved = f.status === STATUS.RESOLVED;
      const subject = feedbackSubjectName(f.subject);
      return `<div class="list-card glass my-feedback-card">
          <div class="list-card-header">
            <span class="list-card-title">${escHtml(f.title || '')}</span>
            <span class="feedback-tags">
              <span class="tag glass glass--solid ${feedbackKindCls(f.kind)}">${escHtml(feedbackKindName(f.kind))}</span>
              ${subject ? `<span class="tag glass glass--solid tag-ok">${escHtml(subject)}</span>` : ''}
              <span class="tag glass glass--solid ${resolved ? 'tag-ok' : 'tag-warn'}">${resolved ? TEXT.FEEDBACK_STATUS_RESOLVED : TEXT.FEEDBACK_STATUS_OPEN}</span>
            </span>
          </div>
          ${f.content ? `<div class="list-card-detail feedback-content md-preview md-preview--full">${mdRender(f.content) || ''}</div>` : ''}
          <div class="feedback-foot"><span class="list-card-meta">${fmtDateTime(f.created_at)}</span></div>
        </div>`;
    }).join('');
    const complaintsMod = await import('../complaints/index.js');
    const cpHtml = complaints.map(c => complaintsMod.render.complaintCardHtml(c, {
      foot: `<span class="list-card-meta">${fmtDateTime(c.created_at)}</span>`,
    })).join('');
    bodyEl.innerHTML = fbHtml + cpHtml;
  } catch (err) {
    const bodyEl = document.querySelector('#modal-container .my-feedback-list');
    if (bodyEl) bodyEl.innerHTML = `<div class="empty-state">${escHtml(err.message)}</div>`;
  }
}

export function closeModalAction() { closeModal(); }

export async function openComplaintAction() {
  // AB-O1: silent degrade on lazy-import failure (deploy-race: an old tab may reference a chunk
  // already removed on redeploy — the SPA-fallback guard already turns the MIME error into a clean
  // 404, so this just must not throw). Aligns with onboard/actions.js browseAsGuest precedent.
  try {
    closeModal();
    const mod = await import('../complaints/index.js');
    mod.actions.openComplaintModal();
  } catch (err) {
    console.warn('openComplaintAction', err);
  }
}
