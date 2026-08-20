/**
 * teacher feature actions: list, filters, profile panel, reviews.
 */
import { TEXT } from '../../constants/text.js';
import { ROLES, TEACHING_METHODS, WEEKDAYS, NONACADEMIC_PROJECTS } from '../../../shared/enums.js'; // Z-16-F5: roles via shared enums; Q-4a-M1b: filter options; F1d1: price-row names
import { CONFIG } from '../../../shared/config.js';
import { SUFE_REGIONS } from '../../../shared/region-data.js'; // contract 9: province policy single source
import { state } from '../../core/state.js';
import { api } from '../../core/api.js';
import { dhGet, dhPeek, dhOnDomainRefresh, invalidate } from '../../core/datahub.js';
import { openModal, closeModal, showToast, btnLoading, btnDone, confirm, toggleTagPick, initCustomSelects } from '../../core/ui.js';
import { escHtml, loaderHtml } from '../../core/dom.js'; // Z-10-F5: loader placeholder via shared helper
import { renderTeacherCard, renderProfilePanel, renderProfileReviewsCard, renderProfileAwardsCard, studentMatchDetailHtml, reviewModalHtml, setStudentOpenDemand, renderTeacherProfileForm, renderTeacherGaokaoEditor, renderTeacherVerifySection } from './render.js';
import { matchDegree, matchDims, matchLevel, matchRowsHtml, matchNoteHtml } from '../../core/match.js';
import { demandIsActive } from '../student/display.js';
import { positionFloatCard } from '../../core/anim.js';
import { bindTimeSlotTree, prefillTimeSlots, validateTimeSlots, collectTimeSlots } from '../../core/ui-form.js';
import { mountShanghaiAddrPicker } from '../region/actions.js';

let profilePanelUserId = null;
let _studentOpenDemand = false;
let _matchDetailOpen = false;

// Q-4a-M1b: fill teacher sort/filter controls (shell provides empty container; was dead — toggle showed blank dropdown)
function fillTeacherFilters() {
  const fill = (id, opts) => {
    const el = document.getElementById(id);
    if (!el || el.options.length > 1) return; // idempotent
    el.innerHTML = `<option value="">${escHtml(TEXT.DEMAND_FILTER_ALL)}</option>` + opts.map(o => `<option value="${escHtml(o.value)}">${escHtml(o.label)}</option>`).join('');
  };
  fill('filter-method', TEACHING_METHODS.map(m => ({ value: m.id, label: m.name })));
  fill('filter-day', WEEKDAYS.map(d => ({ value: d.id, label: d.name })));
  fill('filter-verified', [{ value: '1', label: TEXT.VERIFY_DONE }, { value: '0', label: TEXT.FILTER_UNVERIFIED }]);
  fill('teacher-sort', [{ value: 'match', label: TEXT.TEACHER_SORT_MATCH }, { value: 'rating', label: TEXT.TEACHER_SORT_RATING }, { value: 'price', label: TEXT.TEACHER_SORT_PRICE }]);
  const lbl = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  lbl('teacher-sort-label', TEXT.LABEL_SORT);
  lbl('teacher-method-label', TEXT.LABEL_TEACHING_METHOD_PROFILE);
  lbl('teacher-day-label', TEXT.LABEL_DAY);
  lbl('teacher-verified-label', TEXT.LABEL_VERIFIED);
}
export function loadTeachers() {
  const el = document.getElementById('browse-teachers-list') || document.getElementById('teachers-list');
  if (!el) return;
  fillTeacherFilters();
  el.innerHTML = `<div class="empty-state">${loaderHtml()}</div>`;
  return dhGet('/api/teachers', { domain: 'teachers' }).then(async data => {
    state.allTeachers = data.teachers || [];
    await attachStudentMatch(state.allTeachers);
    renderTeachers();
  }).catch(err => {
    el.innerHTML = `<div class="empty-state"><p>${TEXT.ERROR_LOAD_PREFIX}${escHtml(err.message)}</p></div>`;
  });
}

export function renderTeachers() {
  const el = document.getElementById('browse-teachers-list') || document.getElementById('teachers-list');
  if (!el) return;
  if (!state.allTeachers.length) { el.innerHTML = `<div class="empty-state">${TEXT.EMPTY_NO_TEACHERS}</div>`; return; }
  el.innerHTML = state.allTeachers.map(renderTeacherCard).join('');
}

