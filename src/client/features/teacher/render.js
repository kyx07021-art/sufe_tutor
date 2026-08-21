/**
 * teacher feature renderers: cards, profile panel, reviews, match detail.
 * No inline handlers or inline style attributes.
 */
import { TEXT } from '../../constants/text.js';
import { ROLES, SUBJECTS, TEACHER_GRADES, GENDERS, TEACHING_METHODS, PERSONALITY_TAGS, NONACADEMIC_PROJECTS } from '../../../shared/enums.js'; // form whitelists
import { CONFIG, LIMITS } from '../../../shared/config.js';
import { state } from '../../core/state.js';
import { escHtml, fmtDateTime, renderAvatarHtml } from '../../core/dom.js';
import { subjectNames, genderName, methodName, priceRangeText, usernameHtml, deactivatedTag } from '../../core/display.js';
import { teacherGradeName, ratingText, starsHtml, reviewStatusMeta } from './display.js';
import { demandOptionText, expectedTimeText } from '../student/display.js';
import { matchDims, matchLevel, matchRowsHtml, matchNoteHtml } from '../../core/match.js';
import { renderPushBtn } from '../student/render.js'; // v1 parity (B4): student push button on teacher card
import { checkboxItemsHtml } from '../../core/ui.js';
import { renderTimeSlotContainerHtml } from '../../core/ui-form.js';
import { renderProvinceSelect, regionResolvePolicy } from '../region/render.js';
import { SUFE_REGIONS } from '../../constants/region-data.js'; // contract 9: province/subject pools single source (re-export entry)

let _studentOpenDemand = false;
export function setStudentOpenDemand(v) { _studentOpenDemand = !!v; }
export function studentOpenDemand() { return _studentOpenDemand; }

export function renderTeacherCard(t, i) {
  const isStudent = state.user && state.user.role === ROLES.STUDENT;
  const grade = teacherGradeName(t.grade) || t.grade || '';
  const subjectsLine = subjectNames(t.subjects).join('、');
  const priceNum = priceRangeText(t.price_min, t.price_max, '');
  const hasPrice = !!priceNum;
  const matchBtn = t._matchForStudent
    ? `<button type="button" class="tag-match match-btn match-btn--${matchLevel(t._matchForStudent.md)} glass glass--pressable" data-action="teacher.matchDetail" data-id="${t.user_id}" title="${TEXT.TAG_MATCH_TITLE}">${TEXT.TAG_MATCH}${t._matchForStudent.md}%${TEXT.TAG_MATCH_HINT}</button>`
    : (isStudent && !_studentOpenDemand ? `<span class="tc-match--hint">${escHtml(TEXT.TAG_MATCH_NO_DEMAND)}</span>` : '');
  return `<div class="list-card list-card--teacher glass" role="button" tabindex="0" aria-label="${TEXT.A11Y_VIEW_PROFILE}" data-action="teacher.openProfile" data-id="${t.user_id}" data-reveal-index="${Math.min(i || 0, 8)}">
    <div class="tc-head">
      ${renderAvatarHtml(t.avatar, t.username, 'tc-avatar')}
      <div class="tc-identity">
        <span class="tc-name tc-username">${escHtml(t.username)}${t.verified ? ` <span class="glass glass--solid" title="${TEXT.VERIFIED_TITLE}">${TEXT.VERIFIED_BADGE}</span>` : ''}${(t.award_count || 0) > 0 ? ` <span class="award-badge glass glass--solid" title="${TEXT.AWARD_SECTION_TITLE}">${TEXT.AWARD_COUNT_BADGE.replace('{n}', t.award_count)}</span>` : ''}</span>
        ${t.school || grade ? `<span class="tc-school">${escHtml([t.school, grade].filter(Boolean).join(' · '))}</span>` : ''}
      </div>
      <div class="tc-rating">${starsHtml(t.rating)}<span class="tc-rating-num">${ratingText(t.rating)}</span></div>
    </div>
    ${hasPrice ? `<div class="tc-price"><span class="tc-num tc-num--price">${escHtml(priceNum)}</span><span class="tc-unit">${escHtml(TEXT.PRICE_UNIT)}</span></div>` : ''}
    ${subjectsLine ? `<div class="tc-subjects">${escHtml(subjectsLine)}</div>` : ''}
    <div class="tc-bottom">
      <div class="tc-bottom-left">${t.intro ? `<div class="tc-intro">${escHtml(t.intro)}</div>` : ''}</div>
      <div class="tc-bottom-right">
        <div class="tc-actions">${matchBtn ? `<span class="tc-match">${matchBtn}</span>` : ''}${isStudent ? renderPushBtn(t) : ''}</div>
      </div>
    </div>
  </div>`;
}

