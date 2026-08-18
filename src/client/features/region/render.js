/**
 * region feature renderers: province/gaokao/address components.
 * Pure HTML builders (no inline handlers, no inline style).
 */
import { SUFE_REGIONS as R } from '../../constants/region-data.js';
import { SUBJECTS, STUDENT_GRADES } from '../../../shared/enums.js';
import { escHtml } from '../../core/dom.js';
import { checkboxItemsHtml, segTabsHtml } from '../../core/ui.js';
import { TEXT } from './text.js';

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

function gkVal(v) {
  return escHtml(v === undefined || v === null ? '' : String(v));
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


export function renderProvinceSelect(selectId, selectedId, changeAction) {
  const opts = R.provinces.map(p =>
    `<option value="${escHtml(p.id)}"${p.id === selectedId ? ' selected' : ''}>${escHtml(p.name)}</option>`
  ).join('');
  const change = changeAction ? ` data-region-change="${escHtml(changeAction)}"` : '';
  return `<select class="form-select" id="${escHtml(selectId)}"${change}>
    <option value="">${TEXT.OPTION_PLACEHOLDER}</option>${opts}
  </select>`;
}

export function regionLockNote(provinceId) {
  if (R && R.allowsOffline(provinceId)) return '';
  return `<p class="region-hint">${TEXT.REGION_HINT_OFFLINE_ONLY}</p>`;
}

export function teacherSubjectPool(provinceId) {
  const base = [...SUBJECTS];
  if (provinceId) {
    const pol = R.policyOf(provinceId);
    const extra = pol && pol.extraElective;
    if (extra && !base.some(s => s.id === extra)) {
      const nm = (R.subjectNames || {})[extra];
      base.push({ id: extra, name: nm || extra });
    }
  }
  return base;
}

export function gaokaoPolicyMismatchCount(pol, gaokaoList) {
  if (!pol || !Array.isArray(gaokaoList) || !gaokaoList.length) return 0;
  const gs = pol.gradeSystem;
  if (!gs || gs.type !== 'grade' || !gs.levels || !gs.levels.length) return 0;
  const ids = new Set(gs.levels.map(lv => lv.id));
  return gaokaoList.filter(x => x && x.grade != null && x.grade !== '' && !ids.has(x.grade)).length;
}



function gkMainSection(mainIds, exOf) {
  const names = R.subjectNames;
  let html = '<div class="gaokao-section">';
  if (!mainIds || !mainIds.length) {
    return html + `<p class="region-hint">${TEXT.REGION_HINT_FILL_MAIN}</p></div>`;
  }
  mainIds.forEach(sid => {
    const ex = exOf(sid);
    const max = R.subjectMaxScore[sid] || 150;
    html += `<div class="gaokao-row"><span class="subject-name">${escHtml(names[sid] || sid)}</span>
      <input type="number" class="score-inline" data-gk-subject="${escHtml(sid)}" data-gk-type="score"
        value="${gkVal(ex.score)}" placeholder="${TEXT.REGION_SCORE_PLACEHOLDER}" min="0" max="${max}">
      <span class="score-max">/ ${max}</span></div>`;
  });
  return html + '</div>';
}

export function renderTeacherGaokaoEditor(provinceId, graduationYear, existing) {
  const names = R.subjectNames;
  const list = Array.isArray(existing) ? existing : [];
  const exOf = sid => list.find(x => x && x.subject === sid) || {};
  const hasEx = sid => Object.keys(exOf(sid)).length > 0;
  const checked = new Set([...document.querySelectorAll('#profile-subjects input:checked')].map(cb => cb.value));

  if (!R.isValidProvince(provinceId)) {
    return `<p class="text-sm text-muted">${TEXT.REGION_HINT_PICK_PROVINCE}</p>`;
  }

  const pol = regionResolvePolicy(provinceId, graduationYear || undefined);
  let html = '';
  const mismatches = gaokaoPolicyMismatchCount(pol, list);
  if (mismatches > 0) {
    html += `<div class="gaokao-mismatch-warn glass">${escHtml(TEXT.GAOKAO_POLICY_MISMATCH_WARN.replace('{n}', mismatches))}</div>`;
  }

  html += gkMainSection(pol.main.filter(sid => checked.has(sid)), exOf);

  if (pol.type === '3+1+2') {
    const firstChecked = pol.first.filter(sid => checked.has(sid));
    const reChecked = pol.reassigned.filter(sid => checked.has(sid));
    const gs = pol.gradeSystem || R.gradeSystems.standard5;
    html += '<div class="gaokao-section">';
    if (!firstChecked.length && !reChecked.length) {
      html += `<p class="region-hint">${TEXT.REGION_HINT_FILL_ELECTIVE}</p>`;
    } else {
      if (firstChecked.length) {
        const firstSel = firstChecked.find(hasEx) || firstChecked[0];
        const firstEx = exOf(firstSel);
        html += `<div class="gaokao-row"><span class="subject-name">${TEXT.REGION_FIRST_SUBJECT_LABEL}${firstChecked.length > 1 ? TEXT.REGION_FIRST_TWO_HINT : ''}</span>
          <div class="gk-pill-group gk-first-pills" data-gk-role="first">
            ${firstChecked.map(sid => `<span class="grade-option gk-pill glass glass--solid ${sid === firstSel ? 'selected' : ''}"
              data-action="region.pickGkPill" data-gk-first="${escHtml(sid)}" role="button" tabindex="0">${escHtml(names[sid] || sid)}</span>`).join('')}
          </div>
          <input type="number" class="score-inline" data-gk-role="first-score" data-gk-type="score"
            value="${gkVal(firstEx.score)}" placeholder="${TEXT.REGION_SCORE_PLACEHOLDER}" min="0" max="100">
          <span class="score-max">/ 100</span>
        </div>`;
      }
      html += reChecked.map(sid => {
        const ex = exOf(sid);
        return `<div class="gaokao-row" data-gk-check-row="${escHtml(sid)}">
          <span class="subject-name">${escHtml(names[sid] || sid)}</span>
          <div class="grade-selector" data-gk-subject="${escHtml(sid)}">
            ${gs.levels.map(lv => `<span class="grade-option glass glass--solid ${ex.grade === lv.id ? 'selected' : ''}"
              data-action="region.pickGrade" data-grade="${escHtml(lv.id)}" role="button" tabindex="0">${escHtml(lv.name)}</span>`).join('')}
          </div></div>`;
      }).join('');
    }
    html += '</div>';
  } else if (pol.type === '3+3') {
    const electives = (pol.extraElective ? [...pol.electives, pol.extraElective] : [...pol.electives])
      .filter(sid => checked.has(sid));
    const gs = pol.gradeSystem;
    const isStandard = !!(gs && gs.type === 'standard');
    const usePills = !!(gs && gs.type === 'grade' && gs.levels.length <= 11);
    html += '<div class="gaokao-section">';
    if (!electives.length) {
      html += `<p class="region-hint">${TEXT.REGION_HINT_FILL_ELECTIVE}</p>`;
    } else {
      html += electives.map(sid => {
        const ex = exOf(sid);
        let ctl;
        if (isStandard) {
          const max = gs.max || 300;
          ctl = `<input type="number" class="score-inline" data-gk-subject="${escHtml(sid)}" data-gk-type="score"
            value="${gkVal(ex.score)}" placeholder="${TEXT.REGION_SCORE_PLACEHOLDER}" min="0" max="${max}">
            <span class="score-max">/ ${max}</span><span class="region-max-note">${TEXT.REGION_STANDARD_SCORE_NOTE}</span>`;
        } else if (usePills) {
          ctl = `<div class="grade-selector" data-gk-subject="${escHtml(sid)}">
            ${gs.levels.map(lv => `<span class="grade-option glass glass--solid ${ex.grade === lv.id ? 'selected' : ''}"
              data-action="region.pickGrade" data-grade="${escHtml(lv.id)}" role="button" tabindex="0">${escHtml(lv.name)}</span>`).join('')}
          </div>`;
        } else if (gs && gs.type === 'grade') {
          ctl = `<select class="form-select gk-grade-select" data-gk-subject="${escHtml(sid)}">
            <option value="">${TEXT.REGION_GRADE_PLACEHOLDER}</option>
            ${gs.levels.map(lv => `<option value="${escHtml(lv.id)}"${ex.grade === lv.id ? ' selected' : ''}>${escHtml(lv.name)}</option>`).join('')}
          </select>`;
        } else {
          ctl = `<input type="number" class="score-inline" data-gk-subject="${escHtml(sid)}" data-gk-type="score"
            value="${gkVal(ex.score)}" placeholder="${TEXT.REGION_SCORE_PLACEHOLDER}" min="0" max="100">
            <span class="score-max">/ 100</span>`;
        }
        return `<div class="gaokao-row" data-gk-check-row="${escHtml(sid)}">
          <span class="subject-name">${escHtml(names[sid] || sid)}</span>${ctl}</div>`;
      }).join('');
    }
    html += '</div>';
  } else {
    const tracks = pol.tracks || { science: [], arts: [] };
    const trackLabel = { science: TEXT.REGION_TRACK_SCIENCE, arts: TEXT.REGION_TRACK_ARTS };
    let curTrack = Object.keys(tracks).find(tk => (tracks[tk] || []).some(sid => checked.has(sid)))
      || Object.keys(tracks).find(tk => list.some(x => x && (tracks[tk] || []).includes(x.subject)))
      || Object.keys(tracks)[0] || '';
    html += `<div class="gaokao-section">
      <div class="gaokao-row">
        <div class="gk-pill-group gk-track-pills">
          ${Object.keys(tracks).map(tk => `<span class="grade-option gk-pill glass glass--solid ${tk === curTrack ? 'selected' : ''}"
            data-action="region.pickGkTrack" data-gk-track="${escHtml(tk)}" role="button" tabindex="0">${escHtml(trackLabel[tk] || tk)}</span>`).join('')}
        </div>
      </div>
      ${Object.keys(tracks).map(tk => (tracks[tk] || []).filter(sid => checked.has(sid)).map(sid => {
        const ex = exOf(sid);
        return `<div class="gaokao-row ${tk === curTrack ? '' : 'hidden'}" data-gk-track-row="${escHtml(tk)}">
          <span class="subject-name">${escHtml(names[sid] || sid)}</span>
          <input type="number" class="score-inline" data-gk-subject="${escHtml(sid)}" data-gk-type="score"
            value="${gkVal(ex.score)}" placeholder="${TEXT.REGION_SCORE_PLACEHOLDER}" min="0" max="100">
          <span class="score-max">/ 100</span></div>`;
      }).join('')).join('')}
    </div>`;
  }
  return html;
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