export async function attachStudentMatch(teachers) {
  if (!state.user || state.user.role !== ROLES.STUDENT) { _studentOpenDemand = false; setStudentOpenDemand(false); return; }
  for (const t of teachers) delete t._matchForStudent;
  let demands = [];
  try { demands = (await dhGet('/api/student/demands?scope=mine', { domain: 'demands' })).demands || []; }
  catch { demands = []; }
  const open = demands.filter(d => demandIsActive(d));
  _studentOpenDemand = open.length > 0;
  setStudentOpenDemand(_studentOpenDemand);
  if (!open.length) return;
  for (const t of teachers) {
    const items = open
      .map(d => ({ d, md: matchDegree(t, d) }))
      .filter(x => x.md != null)
      .sort((a, b) => b.md - a.md);
    if (items.length) t._matchForStudent = { md: items[0].md, items };
  }
}

export function studentOpenDemand() { return _studentOpenDemand; }

// v1 parity (app-teachers.js): probe refresh replaces the cached array then re-hangs
// state.allTeachers — cross-feature readers (openProfilePanel/findCachedTeacher) mirror
// it, and an open list re-renders under the user's current filter/sort controls instead
// of keeping deactivated-teacher cards until the next tab switch.
export function registerTeacherDomainRefresh() {
  dhOnDomainRefresh('teachers', () => {
    const c = dhPeek('/api/teachers');
    if (c && c.teachers) state.allTeachers = c.teachers;
    if (state.page === 'browse-teachers') {
      attachStudentMatch(state.allTeachers) // async (non-student exits early with a resolved promise)
        .then(() => { if (state.page === 'browse-teachers') applyFilters(); }) // read current controls, keep user filter
        .catch(() => { /* network blip: keep current render, next probe retries */ });
    }
  });
}
registerTeacherDomainRefresh();

export async function openProfilePanel(userId) {
  let t = state.allTeachers.find(x => x.user_id === userId);
  // Z-10-F1: write-review gate data source — GET /api/teacher/profile carries server-side `signed`
  // (student has contracted this teacher; single source of truth); list data lacks it.
  // Only logged-in students request it: guests would get 401 and be bounced to the login view by
  // api()'s dead-token handling (regression caught in re-review); guests/non-students fall through
  // to list data where signed is absent and the button stays hidden.
  if (state.user && state.user.role === ROLES.STUDENT) {
    try {
      const data = await api(`/api/teacher/profile?userId=${userId}`, { method: 'GET' });
      if (data && data.profile) t = data.profile;
    } catch { /* fallback to list data */ }
  }
  if (!t) {
    try {
      const data = await api(`/api/users/${userId}`, { method: 'GET' });
      t = data.user || null;
    } catch (err) { showToast(err.message); return; }
  }
  if (!t) return;
  profilePanelUserId = userId;
  openModal({
    title: TEXT.PROFILE_PANEL_TITLE,
    cls: 'modal--wide',
    body: renderProfilePanel(t, ''),
  });
  loadReviews(userId);
  loadAwards(userId);
}

async function loadReviews(userId) {
  try {
    const data = await api(`/api/reviews?teacherUserId=${userId}`, { method: 'GET' });
    const box = document.querySelector('#modal-container .profile-reviews');
    if (box) box.innerHTML = (data.reviews || []).map(renderProfileReviewsCard).join('') || `<div class="empty-state">${TEXT.EMPTY_NO_REVIEWS}</div>`;
  } catch { /* silent */ }
}

async function loadAwards(userId) {
  try {
    const data = await api(`/api/teacher/awards?userId=${userId}`, { method: 'GET' });
    const box = document.querySelector('#modal-container .profile-awards');
    if (box) box.innerHTML = (data.awards || []).map(renderProfileAwardsCard).join('');
  } catch { /* silent */ }
}

// Z-10-F1: openReviewModal reads the teacher from the module state set by openProfilePanel;
// a null/undefined arg must NOT clobber it (the button's data-action passes no arg — clobbering
// would make submitReview post teacherUserId=undefined and fail the contracted-gate 403).
export function openReviewModal(teacherId) {
  if (teacherId != null) profilePanelUserId = teacherId;
  openModal({ title: TEXT.REVIEW_MODAL_TITLE_PREFIX, body: reviewModalHtml(), footer: `<button type="button" class="btn btn-outline glass glass--pressable" data-action="teacher.closeReview">${TEXT.BTN_CANCEL}</button><button type="button" class="btn glass glass--pressable" data-action="teacher.submitReview">${TEXT.BTN_SUBMIT_REVIEW}</button>` });
}