export function renderProfilePanel(p, matched) {
  const groups = [
    { title: TEXT.PROFILE_SECTION_BASIC, rows: [
      [TEXT.LABEL_GENDER, genderName(p.gender)],
      [TEXT.LABEL_GRADE, teacherGradeName(p.grade)],
      [TEXT.LABEL_SCHOOL, p.school],
      [TEXT.LABEL_REAL_NAME, p.real_name],
      [TEXT.LABEL_GRADUATION_YEAR, p.graduation_year],
    ]},
    { title: TEXT.SECTION_SUBJECTS, rows: [
      [TEXT.LABEL_PRICE, priceRangeText(p.price_min, p.price_max)],
      [TEXT.LABEL_TEACHING_METHOD_PROFILE, methodName(p.teaching_method)],
      [TEXT.LABEL_TIME_SLOTS, expectedTimeText(p.time_slots)],
    ]},
  ];
  let html = `<div class="profile-panel">
    <div class="profile-header"><span class="profile-name">${escHtml(p.real_name || p.username)}${deactivatedTag(p.username)}</span></div>`;
  for (const g of groups) {
    html += `<div class="profile-group"><p class="profile-group-title">${escHtml(g.title)}</p>`;
    for (const [k,v] of g.rows) {
      if (!v) continue;
      html += `<div class="profile-row"><span class="profile-label">${escHtml(k)}</span><span class="profile-value">${escHtml(String(v))}</span></div>`;
    }
    html += '</div>';
  }
  if (matched) html += `<div class="profile-match">${matched}</div>`;
  // Z-10-F1: write-review entry gated by server-side `signed` (student has contracted this teacher).
  // The button's data-action passes no arg — openReviewModal keeps the module state set by openProfilePanel.
  if (p.signed) {
    html += `<div class="profile-review-entry"><button type="button" class="btn glass glass--pressable profile-review-btn" data-action="teacher.openReview">${TEXT.BTN_WRITE_REVIEW}</button></div>`;
  }
  html += `<div class="profile-reviews" id="profile-reviews"></div><div class="profile-awards" id="profile-awards"></div>`;
  return html + '</div>';
}

export function renderProfileReviewsCard(r) {
  const statusMeta = reviewStatusMeta(r.status);
  const statusTag = statusMeta ? `<span class="tag glass glass--solid ${statusMeta.cls}">${statusMeta.text}</span>` : '';
  return `<div class="list-card glass review-card">
    <div class="list-card-header">
      <span class="review-author">${usernameHtml(r.reviewer_name || '')}${deactivatedTag(r.reviewer_name)} ${starsHtml(r.rating)} ${ratingText(r.rating)}</span>
      ${statusTag}
    </div>
    ${r.comment ? `<div class="list-card-detail">${escHtml(r.comment)}</div>` : ''}
    <div class="list-card-meta">${fmtDateTime(r.created_at)}</div>
  </div>`;
}

export function renderProfileAwardsCard(a) {
  return `<div class="list-card glass award-card">
    <div class="list-card-header"><span class="list-card-title">${escHtml(a.title)}</span><span class="tag glass glass--solid">${escHtml(a.date || '')}</span></div>
    ${a.issuer ? `<div class="list-card-meta">${escHtml(a.issuer)}</div>` : ''}
  </div>`;
}

export function studentMatchDetailHtml(t) {
  const m = t._matchForStudent;
  if (!m) return '';
  const note = matchNoteHtml();
  const entries = m.items.map(({ d, md }) => {
    const head = `<div class="match-t-head"><b class="match-t-head-main">${TEXT.MATCH_T_BRACKET_L}${TEXT.MATCH_T_DEMAND_PREFIX}${escHtml(demandOptionText(d))} ${TEXT.MATCH_T_PCT}${md}%${TEXT.MATCH_T_BRACKET_R}</b></div>`;
    return `<div class="match-t-item glass glass--solid">${head}${matchRowsHtml(matchDims(t, d))}</div>`;
  }).join('');
  return `<div class="match-detail match-detail--teacher match-detail--${matchLevel(m.md)} glass glass--float" role="dialog" aria-label="${TEXT.MATCH_T_TITLE}">
    <div class="match-detail-head"><span class="match-detail-pct">${m.md}%</span><span class="match-detail-title">${TEXT.MATCH_T_TITLE}</span></div>
    <p class="match-detail-sub">${TEXT.MATCH_TEACHER_DETAIL_SUB}</p>
    <div class="match-t-list">${entries}</div>
    <p class="match-note">${note}</p>
  </div>`;
}

