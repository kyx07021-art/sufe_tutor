/**
 * student/demand feature actions: list, browse/filter, create/edit, intents, pushes, match detail.
 * v1 parity (redo): every rendered action is fully wired -- no empty stubs behind data-action.
 * Edit PUT is merge-preserve: fields the simplified form cannot edit are carried over from the
 * source demand so the full-column server UPDATE never drops data (audit blocking-fix A).
 */
import { TEXT } from '../../constants/text.js';
import { state, loadSeqs } from '../../core/state.js';
import { api, ensureAuth } from '../../core/api.js';
import { dhGet, invalidate } from '../../core/datahub.js';
import { openModal, closeModal, showToast, btnLoading, btnDone, confirm, toggleTagPick, initCustomSelects, syncCustomSelectText, applyTabBindings } from '../../core/ui.js';
import { escHtml, loaderHtml } from '../../core/dom.js';
import { initReveals, positionFloatCard } from '../../core/anim.js';
import { matchDegree, matchDetailHtml } from '../../core/match.js';
import { provinceName, methodName } from '../../core/display.js';
import { demandIsActive, demandTargetNames, demandIdText, studentGradeName } from './display.js';
import { renderDemandCard, renderDemandModalHtml, renderIntentTeacherRow, pushCooldownLeft, startPushCooldown, DEMAND_WIZARD_STEPS } from './render.js';
import { buildStudentSubjectsHtml, buildStudentScoreRows, renderProvinceSelect, regionLockNote, gradeOptionsForProvince } from '../region/render.js';
import { mountShanghaiAddrPicker, switchScoreMode, pickGrade, collectStudentScores } from '../region/actions.js';
import { bindTimeSlotTree, validateTimeSlots, collectTimeSlots, prefillTimeSlots } from '../../core/ui-form.js';
import { SUFE_REGIONS } from '../../constants/region-data.js';
import { STUDENT_GRADES, STATUS, SUBJECTS, TEACHING_METHODS, DEMAND_TYPES, NONACADEMIC_PROJECTS, ROLES } from '../../../shared/enums.js';
import { CONFIG } from '../../../shared/config.js';

export { gradeOptionsForProvince }; // region school-system single source (re-export for grade-region-policy tests)

// #158: control-change local re-render data source (pinned pushes + normal demands same pool)
let _browsePushes = [], _browseNormal = [];
// Match-detail float card: at most one open at a time (v1 _matchDetailOpen)
let _matchDetailOpen = false;

export function loadMyDemands() {
  const el = document.getElementById('my-demands-list');
  if (!el) return;
  el.innerHTML = `<div class="empty-state">${loaderHtml()}</div>`;
  return dhGet('/api/student/demands?scope=mine', { domain: 'demands' }).then(data => {
    state.myDemands = data.demands || [];
    // v1 parity: owner cards render edit/reopen + intent toggle (editable:true). Was missing
    // in the initial v2 port -- students could not manage their own demands.
    el.innerHTML = state.myDemands.map(d => renderDemandCard(d, { editable: true })).join('') || `<div class="empty-state">${TEXT.EMPTY_NO_MY_DEMANDS}</div>`;
  }).catch(err => { el.innerHTML = `<div class="empty-state"><p>${escHtml(err.message)}</p></div>`; });
}