export async function submitReview() {
  const teacherId = profilePanelUserId;
  const rating = Number(document.querySelector('#review-stars .selected')?.dataset.rating || 0);
  const comment = (document.getElementById('review-comment')?.value || '').trim();
  if (!rating) { showToast(TEXT.VALIDATE_SELECT_RATING, 'error'); return; }
  if (comment.length < 2) { showToast(TEXT.VALIDATE_COMMENT_TOO_SHORT, 'error'); return; }
  try {
    await api('/api/reviews', { method: 'POST', body: { teacherUserId: teacherId, rating, comment } });
    closeModal();
    showToast(TEXT.SUCCESS_REVIEW_SUBMITTED);
  } catch (err) { showToast(err.message); }
}

export function setReviewStars(el) {
  const container = document.getElementById('review-stars');
  if (!container) return;
  container.querySelectorAll('.star').forEach(s => s.classList.toggle('selected', Number(s.dataset.rating) <= Number(el.dataset.rating)));
}

export function adminReviewAction(id, action) {
  if (action === 'approve') {
    api(`/api/admin/reviews/${id}/approve`, { method: 'POST', body: {} }).then(() => { showToast(TEXT.SUCCESS_APPROVED); loadTeachers(); }).catch(err => showToast(err.message));
  } else {
    api(`/api/admin/reviews/${id}/reject`, { method: 'POST', body: {} }).then(() => { showToast(TEXT.SUCCESS_REJECTED); loadTeachers(); }).catch(err => showToast(err.message));
  }
}

export function confirmDeleteReview(id) {
  confirm({ title: TEXT.BTN_DELETE_REVIEW, message: TEXT.CONFIRM_DELETE_REVIEW, onConfirm: () => api(`/api/admin/reviews/${id}`, { method: 'DELETE', body: {} }).then(() => { showToast(TEXT.REVIEW_DELETED); loadTeachers(); }).catch(err => showToast(err.message)) });
}

export function closeModalAction() { closeModal(); }


export function findCachedTeacher(userId) {
  return state.allTeachers.find(x => x.user_id === userId) || null;
}

export function closeProfilePanel() { closeModal(); }
export function profilePanelShowing() { return profilePanelUserId != null; }

export function viewTeacherCredential(userId) {
  const t = findCachedTeacher(userId);
  if (!t || !t.credential_image) { showToast(TEXT.CREDENTIAL_VIEW, 'error'); return; }
  openModal({ title: TEXT.CREDENTIAL_VIEW, body: `<div class="credential-view"><img src="${escHtml(t.credential_image)}" alt="${TEXT.CREDENTIAL_VIEW}"></div>` });
}

export function teacherSortMode(mode) {
  if (mode == null) {
    const role = state.user && state.user.role;
    return role === ROLES.TEACHER ? 'rating' : 'match';
  }
  state.teacherSort = mode; sortTeachers(); return mode;
}
export function syncMatchSortOpt() { /* handled by sort control */ }
export function teacherSortFromSelect(el) { // Q-4a-M1c: sort control change delegation
  const v = el ? String(el.value || '') : '';
  state.teacherSort = v || 'match';
  sortTeachers();
}
export function sortTeachers(arrOrMode, maybeMode) {
  const arr = Array.isArray(arrOrMode) ? [...arrOrMode] : [...(state.allTeachers || [])];
  const mode = maybeMode || (Array.isArray(arrOrMode) ? 'rating' : state.teacherSort || 'match');
  if (mode === 'price') arr.sort((a,b) => (a.price_min == null ? Infinity : a.price_min) - (b.price_min == null ? Infinity : b.price_min));
  else if (mode === 'rating') arr.sort((a,b) => (b.rating||0)-(a.rating||0));
  else if (mode === 'match') {
    if (!arr.some(t => t._matchForStudent)) return; // no match context: keep server order
    arr.sort((a,b) => {
      const am = a._matchForStudent ? a._matchForStudent.md : -1;
      const bm = b._matchForStudent ? b._matchForStudent.md : -1;
      return bm - am;
    });
  }
  if (Array.isArray(arrOrMode) || arrOrMode == null) { state.allTeachers = arr; } // Q-4a-M1c: write back on no-arg call too (sort control path was sorting a copy and never persisting)
  renderTeachers();
}

