/**
 * student/demand feature actions: list, browse/filter, create/edit, intents, pushes, match detail.
 * v1 parity (B4 redo): every rendered action is fully wired -- no empty stubs behind data-action.
 * Edit PUT is merge-preserve: fields the simplified form cannot edit are carried over from the
 * source demand so the full-column server UPDATE never drops data (audit blocking-fix A).
 */
import { TEXT } from '../../constants/text.js';
import { state, loadSeqs } from '../../core/state.js';
import { api, ensureAuth } from '../../core/api.js';
import { dhGet, dhOnDomainRefresh, invalidate } from '../../core/datahub.js';
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
        state.myDemands = data.demands; // sync mirror (edit prefill + full-form source)
        editDemand = data.demands.find(x => x.id === demandId) || demand;
      }
    } catch {
      if (state.editingDemandId !== demandId || document.getElementById('modal-container')?.innerHTML !== modalBefore) return;
      editDemand = demand;
    }
  }
  // v1 parity: reset wizard completion state; edit mode completion = visited (flipped through),
  // create mode = done (validated). Nav/back/submit live inside the form (dw-footer).
  _dwEditMode = !!editDemand;
  demandWizardDone.clear();
  demandWizardVisited.clear();
  openModal({
    title: editDemand ? TEXT.MODAL_TITLE_DEMAND_EDIT : TEXT.MODAL_TITLE_DEMAND_CREATE,
    closable: false, // demand form costs: click-through must not drop input (v1 parity)
    body: renderDemandModalHtml(editDemand),
  });
  initDemandForm(editDemand ? editDemand.province : null);
  if (editDemand) prefillDemandForm(editDemand);
}

// NOTE: no renderDemandModal(id) passthrough here -- the audit-traced editDemand breakage came from
// `renderDemandModal(n) => openDemandModal(n && n.id)` (Number.id === undefined → opened CREATE form).
// The edit button now calls openDemandModal(id) directly via the delegation map (v1 parity).

// v1 parity: wizard init -- province select into d-province-wrap, region-lock + grade/subject pool,
// address visibility, custom selects, form listeners (submit / change / type tabs / time slots),
// then land on P1. Direct DOM bindings (no inline handlers); idempotent via form.dataset.wizardBound.
export function initDemandForm(selectedProvince) {
  const wrap = document.getElementById('d-province-wrap');
  const form = document.getElementById('demand-form');
  if (!form) return;
  if (wrap) {
    wrap.innerHTML = renderProvinceSelect('d-province', selectedProvince || ''); // direct change binding below (no inert data-region-change)
    const prov = document.getElementById('d-province');
    if (prov) prov.addEventListener('change', onDemandProvinceChange);
  }
  const method = document.getElementById('d-method');
  const grade = document.getElementById('d-grade');
  const subjects = document.getElementById('d-subjects');
  const nonacademic = document.getElementById('d-nonacademic');
  if (!form.dataset.wizardBound) {
    form.dataset.wizardBound = '1';
    if (method) method.addEventListener('change', toggleAddressField);
    if (grade) grade.addEventListener('change', updateDemandSubjects);
    if (subjects) subjects.addEventListener('change', updateDemandScores);
    if (nonacademic) nonacademic.addEventListener('change', renderSkillNotes);
    form.addEventListener('submit', e => { e.preventDefault(); handleSubmitDemand(); });
    form.addEventListener('seg-tab-change', e => {
      const c = e.detail && e.detail.container;
      if (c && c.id === 'd-type-tabs') setDemandType(e.detail.key);
    });
    applyTabBindings(form);      // type tabs + score-mode tabs
    bindTimeSlotTree(form);      // P7 time-slot add rows
  }
  onDemandProvinceChange(); // initial run: region note + lock online + grade options + subject pool
  toggleAddressField();     // P2 address section visibility (shanghai+offline only)
  initCustomSelects(form);  // province/grade/gender/method/identity custom dropdowns (idempotent)
  demandWizardGoTo(1);      // always start from P1 (edit prefill re-lands on P1 at its end)
}