// v1 parity: browse hall with out-of-order guard (loadSeqs) + parallel teacher-profile fetch +
// pinned pushes + state.browseDemands single source for openDemandCard/submitIntent lookups
export async function loadBrowseDemands() {
  const el = document.getElementById('browse-demands-list') || document.getElementById('demands-list');
  if (!el) return;
  const seq = (loadSeqs['browse-demands'] = (loadSeqs['browse-demands'] || 0) + 1); // || 0 init: NaN !== NaN would drop first render
  const isGuest = !state.user;
  const needTeachers = !isGuest && state.user.role === ROLES.TEACHER && !state.allTeachers.length;
  el.innerHTML = `<div class="empty-state">${loaderHtml()}</div>`;
  try {
    const [dData, pData, tData] = await Promise.all([
      dhGet(isGuest ? '/api/student/demands' : '/api/student/demands?scope=for-teacher', { domain: 'demands' }),
      isGuest ? Promise.resolve({ pushes: [] }) : dhGet('/api/demand-pushes', { domain: 'demands' }),
      needTeachers ? dhGet('/api/teachers', { domain: 'teachers' }).catch(() => null) : Promise.resolve(null), // profile failure must not block the list
    ]);
    if (seq !== loadSeqs['browse-demands']) return; // stale response from a fast page round-trip: drop
    if (needTeachers && tData && Array.isArray(tData.teachers)) state.allTeachers = tData.teachers;
    const pushes = pData.pushes || [];
    const demands = dData.demands || [];
    _browsePushes = pushes; _browseNormal = demands;
    state.browseDemands = demands;
    if (!pushes.length && !demands.length) { el.innerHTML = `<div class="empty-state"><p>${TEXT.EMPTY_NO_DEMANDS}</p></div>`; return; }
    initDemandControls(); // #158: sort/filter options + labels (idempotent)
    renderBrowseDemands(pushes, demands);
  } catch (err) {
    if (seq !== loadSeqs['browse-demands']) return;
    el.innerHTML = `<div class="empty-state"><p>${TEXT.ERROR_LOAD_PREFIX}${escHtml(err.message)}</p></div>`;
  }
}

// #158: demand hall sort + filter controls (teacher sees match-highest by default)
export function initDemandControls() {
  const sort = document.getElementById('demand-sort');
  if (sort && !sort.options.length) {
    sort.innerHTML = `<option value="match" selected>${TEXT.DEMAND_SORT_MATCH}</option>
      <option value="newest">${TEXT.DEMAND_SORT_NEWEST}</option>
      <option value="budget">${TEXT.DEMAND_SORT_BUDGET}</option>`;
  }
  const fill = (id, opts) => {
    const el = document.getElementById(id);
    if (!el || el.options.length > 1) return; // already filled (idempotent)
    el.innerHTML = `<option value="">${TEXT.DEMAND_FILTER_ALL}</option>` + opts.map(o =>
      `<option value="${escHtml(o.value)}">${escHtml(o.label)}</option>`).join('');
  };
  fill('demand-filter-subject', SUBJECTS.map(s => ({ value: s.id, label: s.name })));
  fill('demand-filter-grade', STUDENT_GRADES.map(g => ({ value: g.id, label: g.name })));
  fill('demand-filter-method', TEACHING_METHODS.map(m => ({ value: m.id, label: m.name })));
  fill('demand-filter-province', (SUFE_REGIONS.provinces || []).map(p => ({ value: p.id, label: p.name })));
  const lbl = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  lbl('demand-filter-subject-label', TEXT.LABEL_SUBJECT);
  lbl('demand-filter-grade-label', TEXT.LABEL_GRADE);
  lbl('demand-filter-method-label', TEXT.LABEL_TEACHING_METHOD_PROFILE);
  lbl('demand-filter-province-label', TEXT.LABEL_PROVINCE);
}

export function demandSortMode() {
  const el = document.getElementById('demand-sort');
  return el ? el.value : 'match';
}