export function openTeacherCard(id) { openProfilePanel(id); }
export function toggleFilters() { const el = document.getElementById('teacher-filters'); if (el) el.classList.toggle('hidden'); }
export function applyFilters() {
  const method = document.getElementById('filter-method')?.value || '';
  const day = document.getElementById('filter-day')?.value || '';
  const verified = document.getElementById('filter-verified')?.value || '';
  // Q-4a-M1b audit FAIL fix: filter from the full cached source, NOT the previously-filtered
  // display state — clearing a filter must restore the full list (was sticky until reload).
  // Mirrors demand hall applyDemandControls. Falls back to state.allTeachers (first visit / no cache).
  const full = ((dhPeek('/api/teachers') || {}).teachers) || null;
  let list = [...((full && full.length ? full : state.allTeachers) || [])];
  if (method) list = list.filter(t => (t.teaching_method || '') === method);
  if (day) list = list.filter(t => hasDaySlot(t.time_slots, Number(day)));
  if (verified === '1') list = list.filter(t => t.verified === 1);
  else if (verified === '0') list = list.filter(t => !t.verified);
  state.allTeachers = list;
  if (state.teacherSort) sortTeachers(); // re-apply sort after filtering (was falling back to server order)
  renderTeachers();
}
export function hasDaySlot(timeSlots, day) { // Q-4a-M1a: match dow exactly — old String.includes matched digits inside start/end times (e.g. dow=3, start '18:00' falsely matched day 1). T-6-F3: mapper emits parsed arrays (safeJsonArray) — no string form.
  if (!Array.isArray(timeSlots)) return false;
  return timeSlots.some(t => Number(t && (t.dow ?? t.day)) === day);
}
export function showTeacherMatchDetail(id) {
  const t = findCachedTeacher(id);
  if (!t || !t._matchForStudent) return;
  if (_matchDetailOpen) { closeMatchDetail(); return; }
  const btn = document.querySelector(`[data-action="teacher.matchDetail"][data-id="${id}"]`);
  if (!btn) return;
  btn.insertAdjacentHTML('afterend', studentMatchDetailHtml(t));
  const card = btn.nextElementSibling;
  if (!card || !card.classList.contains('match-detail')) return;
  document.body.appendChild(card);
  positionFloatCard(btn, card);
  _matchDetailOpen = true;
}

export function closeMatchDetail() {
  const el = document.querySelector('.match-detail--teacher');
  if (el) el.remove();
  _matchDetailOpen = false;
}
export function renderProfileInfoCard(t) { return renderProfilePanel(t, ''); }

// Z-3-F1 F1c: enter the teacher-profile page — GET own profile, render the edit form,
// prefill time slots and the Shanghai address picker. Replacements (province→subjects,
// nonacademic price rows, gaokao editor, save submit) land in F1d1/F1d2/F1d3.
// F1d3: the Xuexin screenshot lives in teacher_profiles.credential_image (uploaded via the old
// profile flow); profile save must echo the current value back or the dbUpsert overwrite clears it
// (encryptField(profile.credential_image || '')). The v2 verification UI (F1e) writes the separate
// admission image to teacher_verifications — this echo only preserves the existing credential.
let _currentCredential = '';
// F1e: staged admission photo (data URL) read from the file input; cleared after submit.
let _pendingAdmission = '';
export async function enterTeacherProfile() {
  const el = document.getElementById('teacher-profile-content');
  if (!el) return;
  el.innerHTML = `<div class="empty-state">${loaderHtml()}</div>`;
  try {
    const [data, verify] = await Promise.all([
      api('/api/teacher/profile', { method: 'GET' }),
      api('/api/teacher/verify-status', { method: 'GET' }).catch(() => null), // F1e: verify block is non-fatal
    ]);
    if (!el) return; // page switched away while loading
    _currentCredential = data.profile ? (data.profile.credential_image || '') : '';
    el.innerHTML = renderTeacherProfileForm(data.profile || null) + renderTeacherVerifySection(verify || null);
    initTeacherProfileForm(data.profile || null);
  } catch (err) {
    if (!el) return;
    el.innerHTML = `<div class="empty-state"><p>${TEXT.ERROR_LOAD_PREFIX}${escHtml(err.message)}</p></div>`;
  }
}