export function reviewModalHtml() {
  return `<div class="form-group">
    <label class="form-label">${TEXT.LABEL_RATING}</label>
    <div class="review-stars" id="review-stars">
      ${[1,2,3,4,5].map(n => `<button type="button" class="star glass glass--solid" data-action="teacher.setStars" data-rating="${n}">★</button>`).join('')}
    </div>
  </div>
  <div class="form-group">
    <label class="form-label">${TEXT.LABEL_REVIEW_CONTENT}</label>
    <textarea id="review-comment" class="form-input" rows="5" placeholder="${TEXT.REVIEW_COMMENT_PLACEHOLDER}"></textarea>
  </div>`;
}

// Z-3-F1 F1c: teacher profile edit form. Four sections matching the .profile-form
// style system (basic / academic / non-academic / private). Pure HTML — no inline
// handlers or styles; field ids are the F1d1/d2/d3 binding contract (tp-* prefix).
// profile may be null (no saved profile yet) → empty form with defaults. Every
// profile-derived value is escHtml'd before interpolating into attributes.
export function renderTeacherProfileForm(profile) {
  const p = profile || {};
  // F1d3: subjectNames is derived from SUBJECTS (plus region extras like ZJ technology), so the
  // pool must be deduped — otherwise math/english etc. render as duplicate checkboxes and the
  // collected subjects array repeats ids (server dedupes, but the UI shows duplicates).
  const subjPool = [...new Set([...SUBJECTS.map(s => s.id), ...Object.keys(SUFE_REGIONS.subjectNames || {})])];
  const subjOptions = subjPool.map(id => ({ id, name: SUFE_REGIONS.subjectNames[id] || subjectNames(id) }));
  const escNum = v => (v != null ? escHtml(String(v)) : '');
  const gradYear = p.graduation_year != null ? p.graduation_year : '';
  const methodId = TEACHING_METHODS.some(m => m.id === p.teaching_method) ? p.teaching_method : '';
  const grades = TEACHER_GRADES.map(g => `<option value="${escHtml(g.id)}"${g.id === p.grade ? ' selected' : ''}>${escHtml(g.name)}</option>`).join('');
  const genders = GENDERS.filter(g => g.id !== 'undeclared' && g.id !== 'nonbinary').map(g =>
    `<option value="${escHtml(g.id)}"${g.id === p.gender ? ' selected' : ''}>${escHtml(g.name)}</option>`).join('');
  const methods = TEACHING_METHODS.map(m => `<option value="${escHtml(m.id)}"${m.id === methodId ? ' selected' : ''}>${escHtml(m.name)}</option>`).join('');
  const tagPickBtn = (id, name, containerId, max, checked) =>
    `<button type="button" class="tag-pick glass glass--solid${checked ? ' selected' : ''}" data-action="teacher.toggleTagPick" data-container="${containerId}" data-max="${max}" data-id="${escHtml(id)}">${escHtml(name)}</button>`;
  const tags = PERSONALITY_TAGS.map(t => tagPickBtn(t.id, t.name, 'tp-personality', CONFIG.PERSONALITY_TAGS_MAX, (p.personality_tags || []).includes(t.id))).join('');
  // 0 = no cap: the server places no upper bound on nonacademic projects, so pass 0 to disable the max clamp.
  const nonac = NONACADEMIC_PROJECTS.map(n => tagPickBtn(n.id, n.name, 'tp-nonacademic', 0, (p.nonacademic_projects || []).includes(n.id))).join('');

  return `<form id="teacher-profile-form" class="profile-form" novalidate>
    <h3 class="profile-group-title">${TEXT.PROFILE_SECTION_BASIC}</h3>
    <div class="form-group">
      <label class="form-label">${TEXT.LABEL_PROVINCE} <span class="req">*</span></label>
      <span id="tp-province-wrap">${renderProvinceSelect('tp-province', p.province || '')}</span>
    </div>
    <div class="form-group">
      <label class="form-label">${TEXT.LABEL_GRADE} <span class="req">*</span></label>
      <select class="form-select" id="tp-grade"><option value="">${TEXT.OPTION_PLACEHOLDER}</option>${grades}</select>
    </div>
    <div class="form-group">
      <label class="form-label">${TEXT.LABEL_GENDER} <span class="req">*</span></label>
      <select class="form-select" id="tp-gender"><option value="">${TEXT.OPTION_PLACEHOLDER}</option>${genders}</select>
    </div>
    <div class="form-group">
      <label class="form-label">${TEXT.LABEL_SCHOOL}</label>
      <input type="text" class="form-input" id="tp-school" value="${escHtml(p.school || '')}" maxlength="${LIMITS.CONTACT_MAX}">
    </div>
    <div class="form-group">
      <label class="form-label">${TEXT.LABEL_REAL_NAME}</label>
      <input type="text" class="form-input" id="tp-real-name" value="${escHtml(p.real_name || '')}" maxlength="${LIMITS.CONTACT_MAX}">
    </div>
    <div class="form-group">
      <label class="form-label">${TEXT.LABEL_GRADUATION_YEAR}</label>
      <div class="range-row">
        <input type="number" class="form-input" id="tp-grad-year" value="${escNum(gradYear)}" min="${CONFIG.GRAD_YEAR_MIN}" max="${CONFIG.GRAD_YEAR_MAX}" placeholder="${TEXT.GRAD_YEAR_PLACEHOLDER}">
        <span class="text-muted">${TEXT.GRAD_YEAR_SUFFIX}</span>
      </div>
    </div>

    <h3 class="profile-group-title">${TEXT.PROFILE_SECTION_ACADEMIC}</h3>
    <div class="form-group">
      <label class="form-label">${TEXT.LABEL_SUBJECT} <span class="req">*</span>${TEXT.LABEL_MULTI_SUFFIX}</label>
      <div class="checkbox-grid" id="tp-subjects">${checkboxItemsHtml(subjOptions, p.subjects)}</div>
    </div>
    <div class="form-group">
      <label class="form-label">${TEXT.LABEL_PRICE_RANGE} <span class="req">*</span></label>
      <div class="range-row">
        <input type="number" class="form-input" id="tp-price-min" value="${escNum(p.price_min)}" min="0" step="1" placeholder="${TEXT.PLACEHOLDER_MIN}">
        <span class="text-muted">~</span>
        <input type="number" class="form-input" id="tp-price-max" value="${escNum(p.price_max)}" min="0" step="1" placeholder="${TEXT.PLACEHOLDER_MAX}">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">${TEXT.LABEL_TEACHING_METHOD_PROFILE} <span class="req">*</span></label>
      <select class="form-select" id="tp-method"><option value="">${TEXT.OPTION_PLACEHOLDER}</option>${methods}</select>
    </div>
    <div class="form-group">
      <label class="form-label">${TEXT.LABEL_TIME_SLOTS} <span class="req">*</span></label>
      <div id="tp-time-slots" class="time-slots">${renderTimeSlotContainerHtml()}</div>
    </div>
    <div class="form-group">
      <label class="form-label">${TEXT.LABEL_GAOKAO_SCORES}</label>
      <div id="tp-gaokao"><p class="text-sm text-muted">${TEXT.OPTION_PLACEHOLDER}</p></div>
    </div>
    <div class="form-group">
      <label class="form-label">${TEXT.LABEL_PERSONALITY_TAGS}${TEXT.PERSONALITY_TAGS_HINT.replace('{max}', CONFIG.PERSONALITY_TAGS_MAX)}</label>
      <div id="tp-personality">${tags}</div>
    </div>

    <h3 class="profile-group-title">${TEXT.PROFILE_SECTION_NONACADEMIC}</h3>
    <div class="form-group">
      <label class="form-label">${TEXT.LABEL_NONACADEMIC_PROJECTS}${TEXT.LABEL_MULTI_SUFFIX}</label>
      <div id="tp-nonacademic">${nonac}</div>
    </div>
    <div class="form-group">
      <label class="form-label">${TEXT.LABEL_NONACADEMIC_PRICES}</label>
      <div id="tp-nonacademic-prices"><p class="text-sm text-muted">${TEXT.OPTION_PLACEHOLDER}</p></div>
    </div>

    <h3 class="profile-group-title">${TEXT.PROFILE_SECTION_PRIVATE}</h3>
    <div class="form-group">
      <label class="form-label">${TEXT.LABEL_INTRO}</label>
      <textarea id="tp-intro" class="form-input" rows="4">${escHtml(p.intro || '')}</textarea>
    </div>
    <div class="form-group">
      <label class="form-label">${TEXT.LABEL_ADDRESS}</label>
      <div id="tp-addr-picker" class="sh-addr-picker"></div>
      <input type="hidden" id="tp-address" value="${escHtml(p.address || '')}">
    </div>
    <div class="form-group">
      <label class="form-label">${TEXT.LABEL_WECHAT}</label>
      <input type="text" class="form-input" id="tp-wechat" value="${escHtml(p.wechat || '')}" maxlength="${LIMITS.CONTACT_MAX}">
    </div>
    <div class="form-group">
      <label class="form-label">${TEXT.LABEL_EMAIL}</label>
      <input type="text" class="form-input" id="tp-email" value="${escHtml(p.email || '')}" maxlength="${LIMITS.CONTACT_MAX}">
    </div>
    <div class="form-actions">
      <button type="button" class="btn glass glass--pressable" data-action="teacher.saveProfile">${TEXT.BTN_SAVE}</button>
    </div>
  </form>`;
}

