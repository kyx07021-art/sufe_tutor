/**
 * region feature renderers: province/gaokao/address components.
 * Pure HTML builders (no inline handlers, no inline style).
 */
import { SUFE_REGIONS as R } from '../../constants/region-data.js';
import { STUDENT_GRADES } from '../../../shared/enums.js';
import { escHtml } from '../../core/dom.js';
import { checkboxItemsHtml, segTabsHtml } from '../../core/ui.js';
import { TEXT } from '../../constants/text.js';

// M3: grade options follow the region's school system -- five-four (Shanghai) has no primary-6 and
// maps grade 6 to prep class; default six-three keeps primary-6 and drops prep.
export function gradeOptionsForProvince(provinceId) {
  const fiveFour = R.isFiveFour(provinceId);
  return STUDENT_GRADES.filter(g => {
    if (g.id === 'prep') return !!fiveFour;
    if (g.id === 'p6') return !fiveFour;
    return true;
  });
}

export function regionResolvePolicy(provinceId, year) {
  const pol = R.policyOf(provinceId, year);
  if (pol && pol.type) return pol;
  return {
    ...R.policies['3+1+2'],
    type: '3+1+2',
    gradeSystem: R.gradeSystems.standard5,
    gradeSystemId: 'standard5',
    extraElective: null,
  };
}


export function renderProvinceSelect(selectId, selectedId) { // Q-4b-L2: removed inert changeAction param (data-region-change was never consumed; callers bind change directly)
  const opts = R.provinces.map(p =>
    `<option value="${escHtml(p.id)}"${p.id === selectedId ? ' selected' : ''}>${escHtml(p.name)}</option>`
  ).join('');
  return `<select class="form-select" id="${escHtml(selectId)}">
    <option value="">${TEXT.OPTION_PLACEHOLDER}</option>${opts}
  </select>`;
}

export function regionLockNote(provinceId) {
  if (R && R.allowsOffline(provinceId)) return '';
  return `<p class="region-hint">${TEXT.REGION_HINT_OFFLINE_ONLY}</p>`;
}

export function buildStudentSubjectsHtml(provinceId, gradeId) {
  if (!gradeId) return `<p class="text-sm text-muted">${TEXT.REGION_HINT_PICK_GRADE}</p>`;
  const ids = R.subjectsFor(provinceId, gradeId);
  if (!ids || !ids.length) return `<p class="text-sm text-muted">${TEXT.REGION_HINT_NO_SUBJECTS}</p>`;
  return checkboxItemsHtml(ids.map(sid => ({ id: sid, name: R.subjectNames[sid] || sid })));
}

export function buildStudentScoreRows(provinceId, gradeId, subjectIds) {
  const ids = (Array.isArray(subjectIds) ? subjectIds : []).filter(Boolean);
  if (!ids.length) return `<p class="text-sm text-muted">${TEXT.REGION_HINT_PICK_SUBJECTS}</p>`;
  const levels = R.gradeLevelsFor(provinceId, gradeId);
  const stage = R.stageOfGrade(gradeId);
  const pol = regionResolvePolicy(provinceId);
  const shMax = (stage === 'senior' && pol.gradeSystem && pol.gradeSystem.type === 'grade' && pol.gradeSystem.max) || null;
  return ids.map(sid => {
    const sidE = escHtml(sid);
    const name = R.subjectNames[sid] || sid;
    const base = R.subjectMaxFor(provinceId, sid, gradeId);
    const max = (base !== 150 && shMax) ? shMax : base;
    const inputPane = `<input type="number" class="score-inline" data-sg-subject="${sidE}"
        data-score-max="${max}" placeholder="${TEXT.REGION_SCORE_PLACEHOLDER}" min="0" max="${max}">
      <span class="score-max">/ ${max}</span>${shMax && base !== 150 ? `<span class="region-max-note">${TEXT.REGION_SH_ELECTIVE_MAX_NOTE}</span>` : ''}`;
    if (R.policies['3+1+2'].main.includes(sid)) {
      return `<div class="score-row region-score-row" data-score-subject="${sidE}">
        <span class="score-subject">${escHtml(name)}</span>${inputPane}
      </div>`;
    }
    if (!levels || !levels.length) {
      return `<div class="score-row region-score-row" data-score-subject="${sidE}">
        <span class="score-subject">${escHtml(name)}</span>${inputPane}
      </div>`;
    }
    return `<div class="score-row region-score-row" data-score-subject="${sidE}">
      <span class="score-subject">${escHtml(name)}</span>
      ${segTabsHtml([
        { key: 'grade', label: TEXT.REGION_TAB_GRADE },
        { key: 'score', label: TEXT.REGION_TAB_SCORE },
      ], 'grade', { containerClass: 'seg-tabs--score', attr: 'mode' })}
      <div class="score-mode-pane" data-mode="grade">
        <div class="grade-selector" data-sg-subject="${sidE}">
          ${levels.map(lv => `<span class="grade-option glass glass--solid" data-action="region.pickGrade" data-grade="${escHtml(lv.id)}" role="button" tabindex="0">${escHtml(lv.name)}</span>`).join('')}
        </div>
      </div>
      <div class="score-mode-pane hidden" data-mode="score">${inputPane}
      </div>
    </div>`;
  }).join('');
}