// Z-3-F1 F1d3: collect every field from the form, validate the required set (F1c markers:
// province/grade/gender/subjects/price/teaching method/time slots), POST to /api/teacher/profile,
// toast success, then re-fetch to echo the saved state. In-flight guard = btnLoading disables the
// button (F6); the teacher list cache is invalidated so the public card reflects the save (F7).
export async function saveProfile() {
  const val = id => { const el = document.getElementById(id); return el ? el.value : ''; };
  const province = val('tp-province');
  const grade = val('tp-grade');
  const gender = val('tp-gender');
  const subjects = [...document.querySelectorAll('#tp-subjects input:checked')].map(cb => cb.value);
  const priceMin = val('tp-price-min');
  const priceMax = val('tp-price-max');
  const method = val('tp-method');
  if (!province || !grade || !gender || !subjects.length || !priceMin || !method) {
    showToast(TEXT.VALIDATE_TEACHER_PROFILE_REQUIRED, 'error'); return;
  }
  const ts = document.getElementById('tp-time-slots');
  const timeErr = ts ? validateTimeSlots(ts) : '';
  if (timeErr) { showToast(timeErr, 'error'); return; }
  const timeSlots = ts ? collectTimeSlots(ts) : [];
  if (!timeSlots.length) { showToast(TEXT.VALIDATE_SELECT_TIME_SLOTS, 'error'); return; }
  if (priceMin && priceMax && +priceMin > +priceMax) { showToast(TEXT.VALIDATE_BUDGET_RANGE, 'error'); return; }
  const personalityTags = [...document.querySelectorAll('#tp-personality .tag-pick.selected')].map(b => b.dataset.id);
  const nonacademicProjects = [...document.querySelectorAll('#tp-nonacademic .tag-pick.selected')].map(b => b.dataset.id);
  const nonacademicPrices = [...document.querySelectorAll('#tp-nonacademic-prices .price-row')].map(row => ({
    project: row.dataset.project,
    price_min: row.querySelector('[data-field="min"]').value,
    price_max: row.querySelector('[data-field="max"]').value,
  })).filter(r => r.price_min !== '' || r.price_max !== '');
  const payload = { profile: {
    province, grade, gender,
    school: val('tp-school').trim(),
    real_name: val('tp-real-name').trim(),
    graduation_year: val('tp-grad-year'),
    subjects,
    price_min: priceMin,
    price_max: priceMax,
    teaching_method: method,
    time_slots: JSON.stringify(timeSlots),
    personality_tags: personalityTags,
    nonacademic_projects: nonacademicProjects,
    nonacademic_prices: nonacademicPrices,
    gaokao_scores: collectTeacherGaokao(),
    intro: val('tp-intro').trim(),
    address: val('tp-address'),
    wechat: val('tp-wechat').trim(),
    email: val('tp-email').trim(),
    credential_image: _currentCredential,
  }};
  const btn = document.querySelector('[data-action="teacher.saveProfile"]');
  try {
    if (btn) btnLoading(btn);
    await api('/api/teacher/profile', { method: 'POST', body: payload });
    invalidate('teachers'); // public card reflects the save (F7)
    showToast(TEXT.SUCCESS_PROFILE_SAVED);
    await enterTeacherProfile(); // re-fetch + re-render echoes the saved state
  } catch (err) { showToast(err.message); }
  finally { if (btn) btnDone(btn, TEXT.BTN_SAVE); }
}

// ── Z-3-F1 F1e: teacher verification block (chsi code / admission upload) ──────────

// Re-fetch verify-status and re-render only the verify section (keeps the form edits intact).
async function refreshVerifySection() {
  const el = document.getElementById('teacher-verify');
  if (!el) return;
  try {
    const verify = await api('/api/teacher/verify-status', { method: 'GET' });
    el.outerHTML = renderTeacherVerifySection(verify || null);
  } catch { /* keep current render */ }
}

// Toggle the two submission channels (chsi default; the "freshman" switch reveals admission).
export function showVerifyChsi() {
  document.getElementById('verify-chsi-pane')?.classList.remove('hidden');
  document.getElementById('verify-admission-pane')?.classList.add('hidden');
}
export function showVerifyAdmission() {
  document.getElementById('verify-admission-pane')?.classList.remove('hidden');
  document.getElementById('verify-chsi-pane')?.classList.add('hidden');
}

