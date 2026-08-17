/**
 * complaints feature actions: modal, picker, search, attachments, submit, admin.
 */
import { CONFIG } from '../../../shared/config.js';
import { TEXT } from './text.js';
import { api, apiUpload } from '../../core/api.js';
import { dhGet, invalidate } from '../../core/datahub.js';
import { loadInto, setBadge } from '../../core/router.js';
import { escHtml } from '../../core/dom.js';
import { openModal, closeModal, showToast, initCustomSelects, openImageViewer } from '../../core/ui.js';
import { complaintModalBody, complaintCardHtml, chatFileExt } from './render.js';

const _cpSel = { teacher: null, student: null, post: null };
let _cpTab = 'teacher';
let _cpReason = '';
let _cpSeq = 0;
let _cpTimer = null;
const _cpRecentLoaded = new Set();
let _cpStaged = [];
let _cpStageSeq = 0;

let ensureAuth = () => true;
export function setComplaintsEnsureAuth(fn) { if (typeof fn === 'function') ensureAuth = fn; }

export function openComplaintModal() {
  if (!ensureAuth()) return;
  complaintResetStage();
  _cpRecentLoaded.clear();
  openModal({
    title: TEXT.COMPLAINT_MODAL_TITLE,
    titleId: 'complaint-modal-title',
    closable: false,
    body: complaintModalBody(_cpTab),
    footer: `<button type="button" class="btn btn-outline glass glass--pressable" data-action="complaints.close">${TEXT.BTN_CANCEL}</button>
      <button type="button" class="btn glass glass--pressable" data-action="complaints.submit">${TEXT.BTN_SEND}</button>`,
  });
  complaintLoadRecent(_cpTab);
  const reason = document.getElementById('complaint-reason');
  if (reason && reason.closest) initCustomSelects(reason.closest('.modal'));
}

export function switchComplaintTab(tab) {
  _cpTab = tab;
  document.querySelectorAll('.complaint-tabs .seg-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  ['teacher', 'student', 'post'].forEach(t => {
    const pane = document.getElementById(`cmp-pane-${t}`);
    if (pane) pane.classList.toggle('hidden', t !== tab);
  });
  complaintLoadRecent(tab);
}

export function switchComplaintReason(sel) {
  _cpReason = sel && sel.value ? sel.value : '';
}

export async function complaintLoadRecent(type) {
  if (!['teacher', 'student'].includes(type) || _cpRecentLoaded.has(type)) return;
  _cpRecentLoaded.add(type);
  const box = document.getElementById(`cmp-recent-${type}`);
  if (!box) return;
  try {
    const data = await api(`/api/complaints/recent?target=${type}`, { method: 'GET' });
    const list = data.candidates || [];
    if (!list.length) { box.innerHTML = ''; return; }
    box.innerHTML = `<span class="cmp-recent-label">${TEXT.COMPLAINT_RECENT_LABEL}</span>` +
      list.map(c => `<button type="button" class="cmp-chip glass glass--pressable" data-action="complaints.pickRecent" data-type="${type}" data-id="${c.id}" data-name="${escHtml(c.name)}">${escHtml(c.name)}</button>`).join('');
  } catch { box.innerHTML = ''; }
}

export function complaintSearchInput(type) {
  clearTimeout(_cpTimer);
  _cpTimer = setTimeout(() => complaintSearch(type, (document.getElementById(`cmp-search-${type}`)?.value || '').trim()), 300);
}

export async function complaintSearch(type, q) {
  const box = document.getElementById(`cmp-results-${type}`);
  if (!box) return;
  if (!q) { box.innerHTML = ''; return; }
  const seq = ++_cpSeq;
  try {
    const data = await api(`/api/complaints/candidates?target=${type}&q=${encodeURIComponent(q)}`, { method: 'GET' });
    if (seq !== _cpSeq) return;
    const list = data.candidates || [];
    box.innerHTML = list.length
      ? list.map(c => `<button type="button" class="cmp-result glass glass--pressable" data-action="complaints.pickSearch" data-type="${type}" data-id="${c.id}" data-name="${escHtml(c.name)}">
          <span class="cmp-result-name">${escHtml(c.name)}</span>
          <span class="cmp-result-sub">${escHtml(c.subtitle || '')}</span></button>`).join('')
      : `<div class="cmp-empty">${TEXT.COMPLAINT_SEARCH_EMPTY}</div>`;
  } catch (err) {
    if (seq !== _cpSeq) return;
    box.innerHTML = `<div class="cmp-empty">${escHtml(err.message)}</div>`;
  }
}