// Teacher demand hall render (shared by loadBrowseDemands + applyDemandControls):
// pinned pushes + filter (subject/grade/method/province) + sort (match/newest/budget) + filter empty state
export function renderBrowseDemands(pushes, demands) {
  const el = document.getElementById('browse-demands-list') || document.getElementById('demands-list');
  if (!el) return;
  const isGuest = !state.user;
  const myTeacher = (!isGuest && state.user && state.user.role === ROLES.TEACHER)
    ? state.allTeachers.find(t => t.user_id === state.user.id) : null;
  const pushDemandIds = new Set(pushes.map(p => p.id));
  const pinned = pushes.map(p => renderDemandCard(p, { push: p, teacher: true, myTeacher })).join('');
  const gv = id => { const el = document.getElementById(id); return el ? el.value : ''; };
  const fSubj = gv('demand-filter-subject'), fGrade = gv('demand-filter-grade');
  const fMethod = gv('demand-filter-method'), fProv = gv('demand-filter-province');
  const filterActive = fSubj || fGrade || fMethod || fProv;
  let normalDemands = demands.filter(d => {
    if (pushDemandIds.has(d.id)) return false;
    if (fSubj && !(d.target_subjects || []).includes(fSubj)) return false;
    if (fGrade && d.student_grade !== fGrade) return false;
    if (fMethod && d.teaching_method !== fMethod) return false;
    if (fProv && d.province !== fProv) return false;
    return true;
  });
  // Precompute _md on demand objects for renderDemandCard badge reuse (single pass, sort then render)
  const mdOf = {};
  if (myTeacher) for (const d of normalDemands) { const m = matchDegree(myTeacher, d); mdOf[d.id] = m; d._md = m; }
  const mode = demandSortMode();
  if (mode === 'newest') normalDemands.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  else if (mode === 'budget') normalDemands.sort((a, b) => (a.budget_min ?? Infinity) - (b.budget_min ?? Infinity));
  else normalDemands.sort((a, b) => (mdOf[b.id] ?? -1) - (mdOf[a.id] ?? -1)); // match-highest
  const normal = normalDemands.map(d => renderDemandCard(d, { teacher: true, myTeacher })).join('');
  el.innerHTML = (pinned ? `<div class="section-title spacer-sm">${TEXT.PUSH_SECTION_TITLE}</div>${pinned}` : '')
    + normal
    + (filterActive && !normalDemands.length ? `<div class="empty-state empty-state--small"><p>${escHtml(TEXT.DEMAND_FILTER_EMPTY)}</p></div>` : '');
  initReveals(el);
}

// #158: control change re-renders locally from the cached source (no loader, no network)
export function applyDemandControls() {
  if (state.page !== 'browse-demands') return;
  renderBrowseDemands(_browsePushes, _browseNormal);
}

// v1 parity: filter panel collapse toggle -- DOM id follows the v1 contract (index.html demand-filter-panel)
export function toggleDemandFilters() {
  const p = document.getElementById('demand-filter-panel');
  if (p) p.classList.toggle('hidden');
}

// ============================================================
// Demand push (student -> specific teacher) with greet message
// ============================================================
// v1 parity: modal lists own demands as radio picks (fresh fetch via dhGet forceRefresh so contracted
// demands never leak into the candidates), optional greet textarea (maxlength synced to server)
export async function openSendDemandModal(teacherUserId) {
  if (!ensureAuth()) return;
  const t = state.allTeachers.find(x => x.user_id === teacherUserId);
  const tName = t ? t.username : TEXT.PUSH_TEACHER_FALLBACK;
  let demands = [];
  try { demands = (await dhGet('/api/student/demands?scope=mine', { domain: 'demands', forceRefresh: true })).demands || []; state.myDemands = demands; }
  catch { demands = state.myDemands; }
  demands = demands.filter(d => demandIsActive(d)); // unified active-demand predicate
  const pickHtml = demands.length ? `<div class="push-pick">${demands.map(d => {
    const grade = studentGradeName(d.student_grade) || '';
    const subs = demandTargetNames(d.target_subjects, d.target_type);
    const prov = provinceName(d.province);
    const method = methodName(d.teaching_method);
    return `<label class="push-pick-item glass"><input type="radio" name="push-demand" value="${d.id}">
      <span><span class="push-pick-main">${escHtml(grade)}${subs ? ' · ' + escHtml(subs) : ''}</span>
      <span class="push-pick-sub">${[prov, method].filter(Boolean).map(escHtml).join(' · ')}</span></span></label>`;
  }).join('')}</div>` : `<p class="text-sm text-muted">${state.myDemands.length ? TEXT.PUSH_NO_AVAILABLE_DEMANDS : TEXT.EMPTY_NO_MY_DEMANDS_SHORT}</p>`;
  const greetHtml = `<div class="push-greet spacer-md">
      <label class="form-label greet-form-label" for="push-greet">${TEXT.PUSH_GREET_LABEL}</label>
      <textarea id="push-greet" class="form-input greet-input" rows="3" maxlength="${CONFIG.GREETING_MSG_MAX}"
        placeholder="${escHtml(TEXT.PUSH_GREET_PLACEHOLDER)}"></textarea>
      <p class="text-xs text-muted spacer-sm">${TEXT.PUSH_GREET_OPTIONAL}</p>
    </div>`;
  openModal({
    title: `${TEXT.PUSH_MODAL_TITLE_PREFIX}${tName}`, // openModal escapes the title internally
    style: `max-width:${CONFIG.MODAL_W_SEND};`,
    closable: false,
    body: `<p class="text-sm text-muted spacer-md">${TEXT.PUSH_MODAL_HINT}</p>
      ${pickHtml}${greetHtml}`,
    footer: `<button type="button" class="btn btn-outline glass glass--pressable" data-action="student.closeModal">${TEXT.BTN_CANCEL}</button>
      <button type="button" class="btn glass glass--pressable" ${demands.length ? '' : 'disabled'} data-action="student.push" data-teacher="${teacherUserId}">${TEXT.BTN_SEND}</button>`,
  });
}