// Chsi verification-code submit: pre-check the /^[A-Za-z0-9]{12,16}$/ format (matches
// server CHSI_CODE_RE), POST, then re-render the verify section to the pending state.
export async function submitVerifyChsi() {
  const input = document.getElementById('verify-chsi-code');
  const code = input ? input.value.trim() : '';
  if (!code) { showToast(TEXT.CHSI_CODE_REQUIRED, 'error'); return; }
  if (!/^[A-Za-z0-9]{12,16}$/.test(code)) { showToast(TEXT.CHSI_CODE_INVALID, 'error'); return; }
  const btn = document.querySelector('[data-action="teacher.submitVerifyChsi"]');
  try {
    if (btn) btnLoading(btn);
    await api('/api/teacher/verify-chsi', { method: 'POST', body: { code } });
    showToast(TEXT.SUCCESS_PROFILE_SAVED);
    await refreshVerifySection();
  } catch (err) { showToast(err.message); }
  finally { if (btn) btnDone(btn, TEXT.CHSI_GATE_SUBMIT); }
}

// Admission photo file change: read the picked file into a data URL (spread-copy the live
// input.files reference then clear per P13), pre-check size against CONFIG.ADMISSION_IMG_MAX,
// stage it for submit and show a preview. No programmatic .click() — the label for= opens it.
export function stageAdmissionFile(input) {
  const files = input ? [...input.files] : [];
  if (input) input.value = '';
  const f = files[0];
  if (!f) return;
  if (f.type && !/^image\/(jpeg|png|webp)$/i.test(f.type)) { showToast(TEXT.ADMISSION_IMAGE_INVALID, 'error'); return; }
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = String(reader.result || '');
    if (dataUrl.length > CONFIG.ADMISSION_IMG_MAX) { showToast(TEXT.ADMISSION_IMAGE_TOO_LARGE, 'error'); return; }
    _pendingAdmission = dataUrl;
    const preview = document.getElementById('verify-admission-preview');
    if (preview) {
      preview.classList.remove('hidden');
      preview.innerHTML = `<img src="${escHtml(dataUrl)}" alt="">`;
    }
  };
  reader.onerror = () => { showToast(TEXT.ADMISSION_IMAGE_INVALID, 'error'); };
  reader.readAsDataURL(f);
}

// Submit the staged admission photo to POST /api/teacher/verify-admission (server re-validates
// MIME whitelist + magic bytes), then re-render the verify section to the pending state.
export async function submitVerifyAdmission() {
  if (!_pendingAdmission) { showToast(TEXT.ADMISSION_IMAGE_INVALID, 'error'); return; }
  const btn = document.querySelector('[data-action="teacher.submitVerifyAdmission"]');
  try {
    if (btn) btnLoading(btn);
    await api('/api/teacher/verify-admission', { method: 'POST', body: { image: _pendingAdmission } });
    _pendingAdmission = '';
    showToast(TEXT.SUCCESS_PROFILE_SAVED);
    await refreshVerifySection();
  } catch (err) { showToast(err.message); }
  finally { if (btn) btnDone(btn, TEXT.ADMISSION_SUBMIT); }
}

// Z-3-F1 F1d1: field interactions on the teacher profile form. Idempotent — form.dataset
// guards re-entry (page re-enter re-renders innerHTML, so a fresh form gets fresh bindings).
// Covers: province → address area + method online-lock, tag-picks, nonacademic price rows,
// graduation-year clamp, time-slot tree, Shanghai address picker.
export function initTeacherProfileForm(profile) {
  const form = document.getElementById('teacher-profile-form');
  if (!form || form.dataset.profileBound) return;
  form.dataset.profileBound = '1';
  bindTimeSlotTree(form);
  const ts = document.getElementById('tp-time-slots');
  if (ts && profile && profile.time_slots) prefillTimeSlots(ts, profile.time_slots);
  const prov = document.getElementById('tp-province');
  if (prov) prov.addEventListener('change', onTeacherProvinceChange);
  // F1d2: gaokao editor re-renders when the province/year/subjects it depends on change.
  // collectTeacherGaokao() preserves typed values across re-renders (same principle as the
  // nonacademic price rows) so switching province never wipes the teacher's scores/grade tiers. This is a
  // separate listener from onTeacherProvinceChange so the initial seed render is not re-collected
  // (a second collect would drop saved grades the current policy cannot render, silently losing
  // the gaokao-policy-mismatch warning and the stale grade).
  if (prov) prov.addEventListener('change', refreshGaokaoEditor);
  const gradYear = document.getElementById('tp-grad-year');
  if (gradYear) gradYear.addEventListener('blur', clampGradYear);
  if (gradYear) gradYear.addEventListener('change', refreshGaokaoEditor);
  const subjects = document.getElementById('tp-subjects');
  if (subjects) subjects.addEventListener('change', refreshGaokaoEditor);
  renderNonacademicPriceRows(profile && profile.nonacademic_prices);
  // F1d2 seed: the editor starts from the saved scores (array from the safeJsonArray mapper) and
  // renders once — province/subject/year changes re-render later. T-6-F3: dead string branch removed.
  const gkExisting = Array.isArray(profile && profile.gaokao_scores) ? profile.gaokao_scores : [];
  refreshGaokaoEditor(gkExisting);
  onTeacherProvinceChange(); // initial run: address area + method lock from saved province
}