export function pickComplaintTarget(type, id, name) {
  _cpSel[type] = { id, name: String(name) };
  const box = document.getElementById(`cmp-selected-${type}`);
  if (box) box.innerHTML = `<span class="cmp-selected-line">${TEXT.COMPLAINT_SELECTED_PREFIX}<strong>${escHtml(_cpSel[type].name)}</strong>
    <button type="button" class="btn-text cmp-selected-change" data-action="complaints.clearTarget" data-type="${type}">${TEXT.COMPLAINT_CHANGE_TARGET}</button></span>`;
  document.querySelectorAll(`#cmp-recent-${type} .cmp-chip`).forEach(el => {
    el.classList.toggle('selected', el.dataset.name === _cpSel[type].name);
  });
  const search = document.getElementById(`cmp-search-${type}`);
  if (search) { search.value = ''; const res = document.getElementById(`cmp-results-${type}`); if (res) res.innerHTML = ''; }
  const alert = document.getElementById('complaint-alert');
  if (alert) alert.innerHTML = '';
}

export function clearComplaintTarget(type) {
  _cpSel[type] = null;
  const box = document.getElementById(`cmp-selected-${type}`);
  if (box) box.innerHTML = '';
  document.querySelectorAll(`#cmp-recent-${type} .cmp-chip`).forEach(el => el.classList.remove('selected'));
}


function shrinkImage(dataUrl, cb) {
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
  img.onerror = () => cb(dataUrl, '');
  img.src = dataUrl;
}

function renderStageBox() {
  const box = document.getElementById('complaint-stage');
  if (!box) return;
  if (!_cpStaged.length) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  box.classList.remove('hidden');
  box.innerHTML = _cpStaged.map(it => {
    const body = it.kind === 'image'
      ? `<img src="${escHtml(it.thumb || it.dataUrl || '')}" alt="${escHtml(it.name)}">`
      : `<span class="chat-stage-ext">${escHtml(chatFileExt(it.name))}</span>`;
    return `<span class="chat-stage-item" data-stage-id="${it.id}">
      <span class="chat-stage-preview">${body}</span>
      ${it.progress < 100 ? `<span class="chat-stage-progress">${Math.round(it.progress || 0)}%</span>` : ''}
      <button type="button" class="chat-stage-x" data-action="complaints.unstage" data-id="${it.id}" aria-label="remove">×</button>
    </span>`;
  }).join('');
}

export function complaintStageFiles(input) {
  const files = input ? [...input.files] : [];
  if (input) input.value = '';
  const room = CONFIG.COMPLAINT_ATTACH_MAX - _cpStaged.length;
  if (files.length > room) { showToast(TEXT.COMPLAINT_ATTACH_TOO_MANY, 'error'); files.length = room; }
  files.forEach(f => {
    const item = { id: ++_cpStageSeq, name: f.name || TEXT.CHAT_FILE_FALLBACK, progress: 0, ready: false, uploadId: null, dataUrl: '', thumb: '', kind: 'file' };
    if ((f.type || '').startsWith('image/')) {
      item.kind = 'image';
      _cpStaged.push(item);
      renderStageBox();
      const reader = new FileReader();
      reader.onload = () => shrinkImage(reader.result, (url, thumb) => complaintDoUpload(item, url, thumb));
      reader.onerror = () => { complaintUnstage(item.id); showToast(TEXT.CHAT_FILE_TOO_LARGE); };
      reader.readAsDataURL(f);
    } else {
      if (f.size > CONFIG.CHAT_FILE_MAX_BYTES) { showToast(TEXT.CHAT_FILE_TOO_LARGE); return; }
      _cpStaged.push(item);
      renderStageBox();
      const reader = new FileReader();
      reader.onload = () => complaintDoUpload(item, reader.result);
      reader.onerror = () => { complaintUnstage(item.id); showToast(TEXT.CHAT_FILE_TOO_LARGE); };
      reader.readAsDataURL(f);
    }
  });
}