// v1 parity: push submission reads the selected demand radio + greet textarea, honors the global
// per-minute cooldown, POSTs { teacherUserId, demandId, message }
export async function submitDemandPush(teacherUserId) {
  const sel = document.querySelector('input[name="push-demand"]:checked');
  if (!sel) { showToast(TEXT.VALIDATE_SELECT_DEMAND); return; }
  if (pushCooldownLeft() > 0) { showToast(`${TEXT.PUSH_BTN_COOLDOWN} ${pushCooldownLeft()}s`); return; }
  const message = (document.getElementById('push-greet')?.value ?? '').trim();
  try {
    const data = await api('/api/demand-pushes', { method: 'POST', body: { teacherUserId, demandId: +sel.value, message } });
    closeModal();
    startPushCooldown(CONFIG.PUSH_COOLDOWN_SEC);
    showToast(data.message || TEXT.PUSH_SENT_FALLBACK);
  } catch (err) { showToast(err.message); }
}

// Teacher handles a student's push: confirm = start conversation; reject = decline (student notified)
export async function resolvePush(pushId, accept) {
  try {
    await api(`/api/demand-pushes/${pushId}/resolve`, { method: 'POST', body: { action: accept ? 'accept' : 'reject' } });
    showToast(accept ? TEXT.PUSH_ACCEPTED_TOAST : TEXT.PUSH_REJECTED_TOAST);
    invalidate('demands');
    if (accept) invalidate('chat'); // accept creates a conversation: my-chats shows it immediately
    loadBrowseDemands();
  } catch (err) { showToast(err.message); }
}

// ============================================================
// Teacher intent (submit / student resolve)
// ============================================================
// v1 parity: intent flow is a greet-message modal (Airbnb-style), not a plain confirm -- keeps the
// demand context line, optional textarea (maxlength synced to server GREETING_MSG_MAX), empty submittable
export async function submitIntent(demandId) {
  if (!ensureAuth()) return; // guest teacher browsing the hall can see cards; intent click routes to login
  const d = (state.browseDemands || []).find(x => x.id === demandId);
  const demandDesc = d
    ? `${demandTargetNames(d.target_subjects, d.target_type) || '—'} · ${demandIdText(d.display_id || d.id)}`
    : '';
  openModal({
    title: TEXT.INTENT_GREET_TITLE,
    style: `max-width:${CONFIG.MODAL_W_INTENT_CONFIRM};`,
    body: `<p class="text-sm text-muted spacer-md">${TEXT.INTENT_GREET_DEMAND.replace('{demand}', escHtml(demandDesc))}</p>
      <label class="form-label greet-form-label" for="intent-greet-${demandId}">${TEXT.INTENT_GREET_LABEL}</label>
      <textarea id="intent-greet-${demandId}" class="form-input greet-input" rows="4" maxlength="${CONFIG.GREETING_MSG_MAX}"
        placeholder="${escHtml(TEXT.INTENT_GREET_PLACEHOLDER)}"></textarea>
      <p class="text-xs text-muted spacer-sm">${TEXT.INTENT_GREET_OPTIONAL}</p>`,
    footer: `<button type="button" class="btn btn-outline glass glass--pressable" data-action="student.closeModal">${TEXT.BTN_CANCEL}</button>
      <button type="button" class="btn glass glass--pressable" data-action="student.doSubmitIntent" data-id="${demandId}">${TEXT.BTN_SUBMIT_INTENT}</button>`,
  });
}

