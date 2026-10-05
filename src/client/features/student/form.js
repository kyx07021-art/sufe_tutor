/**
 * demand create/edit form + 8-step wizard (extracted from actions.js — list/browse/push/
 * intent/match live in actions.js; markup in render.js). Form depends on list's loadMyDemands
 * for post-submit refresh; actions.js re-exports these for the delegation map + tests.
 */
import { TEXT } from '../../constants/text.js';
import { state } from '../../core/state.js';
import { api } from '../../core/api.js';
import { dhGet, invalidate } from '../../core/datahub.js';
import { openModal, closeModal, showToast, btnLoading, btnDone, confirm, toggleTagPick, initCustomSelects, syncCustomSelectText, applyTabBindings } from '../../core/ui.js';
import { escHtml } from '../../core/dom.js';
import { renderDemandModalHtml, DEMAND_WIZARD_STEPS } from './render.js';
import { buildStudentSubjectsHtml, buildStudentScoreRows, renderProvinceSelect, regionLockNote, gradeOptionsForProvince } from '../region/render.js';
import { mountShanghaiAddrPicker, switchScoreMode, pickGrade, collectStudentScores } from '../region/actions.js';
import { bindTimeSlotTree, validateTimeSlots, collectTimeSlots, prefillTimeSlots } from '../../core/ui-form.js';
import { SUFE_REGIONS } from '../../constants/region-data.js';
import { DEMAND_TYPES, NONACADEMIC_PROJECTS } from '../../../shared/enums.js';
import { loadMyDemands } from './actions.js';

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
  // Type-linked title (scores vs skills) + score/skill pane swap; non-academic clears score rows
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

// non-academic skill-state textareas follow the checked projects (incremental: keep typed rows)
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
// transform lives in CSS. Back always visible except ; last page's action is the submit button.
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
    return true; // address validation lives on (method page, shanghai+offline only)
  }
  if (n === 2) {
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
  return true; // (method has default) / (scores optional) / (teacher pref optional) pass through
}
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
// then land on . Direct DOM bindings (no inline handlers); idempotent via form.dataset.wizardBound.
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
    bindTimeSlotTree(form);      // time-slot add rows
  }
  onDemandProvinceChange(); // initial run: region note + lock online + grade options + subject pool
  toggleAddressField();     // address section visibility (shanghai+offline only)
  initCustomSelects(form);  // province/grade/gender/method/identity custom dropdowns (idempotent)
  demandWizardGoTo(1);      // always start from (edit prefill re-lands on at its end)
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
// Audit fix (): the "please pick subjects first" placeholder <p> must be REPLACED by the first
// batch of rows (v1 uses replaceWith) -- appending after it left the hint permanently on the page.
// row order realigns with the checkbox order (checked.forEach append).
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
// rebuilt/refilled manually. Ends back on so the user can walk the pages (visited completion).
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
  demandWizardGoTo(1); // edit always re-lands on (fields preserved across pages)
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

// v1 parity: address area -- visible + required only for shanghai+offline; any other combo hides
// and clears the value (so a stale address never rides into the payload). Mounts the district/unit
// picker on show, hydrating the hidden #d-address (idempotent rebuild).
export function toggleAddressField() {
  const section = document.getElementById('d-address-section');
  const addrInput = document.getElementById('d-address');
  if (!section || !addrInput) return;
  const prov = document.getElementById('d-province')?.value || '';
  const method = document.getElementById('d-method')?.value || '';
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
  // province-only checks would wrongly block offline-allowed+online submissions.
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