export async function complaintDoUpload(item, dataUrl, thumbUrl) {
  item.dataUrl = dataUrl;
  item.thumb = thumbUrl || '';
  renderStageBox();
  try {
    const data = await apiUpload({ kind: item.kind, fileData: dataUrl, fileName: item.name, thumb: item.thumb || '' }, p => {
      item.progress = p == null ? 0 : Math.round(p * 100);
      renderStageBox();
    });
    if (item._aborted) return;
    item.uploadId = data.id;
    item.progress = 100;
    item.ready = true;
    renderStageBox();
  } catch (err) {
    if (item._aborted) return;
    complaintUnstage(item.id);
    showToast(err.message);
  }
}

export function complaintUnstage(id) {
  const it = _cpStaged.find(x => x.id === id);
  _cpStaged = _cpStaged.filter(x => x.id !== id);
  renderStageBox();
  if (it && it.uploadId) api(`/api/uploads/${it.uploadId}`, { method: 'DELETE', body: {} }).catch(() => {});
}

export function complaintResetStage() {
  _cpStaged.forEach(it => {
    if (it._aborted) return;
    it._aborted = true;
    if (it.uploadId) api(`/api/uploads/${it.uploadId}`, { method: 'DELETE', body: {} }).catch(() => {});
  });
  _cpStaged = [];
  const box = document.getElementById('complaint-stage');
  if (box) { box.classList.add('hidden'); box.innerHTML = ''; }
}

export function renderComplaintStage() { renderStageBox(); }

export function closeComplaintModal() {
  complaintResetStage();
  closeModal();
}

export async function submitComplaint() {
  const target = _cpSel[_cpTab];
  if (!target) { showToast(TEXT.COMPLAINT_TARGET_REQUIRED, 'error'); return; }
  if (!_cpReason) { showToast(TEXT.COMPLAINT_REASON_REQUIRED, 'error'); return; }
  if (_cpStaged.some(it => !it.ready)) { showToast(TEXT.COMPLAINT_ATTACH_UPLOADING, 'error'); return; }
  const detail = (document.getElementById('complaint-detail').value || '').trim();
  const uploadIds = _cpStaged.map(it => it.uploadId).filter(Boolean);
  try {
    await api('/api/complaints', { method: 'POST', body: { targetType: _cpTab, targetId: target.id, reason: _cpReason, detail, uploadIds } });
    complaintResetStage();
    closeModal();
    showToast(TEXT.COMPLAINT_SENT_TOAST);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

export async function complaintOpenAttachment(complaintId, idx) {
  try {
    const data = await api(`/api/complaints/${complaintId}/attachment?idx=${idx}`, { method: 'GET' });
    if (!data.body) { showToast(TEXT.COMPLAINT_ATTACH_FAIL); return; }
    if (data.kind === 'image') { openImageViewer(data.body); return; }
    const href = String(data.body).startsWith('data:') ? data.body : '#';
    const a = document.createElement('a');
    a.href = href; a.download = data.name || TEXT.CHAT_FILE_FALLBACK;
    document.body.appendChild(a); a.click(); a.remove();
  } catch (err) { showToast(err.message || TEXT.COMPLAINT_ATTACH_FAIL); }
}

export async function loadAdminComplaints() {
  setBadge('admin-complaint', 0);
  await loadInto('admin-complaint-list', async () => {
    const data = await dhGet('/api/complaints', { domain: 'admin' });
    return data.complaints || [];
  }, list => list.map(c => complaintCardHtml(c)).join(''), { empty: TEXT.ADMIN_COMPLAINT_EMPTY });
}

export async function resolveAdminComplaint(complaintId) {
  try {
    await api(`/api/complaints/${complaintId}/resolve`, { method: 'POST' });
    showToast(TEXT.COMPLAINT_RESOLVED_TOAST);
    invalidate('admin');
    loadAdminComplaints();
  } catch (err) { showToast(err.message); }
}
