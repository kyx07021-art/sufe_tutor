/**
 * complaints feature renderers: picker pane, complaint card, attachment thumbnails.
 * No inline handlers or inline style attributes.
 */
import { escHtml, fmtDateTime } from '../../core/dom.js';
import { STATUS } from '../../../shared/enums.js';
import { complaintTargetName } from './display.js';
import { segTabsHtml } from '../../core/ui.js';
import { TEXT } from '../../constants/text.js';

export function complaintPickerHtml(type, withRecent) {
  const recent = withRecent
    ? `<div class="cmp-recent" id="cmp-recent-${type}"></div>`
    : `<div class="cmp-recent cmp-recent--reserved" aria-hidden="true"></div>`;
  return `<div class="cmp-block">
      <input type="text" class="form-input cmp-search" id="cmp-search-${type}"
        placeholder="${type === 'post' ? TEXT.COMPLAINT_SEARCH_POST_PLACEHOLDER : TEXT.COMPLAINT_SEARCH_PLACEHOLDER}"
        data-cmp-search="${type}" aria-label="${TEXT.COMPLAINT_SEARCH_PLACEHOLDER}">
      <div class="cmp-results" id="cmp-results-${type}"></div>
      <div class="cmp-selected" id="cmp-selected-${type}"></div>
      ${recent}
    </div>`;
}

export function complaintModalBody(currentTab) {
  return `${segTabsHtml([
      { key: 'teacher', label: TEXT.COMPLAINT_TAB_TEACHER },
      { key: 'student', label: TEXT.COMPLAINT_TAB_STUDENT },
      { key: 'post',    label: TEXT.COMPLAINT_TAB_POST },
    ], currentTab, { containerClass: 'complaint-tabs', attr: 'tab' })}
      <div class="complaint-pane" id="cmp-pane-teacher">${complaintPickerHtml('teacher', true)}</div>
      <div class="complaint-pane hidden" id="cmp-pane-student">${complaintPickerHtml('student', true)}</div>
      <div class="complaint-pane hidden" id="cmp-pane-post">${complaintPickerHtml('post', false)}</div>
      <div class="form-group">
        <label class="form-label" id="complaint-reason-label">${TEXT.COMPLAINT_REASON_LABEL}</label>
        <select class="form-select complaint-reason-sel" id="complaint-reason" data-change="complaints.reason">
          <option value="">${TEXT.COMPLAINT_REASON_PLACEHOLDER}</option>
          ${TEXT.COMPLAINT_REASONS.map(r => `<option value="${escHtml(r)}">${escHtml(r)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label" for="complaint-detail">${TEXT.COMPLAINT_DETAIL_LABEL}</label>
        <textarea id="complaint-detail" class="form-input" rows="5"
          placeholder="${TEXT.COMPLAINT_DETAIL_PLACEHOLDER}"></textarea>
      </div>
      <div class="form-group">
        <label class="form-label">${TEXT.COMPLAINT_ATTACH_LABEL}</label>
        <div class="complaint-attach-row">
          <label class="complaint-attach-btn glass glass--pressable" for="complaint-file-input">${TEXT.COMPLAINT_ATTACH_ADD}</label>
          <input type="file" id="complaint-file-input" class="sr-file-input" multiple
            accept="image/*,.pdf,.doc,.docx,.txt,.xls,.xlsx,.ppt,.pptx,.zip" data-action="complaints.stageFiles">
          <div class="chat-stage hidden glass" id="complaint-stage"></div>
        </div>
      </div>`;
}

function complaintAttachHtml(c) {
  if (!(c.attachments || []).length) return '';
  return `<div class="complaint-attaches">${(c.attachments || []).map((a, i) => a.kind === 'image'
      ? `<button type="button" class="complaint-attach glass glass--solid" data-action="complaints.openAttachment" data-id="${c.id}" data-idx="${i}" aria-label="${TEXT.CHAT_ATTACH_IMAGE}">
            <img src="${escHtml(a.thumb || '')}" alt="${TEXT.CHAT_ATTACH_IMAGE}" loading="lazy"></button>`
      : `<button type="button" class="complaint-attach complaint-attach--file glass glass--solid" data-action="complaints.openAttachment" data-id="${c.id}" data-idx="${i}" title="${escHtml(a.name || '')}">
            <span class="chat-stage-ext">${escHtml(chatFileExt(a.name))}</span></button>`).join('')}</div>`;
}

// Single source: v1 had one global chatFileExt (app-chat.js) shared by the complaints
// UI — import + re-export the chat domain display's copy instead of a divergent local
// variant (Z-10-F2: chat display mappings live in chat/display.js).
import { chatFileExt } from '../chat/display.js';
export { chatFileExt };

export function complaintCardHtml(c, opts = {}) {
  const resolved = c.status === STATUS.RESOLVED;
  const snap = c.target_snapshot || {};
  const typeName = complaintTargetName(c.target_type);
  const foot = opts.foot ?? `<span class="list-card-meta">${TEXT.COMPLAINT_REPORTER_LABEL} ${escHtml(c.reporter)} · ${fmtDateTime(c.created_at)}</span>
      ${resolved ? '' : `<button type="button" class="btn btn-outline btn-xs glass glass--pressable" data-action="complaints.resolve" data-id="${c.id}">${TEXT.BTN_COMPLAINT_RESOLVE}</button>`}`;
  return `<div class="list-card glass complaint-card${resolved ? ' complaint-card--resolved' : ''}">
    <div class="list-card-header">
      <span class="list-card-title">${escHtml(snap.name || '')}</span>
      <span class="complaint-tags">
        <span class="tag glass glass--solid tag-accent">${escHtml(typeName)}</span>
        <span class="tag glass glass--solid ${resolved ? 'tag-ok' : 'tag-warn'}">${resolved ? TEXT.COMPLAINT_STATUS_RESOLVED : TEXT.COMPLAINT_STATUS_OPEN}</span>
      </span>
    </div>
    <div class="list-card-detail">${escHtml(c.reason)}${c.detail ? `<div class="complaint-detail">${escHtml(c.detail)}</div>` : ''}${complaintAttachHtml(c)}</div>
    <div class="complaint-foot">${foot}</div>
  </div>`;
}
