/**
 * teacher feature renderers: cards, profile panel, reviews, match detail.
 * No inline handlers or inline style attributes.
 */
import { TEXT } from '../../constants/text.js';
import { ROLES, SUBJECTS, TEACHER_GRADES, GENDERS, TEACHING_METHODS, PERSONALITY_TAGS, NONACADEMIC_PROJECTS } from '../../../shared/enums.js'; // Z-16-F5: roles via shared enums; F1c: form whitelists
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
import { renderProvinceSelect } from '../region/render.js';
import { SUFE_REGIONS } from '../../../shared/region-data.js'; // contract 9: single source for province/subject pools

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
  const subjPool = [...SUBJECTS.map(s => s.id), ...Object.keys(SUFE_REGIONS.subjectNames || {})];
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
  const nonac = NONACADEMIC_PROJECTS.map(n => tagPickBtn(n.id, n.name, 'tp-nonacademic', 99, (p.nonacademic_projects || []).includes(n.id))).join('');

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
