/**
 * region feature actions: DOM mutations, collection and change handlers.
 * No inline handlers; used through data-action delegation or explicit calls.
 */
import { SUFE_REGIONS as R } from '../../constants/region-data.js';
import { TEXT } from '../../constants/text.js';
import { pickGrade } from '../../core/ui.js';
import { escHtml } from '../../core/dom.js';

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
