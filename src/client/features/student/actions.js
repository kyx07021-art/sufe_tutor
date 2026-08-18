/**
 * student/demand feature actions: list, browse/filter, create/edit, intents, pushes, match detail.
 * v1 parity (B4 redo): every rendered action is fully wired -- no empty stubs behind data-action.
 * Edit PUT is merge-preserve: fields the simplified form cannot edit are carried over from the
 * source demand so the full-column server UPDATE never drops data (audit blocking-fix A).
 */
import { TEXT } from './text.js';
import { state, loadSeqs } from '../../core/state.js';
import { api, ensureAuth } from '../../core/api.js';
import { dhGet, dhOnDomainRefresh, invalidate } from '../../core/datahub.js';
import { openModal, closeModal, showToast, btnLoading, btnDone, confirm } from '../../core/ui.js';
import { escHtml, loaderHtml } from '../../core/dom.js';
import { initReveals, positionFloatCard } from '../../core/anim.js';
import { matchDegree, matchDetailHtml } from '../../core/match.js';
import { demandIsActive, demandTargetNames, demandIdText, studentGradeName, provinceName, methodName } from '../../core/display.js';
import { renderDemandCard, renderDemandModalHtml, renderIntentTeacherRow, pushCooldownLeft, startPushCooldown } from './render.js';
import { buildStudentSubjectsHtml, buildStudentScoreRows } from '../region/render.js';
import { SUFE_REGIONS } from '../../constants/region-data.js';
import { STUDENT_GRADES, STATUS, SUBJECTS, TEACHING_METHODS } from '../../../shared/enums.js';
import { CONFIG } from '../../../shared/config.js';

// #158: control-change local re-render data source (pinned pushes + normal demands same pool)
let _browsePushes = [], _browseNormal = [];
// Match-detail float card: at most one open at a time (v1 _matchDetailOpen)
let _matchDetailOpen = false;

export function loadMyDemands() {
  const el = document.getElementById('my-demands-list');
  if (!el) return;
  el.innerHTML = '<div class="empty-state">loading</div>';
  return dhGet('/api/student/demands?scope=mine', { domain: 'demands' }).then(data => {
    state.myDemands = data.demands || [];
    el.innerHTML = state.myDemands.map(renderDemandCard).join('') || `<div class="empty-state">${TEXT.EMPTY_NO_MY_DEMANDS}</div>`;
  }).catch(err => { el.innerHTML = `<div class="empty-state"><p>${escHtml(err.message)}</p></div>`; });
}