// Z-3-F1 F1d2: teacher gaokao score editor. Policy-driven (regionResolvePolicy + SUFE_REGIONS):
// main subjects use raw scores, electives use grade conversion for grade systems,
// raw scores for standard systems (Hainan 300). The collected shape matches the server contract
// (server/domains/teacher/api.js sanitize): [{subject, score?} | {subject, grade?}], subject
// whitelist incl. ZJ technology, score clamped [0, GAOKAO_SCORE_MAX], grade whitelist union.
// Pure HTML — no inline handlers/styles; pills use data-action delegation (teacher.pickGkPill /
// teacher.pickGkTrack / region.pickGrade). Reads the live checked subjects from #tp-subjects.
function gkVal(v) {
  return v === undefined || v === null || v === '' ? '' : escHtml(String(v));
}

// Count saved grades that the current policy's grade system does not offer (province/year switch
// leaves stale grade-tier values — warn instead of silently dropping on save).
export function gaokaoPolicyMismatchCount(pol, gaokaoList) {
  if (!pol || !Array.isArray(gaokaoList) || !gaokaoList.length) return 0;
  const gs = pol.gradeSystem;
  if (!gs || gs.type !== 'grade' || !gs.levels || !gs.levels.length) return 0;
  const ids = new Set(gs.levels.map(lv => lv.id));
  return gaokaoList.filter(x => x && x.grade != null && x.grade !== '' && !ids.has(x.grade)).length;
}