// Province switch: Shanghai shows the address picker (optional), others hide + clear it;
// offline method is locked to online outside Shanghai (matches demand-side server gate).
export function onTeacherProvinceChange() {
  const prov = document.getElementById('tp-province');
  const provId = prov ? prov.value : '';
  const addrInput = document.getElementById('tp-address');
  const addrSection = document.getElementById('tp-addr-picker');
  const isShanghai = provId === 'shanghai';
  if (!isShanghai && addrInput) addrInput.value = '';
  if (addrSection) addrSection.classList.toggle('hidden', !isShanghai);
  const method = document.getElementById('tp-method');
  if (method) {
    const onlineOnly = !SUFE_REGIONS.allowsOffline(provId);
    [...method.options].forEach(o => { o.disabled = onlineOnly && o.value !== 'online'; });
    // F1d1-1: unconditionally force online outside Shanghai (a saved offline value must not
    // survive the switch — server has no province gate on teaching_method, so the frontend is
    // the parity guard; matches student/actions.js toggleAddressField online-lock).
    if (onlineOnly && method.value !== 'online') method.value = 'online';
  }
  if (isShanghai) {
    mountShanghaiAddrPicker('tp', addrInput ? addrInput.value : '', { hiddenId: 'tp-address' });
  }
  // F1d2: gaokao editor re-render on province switch is a SEPARATE listener in
  // initTeacherProfileForm — keeping it out of here avoids the init double-render that would
  // collect away saved grades the current policy cannot render (and the mismatch warning).
}

// Graduation year clamp [CONFIG.GRAD_YEAR_MIN, CONFIG.GRAD_YEAR_MAX]; empty stays empty.
export function clampGradYear() {
  const el = document.getElementById('tp-grad-year');
  if (!el || !el.value) return;
  const n = Number(el.value);
  if (!Number.isFinite(n)) { el.value = ''; return; }
  el.value = String(Math.min(CONFIG.GRAD_YEAR_MAX, Math.max(CONFIG.GRAD_YEAR_MIN, n)));
}

// Tag-pick click (data-action=teacher.toggleTagPick): delegate to core toggleTagPick for the
// max-clamp + toast, then re-render nonacademic price rows (they track the selected projects).
export function teacherTagPick(el) {
  toggleTagPick(el, el.dataset.container, Number(el.dataset.max));
  if (el.dataset.container === 'tp-nonacademic') renderNonacademicPriceRows();
}

// Nonacademic price rows: one row per selected nonacademic project (project + min/max).
// F1d1-2 fix: when called without a prices argument (tag re-click), preserve the values the
// user already typed in the live DOM rows instead of wiping them from an empty map.
export function renderNonacademicPriceRows(prices) {
  const host = document.getElementById('tp-nonacademic-prices');
  if (!host) return;
  const selected = [...document.querySelectorAll('#tp-nonacademic .tag-pick.selected')].map(b => b.dataset.id);
  if (!selected.length) { host.innerHTML = `<p class="text-sm text-muted">${TEXT.OPTION_PLACEHOLDER}</p>`; return; }
  // Read live values from the existing rows (keyed by data-project) so a re-render never drops
  // user input; the prices argument only seeds rows that have no live counterpart yet.
  const live = {};
  host.querySelectorAll('.price-row').forEach(row => {
    const project = row.dataset.project;
    const minEl = row.querySelector('[data-field="min"]');
    const maxEl = row.querySelector('[data-field="max"]');
    if (project) live[project] = { project, price_min: minEl ? minEl.value : '', price_max: maxEl ? maxEl.value : '' };
  });
  const byProject = new Map((prices || []).map(r => [r.project, r]));
  host.innerHTML = selected.map(id => {
    const r = live[id] || byProject.get(id) || {};
    return `<div class="price-row" data-project="${escHtml(id)}">
      <span class="price-row-name">${escHtml((NONACADEMIC_PROJECTS.find(n => n.id === id) || {}).name || id)}</span>
      <input type="number" class="form-input" data-field="min" value="${r.price_min != null ? escHtml(String(r.price_min)) : ''}" min="0" step="1" placeholder="${TEXT.PLACEHOLDER_MIN}">
      <span class="text-muted">~</span>
      <input type="number" class="form-input" data-field="max" value="${r.price_max != null ? escHtml(String(r.price_max)) : ''}" min="0" step="1" placeholder="${TEXT.PLACEHOLDER_MAX}">
    </div>`;
  }).join('');
}

