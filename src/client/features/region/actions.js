/**
 * region feature actions: DOM mutations, collection and change handlers.
 * No inline handlers; used through data-action delegation or explicit calls.
 */
import { CONFIG } from '../../../shared/config.js';
import { SUFE_REGIONS as R } from '../../constants/region-data.js';
import { TEXT } from './text.js';
import { checkboxItemsHtml, initCustomSelects, pickGrade } from '../../core/ui.js';
import { escHtml } from '../../core/dom.js';
import { renderTeacherGaokaoEditor, teacherSubjectPool } from './render.js';

export function currentGradYear() {
  if (typeof document === 'undefined') return undefined;
  const el = document.getElementById('profile-graduation-year');
  if (!el) return undefined;
  const v = String(el.value).trim();
  if (!/^\d{4}$/.test(v)) return undefined;
  const min = CONFIG.GRAD_YEAR_MIN != null ? CONFIG.GRAD_YEAR_MIN : 1980;
  const max = CONFIG.GRAD_YEAR_MAX != null ? CONFIG.GRAD_YEAR_MAX : 2030;
  return Math.min(max, Math.max(min, +v));
}

export function rebuildTeacherSubjects(provinceId) {
  const el = document.getElementById('profile-subjects');
  if (!el) return;
  const checked = [...el.querySelectorAll('input:checked')].map(cb => cb.value);
  el.innerHTML = checkboxItemsHtml(teacherSubjectPool(provinceId), checked);
}

export function onTeacherProvinceChange(provinceId) {
  const sel = document.getElementById('profile-province');
  const el = document.getElementById('profile-gaokao-scores');
  const pid = provinceId != null ? provinceId : (sel ? sel.value : '');
  if (!el) return;
  rebuildTeacherSubjects(pid);
  el.innerHTML = renderTeacherGaokaoEditor(pid, currentGradYear(), []);
  if (typeof initCustomSelects === 'function') initCustomSelects(el);
}

export function onTeacherSubjectsChange() {
  const sel = document.getElementById('profile-province');
  const el = document.getElementById('profile-gaokao-scores');
  if (!el) return;
  const existing = collectTeacherGaokao();
  el.innerHTML = renderTeacherGaokaoEditor(sel ? sel.value : '', currentGradYear(), existing);
  if (typeof initCustomSelects === 'function') initCustomSelects(el);
}

export function onTeacherGradYearChange() {
  onTeacherSubjectsChange();
}

export function pickGkPill(el) {
  const group = el.closest('.gk-pill-group');
  if (!group) return;
  group.querySelectorAll('.gk-pill').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
}

export function pickGkTrack(el) {
  pickGkPill(el);
  const root = document.getElementById('profile-gaokao-scores');
  if (!root) return;
  root.querySelectorAll('[data-gk-track-row]').forEach(row => {
    row.classList.toggle('hidden', row.dataset.gkTrackRow !== el.dataset.gkTrack);
  });
}

export function switchScoreMode(btn) {
  const row = btn && btn.closest ? btn.closest('.score-row') : null;
  if (!row) return;
  row.querySelectorAll('.seg-tab').forEach(t => t.classList.toggle('active', t === btn));
  row.querySelectorAll('.score-mode-pane').forEach(p => p.classList.toggle('hidden', p.dataset.mode !== btn.dataset.mode));
}

export function onScoreTabChange(e) {
  const tabs = e && e.detail && e.detail.container;
  if (!tabs) return;
  const row = tabs.closest('.score-row');
  if (!row) return;
  const key = e.detail.key;
  row.querySelectorAll('.score-mode-pane').forEach(p => p.classList.toggle('hidden', p.dataset.mode !== key));
}

export function mountShanghaiAddrPicker(prefix, selected, { onDistChange, hiddenId } = {}) {
  if (typeof document === 'undefined') return;
  const host = document.getElementById(prefix + '-addr-picker');
  if (!host) return;
  const hidId = hiddenId || (prefix + '-addr');
  const parsed = R && R.parseShanghaiAddr(selected);
  const distOpts = R.shanghaiDistricts.map(d =>
    `<option value="${escHtml(d.id)}"${parsed && d.id === parsed.districtId ? ' selected' : ''}>${escHtml(d.name)}</option>`).join('');
  const unitOpts = (parsed ? (R.shanghaiDistrictById(parsed.districtId).units || []) : [])
    .map(u => `<option value="${escHtml(u)}"${parsed && u === parsed.unit ? ' selected' : ''}>${escHtml(u)}</option>`).join('');
  host.innerHTML = `<select class="form-select sh-addr-district" id="${prefix}-district">
      <option value="">${TEXT.OPTION_PLACEHOLDER}</option>${distOpts}
    </select>
    <select class="form-select sh-addr-unit" id="${prefix}-unit"${parsed ? '' : ' disabled'}>
      <option value="">${parsed ? TEXT.OPTION_PLACEHOLDER : TEXT.SH_ADDR_SELECT_DISTRICT_FIRST}</option>${unitOpts}
    </select>`;
  const hidden = document.getElementById(hidId);
  if (hidden) hidden.value = selected || '';
  const dSel = document.getElementById(prefix + '-district');
  const uSel = document.getElementById(prefix + '-unit');
  dSel.addEventListener('change', () => {
    syncShanghaiAddrPicker(prefix, hidId);
    if (typeof onDistChange === 'function') onDistChange();
  });
  uSel.addEventListener('change', () => syncShanghaiAddrPicker(prefix, hidId));
  syncShanghaiAddrPicker(prefix, hidId);
}

export function syncShanghaiAddrPicker(prefix, hiddenId) {
  if (typeof document === 'undefined') return;
  const dSel = document.getElementById(prefix + '-district');
  const uSel = document.getElementById(prefix + '-unit');
  const h = document.getElementById(hiddenId || (prefix + '-addr'));
  if (!dSel || !uSel || !h) return;
  const d = dSel.value ? R.shanghaiDistrictById(dSel.value) : null;
  const prevUnit = uSel.value;
  if (d) {
    uSel.disabled = false;
    uSel.innerHTML = `<option value="">${TEXT.OPTION_PLACEHOLDER}</option>`
      + d.units.map(u => `<option value="${escHtml(u)}">${escHtml(u)}</option>`).join('');
    if (prevUnit && d.units.includes(prevUnit)) uSel.value = prevUnit;
  } else {
    uSel.disabled = true;
    uSel.value = '';
    uSel.innerHTML = `<option value="">${TEXT.SH_ADDR_SELECT_DISTRICT_FIRST}</option>`;
  }
  h.value = d && uSel.value ? R.buildShanghaiAddr(d.id, uSel.value) : '';
}

export function collectTeacherGaokao() {
  const root = document.getElementById('profile-gaokao-scores');
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

export function collectStudentScores() {
  const root = document.getElementById('d-scores');
  const out = [];
  if (!root) return out;
  root.querySelectorAll('.region-score-row').forEach(row => {
    const sid = row.dataset.scoreSubject;
    const activeTab = row.querySelector('.seg-tab.active');
    const mode = activeTab ? activeTab.dataset.mode : 'score';
    if (mode === 'grade') {
      const sel = row.querySelector('.grade-option.selected');
      out.push({ subject: sid, mode: 'grade', scale: 0, score: '', grade: sel ? sel.dataset.grade : '' });
    } else {
      const inp = row.querySelector('input[data-sg-subject]');
      out.push({ subject: sid, mode: 'score', scale: inp ? +inp.dataset.scoreMax : 100, score: inp ? inp.value : '' });
    }
  });
  return out;
}

export { pickGrade };