// v1 parity: province change -- region lock note (offline only unlocked for Shanghai), school-system
// grade options (keep previous grade if it survives), online-only method lock for non-Shanghai,
// address section refresh + subject pool rebuild.
export function onDemandProvinceChange() {
  const prov = document.getElementById('d-province');
  if (!prov) return;
  const provId = prov.value;
  const noteEl = document.getElementById('d-region-note');
  if (noteEl) noteEl.innerHTML = regionLockNote(provId); // regionLockNote also hints for empty
  const gradeSel = document.getElementById('d-grade');
  if (gradeSel) {
    const prevGrade = gradeSel.value;
    const gradeOpts = gradeOptionsForProvince(provId);
    gradeSel.disabled = !provId;
    gradeSel.innerHTML = `<option value="">${provId ? TEXT.OPTION_PLACEHOLDER : TEXT.SELECT_PROVINCE_FIRST}</option>`
      + gradeOpts.map(g => `<option value="${g.id}">${g.name}</option>`).join('');
    if (prevGrade && gradeOpts.some(g => g.id === prevGrade)) gradeSel.value = prevGrade;
  }
  const methodSel = document.getElementById('d-method');
  if (methodSel) {
    const onlineOnly = !SUFE_REGIONS.allowsOffline(provId); // offline permission data-driven
    [...methodSel.options].forEach(o => { o.disabled = onlineOnly && o.value !== 'online'; });
    if (onlineOnly) methodSel.value = 'online';
    const mnote = document.getElementById('d-method-note');
    if (mnote) mnote.textContent = onlineOnly ? TEXT.REGION_HINT_OFFLINE_ONLY : '';
  }
  toggleAddressField(); // province switch always refreshes the address area
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

// v1 parity: score rows follow checked subjects incrementally (keep existing user input).
// Audit fix (F1): the "please pick subjects first" placeholder <p> must be REPLACED by the first
// batch of rows (v1 uses replaceWith) -- appending after it left the hint permanently on the page.
// F5: row order realigns with the checkbox order (checked.forEach append).
export function updateDemandScores() {
  const prov = document.getElementById('d-province')?.value || '';
  const grade = document.getElementById('d-grade')?.value || '';
  const checked = [...document.querySelectorAll('#d-subjects input:checked')].map(cb => cb.value);
  const el = document.getElementById('d-scores');
  if (!el) return;
  if (!prov || !grade) { el.innerHTML = ''; return; }
  if (!checked.length) { el.innerHTML = `<p class="text-sm text-muted">${TEXT.HINT_SELECT_TARGET_SUBJECTS}</p>`; return; }
  // 1) remove rows for unchecked subjects (keep the rest + their input)
  el.querySelectorAll('.region-score-row').forEach(row => {
    if (!checked.includes(row.dataset.scoreSubject)) row.remove();
  });
  // 2) only render rows for freshly checked subjects
  const present = new Set([...el.querySelectorAll('.region-score-row')].map(r => r.dataset.scoreSubject));
  const fresh = checked.filter(sid => !present.has(sid));
  if (fresh.length) {
    const html = buildStudentScoreRows(prov, grade, fresh);
    const ph = el.querySelector(':scope > p'); // "please pick subjects first" placeholder
    if (ph) ph.replaceWith(document.createRange().createContextualFragment(html));
    else el.insertAdjacentHTML('beforeend', html);
    applyTabBindings(el); // bind grade/score seg-tabs on fresh rows (idempotent via data-tab-bound)
  }
  // 3) realign row order to the checkbox order (append moves rows without dropping input)
  checked.forEach(sid => {
    const row = el.querySelector(`.region-score-row[data-score-subject="${sid}"]`);
    if (row) el.appendChild(row);
  });
}

// v1 parity: edit prefill -- full 8-step form. Order matters: province → grade → type section →
// gender → target checks → score/skill rows → teaching goal + personality tag-picks → pref gender →
// method → address (hidden value first, then picker hydrates district/unit) → time slots → budget →
// submitter/contacts/info. Programmatic checkbox changes do not fire change events, so rows are
// rebuilt/refilled manually. Ends back on P1 so the user can walk the pages (visited completion).
export function prefillDemandForm(d) {
  _dwEditMode = true;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
  set('d-province', d.province);
  onDemandProvinceChange();
  set('d-grade', d.student_grade);
  updateDemandSubjects();
  const isNa = d.target_type === DEMAND_TYPES.NONACADEMIC;
  setDemandType(isNa ? DEMAND_TYPES.NONACADEMIC : DEMAND_TYPES.ACADEMIC);
  set('d-gender', d.student_gender || ''); // '' = not-say (prefill tolerant of legacy undefined)
  const checkById = (containerId, sid) => {
    const el = document.getElementById(containerId);
    if (!el) return null;
    return [...el.querySelectorAll('input')].find(cb => cb.value === sid) || null;
  };
  if (isNa) {
    (d.target_subjects || []).forEach(sid => { const cb = checkById('d-nonacademic', sid); if (cb) cb.checked = true; });
    renderSkillNotes(); // render after checking (no change event fires programmatically)
    prefillSkillNotes(d.skill_notes || []);
  } else {
    (d.target_subjects || []).forEach(sid => { const cb = checkById('d-subjects', sid); if (cb) cb.checked = true; });
    updateDemandScores();
    prefillStudentScores(d.current_scores || []);
  }
  (d.teaching_goal || []).forEach(id => {
    const btn = [...document.querySelectorAll('#d-teaching-goals .tag-pick')].find(b => b.dataset.id === id);
    if (btn) btn.classList.add('selected');
  });
  (d.preferred_personality_tags || []).forEach(id => {
    const btn = [...document.querySelectorAll('#d-personality-tags .tag-pick')].find(b => b.dataset.id === id);
    if (btn) btn.classList.add('selected');
  });
  set('d-pref-gender', d.preferred_teacher_gender || '');
  set('d-method', d.teaching_method || 'offline');
  // Legacy free-text addresses that are not a valid district-unit pair are cleared for re-selection
  // (otherwise the save gate would 400-loop on a stale value).
  const storedAddr = SUFE_REGIONS.isValidShanghaiAddr(d.address) ? (d.address || '') : '';
  set('d-address', storedAddr);
  toggleAddressField();
  prefillTimeSlots(document.getElementById('d-time-slots'), d.expected_time || '');
  set('d-budget-min', d.budget_min || '');
  set('d-budget-max', d.budget_max || '');
  set('d-submitter', d.submitter_type || 'parent');
  set('d-parent-contact', d.parent_contact || '');
  set('d-student-contact', d.student_contact || '');
  set('d-info', d.additional_info || '');
  document.querySelectorAll('#demand-form select').forEach(syncCustomSelectText);
  demandWizardGoTo(1); // edit always re-lands on P1 (fields preserved across pages)
}

// v1 parity: prefill saved score rows by matching subject (traversal compare, never attribute-selector
// interpolation -- dirty legacy sids with quotes/brackets would throw a SyntaxError).
export function prefillStudentScores(scores) {
  const rows = [...document.querySelectorAll('#d-scores .region-score-row')];
  (scores || []).forEach(cs => {
    const row = rows.find(r => r.dataset.scoreSubject === cs.subject);
    if (!row) return;
    if (cs.grade) {
      const pill = [...row.querySelectorAll('.grade-option')].find(p => p.dataset.grade === cs.grade);
      if (pill) pickGrade(pill);
    } else if (cs.score !== '' && cs.score != null) {
      const tab = row.querySelector('.seg-tab[data-mode="score"]');
      if (tab) switchScoreMode(tab);
      const inp = row.querySelector('input[data-sg-subject]');
      if (inp) inp.value = cs.score;
    }
  });
  document.querySelectorAll('#demand-form select').forEach(syncCustomSelectText);
}

// v1 parity: P2 address area -- visible + required only for shanghai+offline; any other combo hides
// and clears the value (so a stale address never rides into the payload). Mounts the district/unit
// picker on show, hydrating the hidden #d-address (idempotent rebuild).
export function toggleAddressField() {
  const section = document.getElementById('d-address-section');
  const addrInput = document.getElementById('d-address');
  if (!section || !addrInput) return;
  const prov = document.getElementById('d-province')?.value || '';
  const method = document.getElementById('d-method')?.value || '';
  // T-6-F4: offline address field gated by province policy (allowsOffline), not a hardcoded id
  const show = SUFE_REGIONS.allowsOffline(prov) && method === 'offline';
  if (!show) {
    section.classList.add('hidden');
    addrInput.value = '';
    addrInput.required = false;
    return;
  }
  section.classList.remove('hidden');
  addrInput.required = true;
  mountShanghaiAddrPicker('d', addrInput.value || '', { hiddenId: 'd-address' });
}

// v1 parity: submit branches create vs edit (PUT /api/student/demands/:id); loading state on #d-submit.
// The 8-step form now collects EVERY demand field, so payload is read straight from the form (the
// earlier merge-preserve stopgap for the simplified form is gone -- nothing to preserve).
export async function handleSubmitDemand() {
  const province = document.getElementById('d-province')?.value || '';
  if (!province) { showToast(TEXT.VALIDATE_SELECT_PROVINCE, 'error'); return; }
  if (!document.getElementById('d-grade')?.value) { showToast(TEXT.VALIDATE_SELECT_GRADE, 'error'); return; }
  // Address deep defense must stay in lockstep with toggleAddressField (offline-allowed province + offline only):
  // province-only checks would wrongly block offline-allowed+online submissions. T-6-F4: allowsOffline single source.
  if (SUFE_REGIONS.allowsOffline(province) && document.getElementById('d-method').value === 'offline' && !document.getElementById('d-address').value.trim()) {
    showToast(TEXT.VALIDATE_ADDRESS_REQUIRED, 'error'); return;
  }
  if (!document.getElementById('d-parent-contact')?.value.trim() || !document.getElementById('d-student-contact')?.value.trim()) {
    showToast(TEXT.VALIDATE_CONTACT_REQUIRED, 'error'); return;
  }
  const bMin = document.getElementById('d-budget-min'), bMax = document.getElementById('d-budget-max');
  if (bMin && bMax && bMin.value && bMax.value && +bMin.value > +bMax.value) {
    showToast(TEXT.VALIDATE_BUDGET_RANGE, 'error'); return;
  }
  const typeEl = document.querySelector('#d-type-tabs .seg-tab.active');
  const type = (typeEl && typeEl.dataset.type) || DEMAND_TYPES.ACADEMIC;
  const targetSel = type === DEMAND_TYPES.NONACADEMIC ? '#d-nonacademic input:checked' : '#d-subjects input:checked';
  const subjects = [...document.querySelectorAll(targetSel)].map(cb => cb.value);
  if (!subjects.length) { showToast(TEXT.VALIDATE_SELECT_SUBJECT, 'error'); return; }
  const scores = type === DEMAND_TYPES.NONACADEMIC ? [] : collectStudentScores();
  const prefTags = [...document.querySelectorAll('#d-personality-tags .tag-pick.selected')].map(b => b.dataset.id);
  const teachingGoal = [...document.querySelectorAll('#d-teaching-goals .tag-pick.selected')].map(b => b.dataset.id);
  const skillNotes = type === DEMAND_TYPES.NONACADEMIC ? collectSkillNotes() : [];
  const ts = document.getElementById('d-time-slots');
  const timeErr = ts ? validateTimeSlots(ts) : '';
  if (timeErr) { showToast(timeErr, 'error'); return; }
  const timeSlots = ts ? collectTimeSlots(ts) : [];
  const isEdit = !!state.editingDemandId;
  const payload = { demand: {
    province,
    target_type: type,
    student_grade: document.getElementById('d-grade').value,
    student_gender: document.getElementById('d-gender')?.value || '',
    target_subjects: subjects,
    current_scores: scores,
    preferred_personality_tags: prefTags,
    preferred_teacher_gender: document.getElementById('d-pref-gender')?.value || '',
    teaching_goal: teachingGoal,
    skill_notes: skillNotes,
    teaching_method: document.getElementById('d-method').value,
    address: document.getElementById('d-address').value.trim(),
    expected_time: timeSlots.length ? JSON.stringify(timeSlots) : '',
    budget_min: +document.getElementById('d-budget-min').value || 0,
    budget_max: +document.getElementById('d-budget-max').value || 0,
    submitter_type: document.getElementById('d-submitter').value,
    parent_contact: document.getElementById('d-parent-contact').value.trim(),
    student_contact: document.getElementById('d-student-contact').value.trim(),
    additional_info: document.getElementById('d-info').value.trim(),
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
// Demand type tabs (R2-b) -- academic / non-academic section state
// JS only toggles .active/.hidden classes (zero inline styles, CSS owns presentation).
// Production entry is the d-type-tabs seg-tab-change event (initDemandForm); the v1 onclick-style
// switchDemandType(btn) wrapper is deliberately not carried over (no inline handlers in v2).
// ============================================================
export function setDemandType(type) {
  const isAc = type !== DEMAND_TYPES.NONACADEMIC;
  const tabs = document.getElementById('d-type-tabs');
  if (tabs) tabs.querySelectorAll('.seg-tab').forEach(t => t.classList.toggle('active', t.dataset.type === type));
  const ac = document.getElementById('d-section-academic');
  const na = document.getElementById('d-section-nonacademic');
  if (ac) ac.classList.toggle('hidden', !isAc);
  if (na) na.classList.toggle('hidden', isAc);
  // Type-linked P5 title (scores vs skills) + score/skill pane swap; non-academic clears score rows
  // (so academic subjects never leak into the skills page), academic rebuilds them.
  const title = document.getElementById('d-scores-title');
  if (title) title.textContent = isAc ? TEXT.LABEL_CURRENT_SCORES : TEXT.LABEL_SKILL_STATUS;
  const scoresEl = document.getElementById('d-scores');
  const skillEl = document.getElementById('d-skill-notes');
  if (scoresEl) scoresEl.classList.toggle('hidden', !isAc);
  if (skillEl) skillEl.classList.toggle('hidden', isAc);
  if (isAc) {
    if (scoresEl && document.getElementById('d-province')) {
      scoresEl.innerHTML = `<p class="text-sm text-muted">${TEXT.HINT_SELECT_TARGET_SUBJECTS}</p>`;
      updateDemandScores();
    }
  } else {
    renderSkillNotes();
  }
}

// P5 non-academic skill-state textareas follow the checked projects (incremental: keep typed rows)
export function renderSkillNotes() {
  const el = document.getElementById('d-skill-notes');
  if (!el) return;
  const checked = [...document.querySelectorAll('#d-nonacademic input:checked')].map(cb => cb.value);
  if (!checked.length) { el.innerHTML = `<p class="text-sm text-muted">${TEXT.HINT_SELECT_TARGET_SUBJECTS}</p>`; return; }
  el.querySelectorAll('.skill-note-row').forEach(row => {
    if (!checked.includes(row.dataset.project)) row.remove();
  });
  const present = new Set([...el.querySelectorAll('.skill-note-row')].map(r => r.dataset.project));
  const fresh = checked.filter(pid => !present.has(pid));
  if (fresh.length) {
    const names = Object.fromEntries((NONACADEMIC_PROJECTS || []).map(p => [p.id, p.name]));
    el.insertAdjacentHTML('beforeend', fresh.map(pid => `
      <div class="skill-note-row" data-project="${escHtml(pid)}">
        <label class="skill-note-label">${escHtml(names[pid] || pid)}</label>
        <textarea class="form-input skill-note-input" data-sn-project="${escHtml(pid)}" rows="2" placeholder="${TEXT.SKILL_NOTE_PLACEHOLDER}"></textarea>
      </div>`).join(''));
  }
  checked.forEach(pid => {
    const row = el.querySelector(`.skill-note-row[data-project="${pid}"]`);
    if (row) el.appendChild(row);
  });
}

export function collectSkillNotes() {
  return [...document.querySelectorAll('#d-skill-notes .skill-note-row')]
    .map(row => ({ project: row.dataset.project, note: row.querySelector('textarea').value.trim() }))
    .filter(sn => sn.note); // empty notes stay out of the payload
}

// edit prefill of skill textareas (traversal compare -- dirty legacy values can carry quotes/brackets)
export function prefillSkillNotes(notes) {
  const rows = [...document.querySelectorAll('#d-skill-notes .skill-note-row')];
  (notes || []).forEach(sn => {
    const row = rows.find(r => r.dataset.project === sn.project);
    const ta = row && row.querySelector('textarea');
    if (ta) ta.value = sn.note || '';
  });
}

// data-action adapter: tag-pick buttons carry data-container/data-max instead of inline onclick
export function toggleTagPickAction(el) {
  toggleTagPick(el, el.dataset.container, Number(el.dataset.max));
}

// ============================================================
// Demand wizard controller: 8 persistent pages (display-swap never unloads state) + stepper
// + per-page validation. JS only toggles classes and writes --dw-step-active; the slide
// transform lives in CSS. Back always visible except P1; last page's action is the submit button.
// Completion semantics: create-mode done = validated; edit-mode visited = flipped through.
// ============================================================
let _dwStep = 1;
let _dwEditMode = false;
const demandWizardDone = new Set();
const demandWizardVisited = new Set();

// Test hook: direct-import tests call initDemandForm/prefillDemandForm without openDemandModal, so
// the edit-mode flag leaks across tests otherwise (module-level state).
export function _wizardResetForTests() {
  _dwStep = 1;
  _dwEditMode = false;
  demandWizardDone.clear();
  demandWizardVisited.clear();
}

export function demandWizardGoTo(n) {
  const total = DEMAND_WIZARD_STEPS.length; // step-count single source (render.js)
  n = Math.max(1, Math.min(total, n | 0));
  _dwStep = n;
  const form = document.getElementById('demand-form');
  if (form) form.style.setProperty('--dw-step-active', String(n - 1)); // CSS translateX(calc(var * -100%))
  if (_dwEditMode) demandWizardVisited.add(n);
  document.querySelectorAll('#demand-form .dw-step').forEach(el => el.classList.toggle('dw-step--active', +el.dataset.step === n));
  // Stepper: done∪visited purple-fill (continuous prefix also lines the connector) + position caret.
  let prefix = 0;
  for (let s = 1; s <= total; s++) { if (demandWizardDone.has(s) || demandWizardVisited.has(s)) prefix = s; else break; }
  document.querySelectorAll('#dw-stepper .dw-step-chip').forEach(ch => {
    const s = +ch.dataset.step;
    const isDone = demandWizardDone.has(s) || demandWizardVisited.has(s);
    ch.classList.toggle('dw-step-chip--done', isDone);
    ch.classList.toggle('dw-step-chip--lined', s <= prefix);
    ch.classList.toggle('dw-step-chip--active', s === n);
  });
  const back = document.getElementById('dw-back');
  const next = document.getElementById('dw-next');
  const submit = document.getElementById('d-submit');
  if (back) back.classList.toggle('hidden', n === 1);
  if (next) next.classList.toggle('hidden', n === total);
  if (submit) {
    submit.classList.toggle('hidden', n !== total);
    // Non-last pages disable the submit button: display:none alone would still let Enter on a
    // text input fire the implicit submit and save a half-filled form.
    submit.disabled = n !== total;
  }
}

export function demandWizardNext() {
  if (demandWizardValidateStep(_dwStep)) {
    demandWizardDone.add(_dwStep); // validated page = done (create-mode completion)
    demandWizardGoTo(_dwStep + 1);
  }
}
export function demandWizardBack() { demandWizardGoTo(_dwStep - 1); }

// Per-page gate (form novalidate disables native validation; this is the only checkpoint).
export function demandWizardValidateStep(n) {
  const gid = id => document.getElementById(id);
  if (n === 1) {
    if (!gid('d-province') || !gid('d-province').value) { showToast(TEXT.VALIDATE_SELECT_PROVINCE, 'error'); return false; }
    return true; // address validation lives on P2 (method page, shanghai+offline only)
  }
  if (n === 2) {
    // T-6-F4: offline-allowed province (allowsOffline single source)
    const needAddr = SUFE_REGIONS.allowsOffline(gid('d-province').value) && gid('d-method').value === 'offline';
    if (needAddr && !gid('d-address').value.trim()) { showToast(TEXT.VALIDATE_ADDRESS_REQUIRED, 'error'); return false; }
    return true;
  }
  if (n === 3) {
    if (!gid('d-grade').value) { showToast(TEXT.VALIDATE_SELECT_GRADE, 'error'); return false; }
    return true;
  }
  if (n === 4) {
    const typeEl = gid('d-type-tabs') && gid('d-type-tabs').querySelector('.seg-tab.active');
    const type = (typeEl && typeEl.dataset.type) || DEMAND_TYPES.ACADEMIC;
    const sel = type === DEMAND_TYPES.NONACADEMIC ? '#d-nonacademic input:checked' : '#d-subjects input:checked';
    if (!document.querySelectorAll(sel).length) { showToast(TEXT.VALIDATE_SELECT_SUBJECT, 'error'); return false; }
    return true;
  }
  if (n === 7) {
    const ts = gid('d-time-slots');
    const timeErr = ts ? validateTimeSlots(ts) : '';
    if (timeErr) { showToast(timeErr, 'error'); return false; }
    const bMin = gid('d-budget-min'), bMax = gid('d-budget-max');
    if (bMin && bMax && bMin.value && bMax.value && +bMin.value > +bMax.value) {
      showToast(TEXT.VALIDATE_BUDGET_RANGE, 'error'); return false;
    }
    return true;
  }
  if (n === 8) {
    if (!gid('d-parent-contact').value.trim() || !gid('d-student-contact').value.trim()) {
      showToast(TEXT.VALIDATE_CONTACT_REQUIRED, 'error'); return false;
    }
    return true;
  }
  return true; // P2 (method has default) / P5 (scores optional) / P6 (teacher pref optional) pass through
}