// ── Z-3-F1 F1d2: teacher gaokao editor interactions ──────────────────────────

// First/track pill switch (data-action=teacher.pickGkPill). Single-selection within the group.
// For the 3+1+2 first-subject group the shared score input follows the pill: park the current
// value on the outgoing pill (dataset, survives until re-render) and restore the incoming pill's
// parked value — otherwise switching the first subject would misattribute a typed score (v1 bug).
export function pickGkPill(el) {
  const group = el.closest('.gk-pill-group');
  if (!group) return;
  const input = document.querySelector('input[data-gk-role="first-score"]');
  const old = group.querySelector('.gk-pill.selected');
  if (old && old !== el && input) old.dataset.gkScore = input.value;
  group.querySelectorAll('.gk-pill').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
  if (old && old !== el && input) {
    input.value = el.dataset.gkScore != null ? el.dataset.gkScore : '';
  }
}

// Track switch for the legacy science/arts tracks (data-action=teacher.pickGkTrack): pick the pill and
// show only the chosen track's subject rows.
export function pickGkTrack(el) {
  pickGkPill(el);
  const root = document.getElementById('tp-gaokao');
  if (!root) return;
  root.querySelectorAll('[data-gk-track-row]').forEach(row => {
    row.classList.toggle('hidden', row.dataset.gkTrackRow !== el.dataset.gkTrack);
  });
}

// Collect the editor into the server contract shape [{subject, score?} | {subject, grade?}]:
// raw-score inputs (main/standard/first), the selected first pill + its score, and grade
// selectors/selects (electives). Empty rows are skipped; hidden track rows are skipped.
export function collectTeacherGaokao() {
  const root = document.getElementById('tp-gaokao');
  const out = [];
  if (!root) return out;
  root.querySelectorAll('input[data-gk-type="score"][data-gk-subject]').forEach(inp => {
    if (inp.closest('.hidden') || inp.value === '') return;
    out.push({ subject: inp.dataset.gkSubject, score: +inp.value });
  });
  const firstPill = root.querySelector('[data-gk-role="first"] .gk-pill.selected');
  const firstInput = root.querySelector('input[data-gk-role="first-score"]');
  if (firstPill && firstInput && firstInput.value !== '') {
    out.push({ subject: firstPill.dataset.gkFirst, score: +firstInput.value });
  }
  root.querySelectorAll('.grade-selector[data-gk-subject]').forEach(sel => {
    if (sel.closest('.hidden')) return;
    const s = sel.querySelector('.grade-option.selected');
    if (s) out.push({ subject: sel.dataset.gkSubject, grade: s.dataset.grade });
  });
  root.querySelectorAll('select.gk-grade-select[data-gk-subject]').forEach(sel => {
    if (sel.closest('.hidden') || !sel.value) return;
    out.push({ subject: sel.dataset.gkSubject, grade: sel.value });
  });
  return out;
}

// Re-render the gaokao editor into #tp-gaokao from the live province/year/checked subjects,
// preserving typed values. existing is only provided on the initial seed (saved scores from the
// profile); afterwards the live editor is collected first so re-renders never drop user input.
// Custom selects (ZJ/Beijing 21-tier grade dropdowns) are re-initialized explicitly; the global
// MutationObserver sweep is a fallback for dynamically injected selects.
export function refreshGaokaoEditor(existing) {
  const el = document.getElementById('tp-gaokao');
  if (!el) return;
  const prov = document.getElementById('tp-province');
  const year = document.getElementById('tp-grad-year');
  const list = existing !== undefined ? existing : collectTeacherGaokao();
  el.innerHTML = renderTeacherGaokaoEditor(
    prov ? prov.value : '',
    year && year.value ? Number(year.value) : undefined,
    list,
  );
  initCustomSelects(el);
}