// v1 parity: actual intent submit -- read the greet textarea BEFORE closeModal (textarea is destroyed
// on close), optimistic pending button swap on the browse card (CTA has data-demand-id, audit fix B),
// rollback on failure
export async function doSubmitIntent(demandId) {
  const message = (document.getElementById(`intent-greet-${demandId}`)?.value ?? '').trim();
  closeModal();
  const d = (state.browseDemands || []).find(x => x.id === demandId);
  const origStatus = d ? d.my_intent_status : undefined;
  const pendingHtml = `<button type="button" class="btn btn-soft btn-sm btn-intent-wait glass glass--pressable" disabled data-demand-id="${demandId}">${TEXT.INTENT_PENDING}</button>`;
  if (d) d.my_intent_status = STATUS.PENDING;
  const cta = document.querySelector(`.btn-intent-cta[data-demand-id="${demandId}"]`);
  const origHtml = cta ? cta.outerHTML : ''; // constant-derived button HTML, not user input
  if (cta) cta.outerHTML = pendingHtml; // optimistic: button flips to pending immediately
  try {
    await api(`/api/demands/${demandId}/intents`, { method: 'POST', body: { message } });
    showToast(TEXT.INTENT_SUBMITTED_TOAST);
    invalidate('demands');
  } catch (err) {
    if (d) d.my_intent_status = origStatus;
    const wait = document.querySelector(`.btn-intent-wait[data-demand-id="${demandId}"]`);
    if (wait) wait.outerHTML = origHtml;
    if (err.code === 'PROFILE_INCOMPLETE') { showProfileIncompleteModal(); return; } // branch on stable code, not text
    showToast(err.message);
  }
}

// Intent row lookup is scoped to THIS demand's intents box (audit fix): the same teacher can have
// pending intents on multiple of the student's demands, so a bare [data-teacher] query would resolve
// the wrong intent_id.
function intentRowFor(demandId, teacherId) {
  const box = document.getElementById(`intents-box-${demandId}`);
  const root = box || document;
  return root.querySelector(`[data-intent-row][data-teacher="${teacherId}"]`);
}

export async function resolveIntent(demandId, teacherId) {
  try {
    const row = intentRowFor(demandId, teacherId);
    const intentId = Number(row?.dataset.intentId || 0);
    await api(`/api/intents/${intentId}/resolve`, { method: 'POST', body: { action: 'accept' } });
    showToast(TEXT.INTENT_RESOLVED_TOAST);
    invalidate('demands');
    loadMyDemands();
  } catch (err) { showToast(err.message); }
}

export async function rejectIntent(demandId, teacherId) {
  try {
    const row = intentRowFor(demandId, teacherId);
    const intentId = Number(row?.dataset.intentId || 0);
    await api(`/api/intents/${intentId}/resolve`, { method: 'POST', body: { action: 'reject' } });
    showToast(TEXT.INTENT_REJECTED_TOAST);
    invalidate('demands');
    loadMyDemands();
  } catch (err) { showToast(err.message); }
}

// v1 parity: expand/collapse the intents list on a demand card (grid-rows animation + caret flip),
// lazy-load /api/demands/:id/intents on first open, red dot clears on open
export async function toggleDemandIntents(demandId) {
  const box = document.getElementById(`intents-box-${demandId}`);
  if (!box) return;
  const toggle = document.getElementById(`intent-toggle-${demandId}`);
  const open = box.classList.toggle('open');
  if (toggle) toggle.classList.toggle('open', open);
  if (open) {
    const dot = document.getElementById(`intent-dot-${demandId}`);
    if (dot) dot.classList.add('hidden');
  }
  if (open && !box.dataset.loaded) await refreshIntentsBox(demandId);
}