// v1 parity: browse hall with out-of-order guard (loadSeqs) + parallel teacher-profile fetch +
// pinned pushes + state.browseDemands single source for openDemandCard/submitIntent lookups
export async function loadBrowseDemands() {
  const el = document.getElementById('browse-demands-list') || document.getElementById('demands-list');
  if (!el) return;
  const seq = (loadSeqs['browse-demands'] = (loadSeqs['browse-demands'] || 0) + 1); // || 0 init: NaN !== NaN would drop first render
  const isGuest = !state.user;
  const needTeachers = !isGuest && state.user.role === 'teacher' && !state.allTeachers.length;
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
  const myTeacher = (!isGuest && state.user && state.user.role === 'teacher')
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

dhOnDomainRefresh('demands', () => { loadMyDemands(); loadBrowseDemands(); });

// ============================================================
// Demand create / edit modal
// ============================================================
// v1 parity: edit branch fetches the latest demand (scope=mine) before prefill -- the mirrored
// state.myDemands may be stale after contracts/pushes happened on other pages. Two race guards:
// editingDemandId still this one + modal area untouched while awaiting.
export async function openDemandModal(demandId) {
  state.editingDemandId = demandId || null;
  const demand = demandId ? (state.myDemands || []).find(d => d.id === demandId) : null;
  let editDemand = demand || null;
  if (demandId) {
    const modalBefore = typeof document !== 'undefined' ? (document.getElementById('modal-container')?.innerHTML ?? '') : '';
    try {
      invalidate('demands'); // edit forces fresh data, not the 60s TTL cache
      const data = await dhGet('/api/student/demands?scope=mine', { domain: 'demands', forceRefresh: true });
      if (state.editingDemandId !== demandId) return; // race guard 1: user opened another demand/new
      if (document.getElementById('modal-container')?.innerHTML !== modalBefore) return; // race guard 2: modal area reused
      if (data && Array.isArray(data.demands)) {
        state.myDemands = data.demands; // sync mirror (edit prefill + merge-preserve source)
        editDemand = data.demands.find(x => x.id === demandId) || demand;
      }
    } catch {
      if (state.editingDemandId !== demandId || document.getElementById('modal-container')?.innerHTML !== modalBefore) return;
      editDemand = demand;
    }
  }
  openModal({
    title: editDemand ? TEXT.MODAL_TITLE_DEMAND_EDIT : TEXT.MODAL_TITLE_DEMAND_CREATE,
    closable: false, // demand form costs: click-through must not drop input (v1 parity)
    body: renderDemandModalHtml(editDemand),
    footer: `<button type="button" class="btn btn-outline glass glass--pressable" data-action="student.closeModal">${TEXT.BTN_CANCEL}</button>
      <button type="button" id="d-submit" class="btn glass glass--pressable" data-action="student.submitDemand">${editDemand ? TEXT.BTN_SAVE_DEMAND : TEXT.BTN_SUBMIT_DEMAND}</button>`,
  });
  initDemandForm(editDemand ? editDemand.province : null);
  if (editDemand) prefillDemandForm(editDemand);
}

export function renderDemandModal(d) { return openDemandModal(d && d.id); }

export function initDemandForm(selectedProvince) {
  const prov = document.getElementById('d-province');
  if (prov && selectedProvince) prov.value = selectedProvince;
  onDemandProvinceChange(); // build grade options + subject pool (+ lock online for non-shanghai regions)
}

// v1 parity: province change rebuilds grade options for the region's school system + subject pool
export function onDemandProvinceChange() {
  const prov = document.getElementById('d-province');
  const gradeSel = document.getElementById('d-grade');
  if (!prov || !gradeSel) return;
  const provId = prov.value;
  const prevGrade = gradeSel.value;
  const gradeOpts = gradeOptionsForProvince(provId);
  gradeSel.disabled = !provId;
  gradeSel.innerHTML = `<option value="">${provId ? TEXT.OPTION_PLACEHOLDER : TEXT.SELECT_PROVINCE_FIRST}</option>`
    + gradeOpts.map(g => `<option value="${g.id}">${g.name}</option>`).join('');
  if (prevGrade && gradeOpts.some(g => g.id === prevGrade)) gradeSel.value = prevGrade;
  updateDemandSubjects();
}

// v1 parity: subject pool = SUFE_REGIONS.subjectsFor(province, grade)
export function updateDemandSubjects() {
  const prov = document.getElementById('d-province')?.value || '';
  const grade = document.getElementById('d-grade')?.value || '';
  const el = document.getElementById('d-subjects');
  if (!el) return;
  if (!prov || !grade) {
    el.innerHTML = `<p class="text-sm text-muted">${TEXT.HINT_SELECT_PROVINCE_GRADE}</p>`;
    const scores = document.getElementById('d-scores');
    if (scores) scores.innerHTML = '';
    return;
  }
  el.innerHTML = buildStudentSubjectsHtml(prov, grade);
  updateDemandScores();
}

// v1 parity: score rows follow checked subjects incrementally (keep existing user input)
export function updateDemandScores() {
  const prov = document.getElementById('d-province')?.value || '';
  const grade = document.getElementById('d-grade')?.value || '';
  const checked = [...document.querySelectorAll('#d-subjects input:checked')].map(cb => cb.value);
  const el = document.getElementById('d-scores');
  if (!el) return;
  if (!prov || !grade) { el.innerHTML = ''; return; }
  if (!checked.length) { el.innerHTML = `<p class="text-sm text-muted">${TEXT.HINT_SELECT_TARGET_SUBJECTS}</p>`; return; }
  el.querySelectorAll('.region-score-row').forEach(row => {
    if (!checked.includes(row.dataset.scoreSubject)) row.remove();
  });
  const present = new Set([...el.querySelectorAll('.region-score-row')].map(r => r.dataset.scoreSubject));
  const fresh = checked.filter(sid => !present.has(sid));
  if (fresh.length) el.insertAdjacentHTML('beforeend', buildStudentScoreRows(prov, grade, fresh));
}

// v1 parity: edit prefill -- programmatic checkbox changes do not fire change events, so the score
// rows must be rebuilt/refilled manually after checking subjects
export function prefillDemandForm(d) {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
  set('d-province', d.province);
  onDemandProvinceChange();
  set('d-grade', d.student_grade);
  updateDemandSubjects();
  const checkById = sid => [...(document.querySelectorAll('#d-subjects input'))].find(cb => cb.value === sid) || null;
  (d.target_subjects || []).forEach(sid => { const cb = checkById(sid); if (cb) cb.checked = true; });
  updateDemandScores();
  prefillStudentScores(d.current_scores || []);
  set('d-method', d.teaching_method || 'offline');
  set('d-budget-min', d.budget_min || '');
  set('d-budget-max', d.budget_max || '');
  set('d-parent-contact', d.parent_contact || '');
  set('d-student-contact', d.student_contact || '');
  set('d-info', d.additional_info || '');
}

// v1 parity: prefill saved score rows by matching subject (traversal compare, never attribute-selector
// interpolation -- dirty legacy sids with quotes/brackets would throw a SyntaxError)
export function prefillStudentScores(scores) {
  const rows = [...document.querySelectorAll('#d-scores .region-score-row')];
  (scores || []).forEach(cs => {
    const row = rows.find(r => r.dataset.scoreSubject === cs.subject);
    if (!row) return;
    if (cs.grade) {
      const pill = [...row.querySelectorAll('.grade-option')].find(p => p.dataset.grade === cs.grade);
      if (pill) pill.classList.add('selected');
    } else if (cs.score !== '' && cs.score != null) {
      const inp = row.querySelector('input[data-sg-subject]');
      if (inp) inp.value = cs.score;
    }
  });
}

export function toggleAddressField() {
  // v2 form has no address section; kept as a safe no-op targeting the v1 id if the template adds one
  const wrap = document.getElementById('d-address-wrap');
  if (wrap) {
    const show = document.getElementById('d-province')?.value === 'shanghai' && document.getElementById('d-method')?.value === 'offline';
    wrap.classList.toggle('hidden', !show);
  }
}

export function collectStudentScores() {
  const root = document.getElementById('d-scores');
  const out = [];
  if (!root) return out;
  root.querySelectorAll('.region-score-row').forEach(row => {
    const sid = row.dataset.scoreSubject;
    const inp = row.querySelector('input[data-sg-subject]');
    out.push({ subject: sid, mode: 'score', scale: inp ? +inp.dataset.scoreMax : 100, score: inp ? inp.value : '' });
  });
  return out;
}

// v1 parity: submit branches create vs edit (PUT /api/student/demands/:id); loading state on #d-submit.
// Merge-preserve (audit fix A): the simplified form only edits a subset of demand fields; the full-column
// server UPDATE would blank the rest, so edit carries over every unform field from the freshly-fetched
// source demand -- target_type, address, expected_time, gender, goals, skills, tags, pref-gender, submitter.
export async function handleSubmitDemand() {
  const grade = document.getElementById('d-grade')?.value || '';
  const subjects = [...document.querySelectorAll('#d-subjects input:checked')].map(x => x.value);
  const scores = collectStudentScores();
  if (!grade || !subjects.length) { showToast(TEXT.VALIDATE_DEMAND_INCOMPLETE, 'error'); return; }
  const isEdit = !!state.editingDemandId;
  const src = isEdit ? (state.myDemands || []).find(d => d.id === state.editingDemandId) : null;
  const preserved = {
    target_type: (src && src.target_type) || 'academic',
    student_gender: (src && src.student_gender) || '',
    address: (src && src.address) || '',
    expected_time: (src && src.expected_time) || '',
    submitter_type: (src && src.submitter_type) || 'student',
    preferred_personality_tags: (src && Array.isArray(src.preferred_personality_tags)) ? src.preferred_personality_tags : [],
    preferred_teacher_gender: (src && src.preferred_teacher_gender) || '',
    teaching_goal: (src && Array.isArray(src.teaching_goal)) ? src.teaching_goal : [],
    skill_notes: (src && Array.isArray(src.skill_notes)) ? src.skill_notes : [],
  };
  const payload = { demand: {
    province: document.getElementById('d-province')?.value || '',
    target_type: preserved.target_type,
    student_grade: grade,
    student_gender: preserved.student_gender,
    target_subjects: subjects,
    current_scores: scores,
    preferred_personality_tags: preserved.preferred_personality_tags,
    preferred_teacher_gender: preserved.preferred_teacher_gender,
    teaching_goal: preserved.teaching_goal,
    skill_notes: preserved.skill_notes,
    teaching_method: document.getElementById('d-method')?.value || 'offline',
    address: preserved.address,
    expected_time: preserved.expected_time,
    budget_min: +document.getElementById('d-budget-min')?.value || 0,
    budget_max: +document.getElementById('d-budget-max')?.value || 0,
    submitter_type: preserved.submitter_type,
    parent_contact: document.getElementById('d-parent-contact')?.value || '',
    student_contact: document.getElementById('d-student-contact')?.value || '',
    additional_info: document.getElementById('d-info')?.value || '',
  }};
  const btn = document.getElementById('d-submit');
  try {
    if (btn) btnLoading(btn);
    await api(isEdit ? `/api/student/demands/${state.editingDemandId}` : '/api/student/demands', { method: isEdit ? 'PUT' : 'POST', body: payload });
    closeModal();
    state.editingDemandId = null;
    showToast(isEdit ? TEXT.SUCCESS_DEMAND_UPDATED : TEXT.SUCCESS_DEMAND_SUBMITTED);
    invalidate('demands');
    loadMyDemands();
  } catch (err) { showToast(err.message); }
  finally { if (btn) btnDone(btn, isEdit ? TEXT.BTN_SAVE_DEMAND : TEXT.BTN_SUBMIT_DEMAND); }
}

export function confirmDeleteDemand(id) {
  confirm({ title: TEXT.BTN_DELETE_DEMAND, message: TEXT.CONFIRM_DELETE_DEMAND, onConfirm: () => handleDeleteDemand(id) });
}

export async function handleDeleteDemand(id) {
  try {
    await api(`/api/student/demands/${id}`, { method: 'DELETE', body: {} });
    showToast(TEXT.DEMAND_DELETED_TOAST);
    invalidate('demands');
    loadMyDemands();
  } catch (err) { showToast(err.message); }
}

export function reopenDemand(id) {
  confirm({ message: TEXT.CONFIRM_REOPEN_DEMAND, onConfirm: () => {
    api(`/api/student/demands/${id}/reopen`, { method: 'POST', body: {} })
      .then(data => { showToast(data.message || TEXT.DEMAND_REOPENED_TOAST); invalidate('demands'); loadMyDemands(); })
      .catch(err => showToast(err.message));
  }});
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
    ts.forEach(t => {
      state.intentTeachers = state.intentTeachers.filter(x => x.user_id !== t.user_id);
      state.intentTeachers.push(t);
    });
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
export function openDemandDetail(id) { openDemandCard(id); }

export function closeModalAction() { closeModal(); }

export function showProfileIncompleteModal() { showToast(TEXT.PROFILE_INCOMPLETE_HINT, 'error'); }

export function loadDemandList() { return loadMyDemands(); }

// ============================================================
// Demand type tabs (R2-b) -- academic / non-academic segment state
// ============================================================
export function switchDemandType(type) { setDemandType(type); }
export function setDemandType(type) { state.demandType = type; }

// Demand form wizard (B5 pending): dormant step-state API kept for the wizard batch, not wired to UI
export function demandWizardGoTo(step) { state.demandStep = step; }
export function demandWizardNext() { if (state.demandStep == null) state.demandStep = 1; else state.demandStep++; }
export function demandWizardBack() { if (state.demandStep) state.demandStep--; }
export function demandWizardValidateStep() { return true; }

export function gradeOptionsForProvince(provinceId) {
  if (SUFE_REGIONS.isFiveFour(provinceId)) return STUDENT_GRADES.filter(g => g.id !== 'p6');
  return STUDENT_GRADES.filter(g => g.id !== 'prep');
}
