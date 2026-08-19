/**
 * teacher feature renderers: cards, profile panel, reviews, match detail.
 * No inline handlers or inline style attributes.
 */
import { TEXT } from '../../constants/text.js';
import { ROLES } from '../../../shared/enums.js'; // Z-16-F5: roles via shared enums
import { state } from '../../core/state.js';
import { escHtml, fmtDateTime, renderAvatarHtml } from '../../core/dom.js';
import { subjectNames, genderName, methodName, priceRangeText, usernameHtml, deactivatedTag } from '../../core/display.js';
import { teacherGradeName, ratingText, starsHtml, reviewStatusMeta } from './display.js';
import { demandOptionText } from '../student/display.js';
import { matchDims, matchLevel, matchRowsHtml, matchNoteHtml } from '../../core/match.js';
import { renderPushBtn } from '../student/render.js'; // v1 parity (B4): student push button on teacher card

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
      [TEXT.LABEL_TIME_SLOTS, p.time_slots],
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