export async function refreshIntentsBox(demandId) {
  const box = document.getElementById(`intents-box-${demandId}`);
  if (!box) return;
  const inner = box.querySelector('.intents-box-inner') || box;
  inner.innerHTML = `<div class="intents-box-content">${loaderHtml()}</div>`;
  try {
    const data = await api(`/api/demands/${demandId}/intents`);
    const ts = data.teachers || [];
    const content = `<div class="section-title">${TEXT.INTENTS_TITLE} (${ts.length})</div>` +
      (ts.length ? ts.map(t => renderIntentTeacherRow(t, demandId)).join('')
                : `<p class="text-sm text-muted">${TEXT.EMPTY_NO_INTENTS}</p>`);
    inner.innerHTML = `<div class="intents-box-content">${content}</div>`;
    box.dataset.loaded = '1';
  } catch (err) {
    inner.innerHTML = `<div class="intents-box-content"><p class="text-sm text-muted">${TEXT.ERROR_LOAD_PREFIX}${escHtml(err.message)}</p></div>`;
  }
}

// ============================================================
// Match detail float card (teacher view on a demand's match badge)
// ============================================================
// v1 parity: click toggles a floating match-detail card anchored to the badge; mount on body so the
// .list-card backdrop-filter containing block cannot trap the fixed positioning; one card at a time
export function showMatchDetail(demandId) {
  const d = (state.browseDemands || []).find(x => x.id === demandId);
  const t = state.allTeachers.find(x => x.user_id === state.user.id);
  if (!d || !t) return;
  if (_matchDetailOpen) { closeMatchDetail(); return; }
  const md = matchDegree(t, d);
  if (md == null) return;
  const btn = document.querySelector(`[data-action="student.matchDetail"][data-id="${demandId}"]`);
  if (!btn) return;
  btn.insertAdjacentHTML('afterend', matchDetailHtml(t, d, md));
  const card = btn.nextElementSibling;
  if (!card || !card.classList.contains('match-detail')) return;
  document.body.appendChild(card);
  positionFloatCard(btn, card);
  _matchDetailOpen = true;
}

export function closeMatchDetail() {
  const card = document.querySelector('.match-detail');
  if (card) card.remove();
  _matchDetailOpen = false;
}

function onMatchDetailDocClick(e) {
  if (!_matchDetailOpen) return;
  if (!e.target.closest('.match-detail') && !e.target.closest('.tag-match')) closeMatchDetail();
}
function onMatchDetailKey(e) { if (e.key === 'Escape') closeMatchDetail(); }
function onMatchDetailScroll() { if (_matchDetailOpen) closeMatchDetail(); }
export function installMatchDetailClose() {
  document.addEventListener('click', onMatchDetailDocClick);
  document.addEventListener('keydown', onMatchDetailKey);
  document.addEventListener('scroll', onMatchDetailScroll, { capture: true, passive: true });
  return () => {
    document.removeEventListener('click', onMatchDetailDocClick);
    document.removeEventListener('keydown', onMatchDetailKey);
    document.removeEventListener('scroll', onMatchDetailScroll, { capture: true });
  };
}

// ============================================================
// Demand detail / misc
// ============================================================
export function openDemandCard(id) {
  const d = [...(state.myDemands || []), ...(state.browseDemands || [])].find(x => x.id === id);
  if (!d) return;
  openModal({ title: demandIdText(d.display_id), body: `<div class="demand-detail">${escHtml(d.additional_info || '')}</div>` });
}

export function closeModalAction() { closeModal(); }

export function showProfileIncompleteModal() { showToast(TEXT.PROFILE_INCOMPLETE_HINT, 'error'); }


// Demand form/wizard re-export — the delegation map (index.js) and direct-import tests
// address these via actions.js; the bodies live in form.js.
export { setDemandType, renderSkillNotes, collectSkillNotes, prefillSkillNotes, toggleTagPickAction, _wizardResetForTests, demandWizardGoTo, demandWizardNext, demandWizardBack, demandWizardValidateStep, openDemandModal, initDemandForm, onDemandProvinceChange, updateDemandSubjects, updateDemandScores, prefillDemandForm, prefillStudentScores, toggleAddressField, handleSubmitDemand, confirmDeleteDemand, handleDeleteDemand, reopenDemand } from './form.js';