function gkMainSection(mainIds, exOf) {
  const names = SUFE_REGIONS.subjectNames;
  let html = '<div class="gaokao-section">';
  if (!mainIds || !mainIds.length) return html + `<p class="region-hint">${TEXT.REGION_HINT_FILL_MAIN}</p></div>`;
  mainIds.forEach(sid => {
    const ex = exOf(sid);
    const max = SUFE_REGIONS.subjectMaxScore[sid] || 150;
    html += `<div class="gaokao-row"><span class="subject-name">${escHtml(names[sid] || sid)}</span>
      <input type="number" class="score-inline" data-gk-subject="${escHtml(sid)}" data-gk-type="score"
        value="${gkVal(ex.score)}" placeholder="${TEXT.REGION_SCORE_PLACEHOLDER}" min="0" max="${max}">
      <span class="score-max">/ ${max}</span></div>`;
  });
  return html + '</div>';
}

export function renderTeacherGaokaoEditor(provinceId, graduationYear, existing) {
  const R = SUFE_REGIONS;
  const names = R.subjectNames;
  const list = Array.isArray(existing) ? existing : [];
  const exOf = sid => list.find(x => x && x.subject === sid) || {};
  const hasEx = sid => Object.keys(exOf(sid)).length > 0;
  const checked = new Set([...document.querySelectorAll('#tp-subjects input:checked')].map(cb => cb.value));
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
        html += `<div class="gaokao-row"><span class="subject-name">${escHtml(TEXT.REGION_FIRST_SUBJECT_LABEL)}${firstChecked.length > 1 ? escHtml(TEXT.REGION_FIRST_TWO_HINT) : ''}</span>
          <div class="gk-pill-group gk-first-pills" data-gk-role="first">
            ${firstChecked.map(sid => `<span class="grade-option gk-pill glass glass--solid ${sid === firstSel ? 'selected' : ''}"
              data-action="teacher.pickGkPill" data-gk-first="${escHtml(sid)}" role="button" tabindex="0">${escHtml(names[sid] || sid)}</span>`).join('')}
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
            <span class="score-max">/ ${max}</span><span class="region-max-note">${escHtml(TEXT.REGION_STANDARD_SCORE_NOTE)}</span>`;
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
            data-action="teacher.pickGkTrack" data-gk-track="${escHtml(tk)}" role="button" tabindex="0">${escHtml(trackLabel[tk] || tk)}</span>`).join('')}
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

// Z-3-F1 F1e: teacher verification block (CHSI code / admission letter). Four states from
// GET /api/teacher/verify-status: none (not submitted) → submission channels; pending → channel-specific
// waiting copy; approved → gate-open hint; rejected → status tag + re-submission channels.
// Pure HTML — no inline handlers/styles; toggles/submits use data-action delegation.
function verifyChsiPaneHtml() {
  return `<div class="verify-pane" id="verify-chsi-pane">
    <p class="text-sm text-muted">${escHtml(TEXT.CHSI_GATE_HINT)}</p>
    <ul class="verify-steps">${(TEXT.CHSI_GATE_STEPS || []).map(s => `<li class="text-sm">${escHtml(s)}</li>`).join('')}</ul>
    <div class="form-group">
      <input type="text" class="form-input" id="verify-chsi-code" maxlength="16" autocomplete="off" placeholder="${escHtml(TEXT.CHSI_GATE_PLACEHOLDER)}">
    </div>
    <div class="form-actions">
      <button type="button" class="btn glass glass--pressable" data-action="teacher.submitVerifyChsi">${escHtml(TEXT.CHSI_GATE_SUBMIT)}</button>
    </div>
    <button type="button" class="btn btn-soft glass glass--pressable" data-action="teacher.showVerifyAdmission">${escHtml(TEXT.ADMISSION_SWITCH_LINK)}</button>
  </div>`;
}

function verifyAdmissionPaneHtml() {
  return `<div class="verify-pane hidden" id="verify-admission-pane">
    <p class="text-sm text-muted">${escHtml(TEXT.ADMISSION_SHOOT_HINT)}</p>
    <p class="text-sm text-muted">${escHtml(TEXT.ADMISSION_PRIVACY_NOTE)}</p>
    <div class="form-group">
      <label class="btn btn-soft glass glass--pressable" for="verify-admission-file">${escHtml(TEXT.ADMISSION_UPLOAD_BTN)}</label>
      <input type="file" id="verify-admission-file" class="sr-file-input" accept="image/jpeg,image/png,image/webp" data-action="teacher.stageAdmission">
    </div>
    <div class="verify-admission-preview hidden" id="verify-admission-preview"></div>
    <div class="form-actions">
      <button type="button" class="btn glass glass--pressable" data-action="teacher.submitVerifyAdmission">${escHtml(TEXT.ADMISSION_SUBMIT)}</button>
    </div>
    <button type="button" class="btn btn-soft glass glass--pressable" data-action="teacher.showVerifyChsi">${escHtml(TEXT.ADMISSION_GATE_BACK)}</button>
  </div>`;
}

export function renderTeacherVerifySection(vs) {
  const st = (vs && vs.status) || 'none';
  const statusMap = { none: TEXT.VERIF_NONE, pending: TEXT.VERIF_PENDING, approved: TEXT.VERIF_APPROVED, rejected: TEXT.VERIF_REJECTED };
  const tag = statusMap[st] || TEXT.VERIF_NONE;
  let html = `<section class="verify-block glass" id="teacher-verify">
    <h3 class="profile-group-title">${escHtml(TEXT.CHSI_GATE_TITLE)}</h3>
    <div class="verify-status-row"><span class="tag glass glass--solid">${escHtml(tag)}</span></div>`;
  if (st === 'approved') {
    html += `<p class="text-sm text-muted">${escHtml(TEXT.CHSI_GATE_HINT)}</p>`;
  } else if (st === 'pending') {
    html += `<p class="text-sm text-muted">${escHtml(vs && vs.verify_type === 'admission' ? TEXT.ADMISSION_GATE_PENDING : TEXT.CHSI_GATE_PENDING)}</p>`;
  } else {
    // none / rejected: both submission channels (chsi default, admission via switch link)
    html += verifyChsiPaneHtml() + verifyAdmissionPaneHtml();
  }
  return html + '</section>';
}
