/**
 * teacher feature renderers: cards, profile panel, reviews, match detail.
 * No inline handlers or inline style attributes.
 */
import { CONFIG } from '../../../shared/config.js';
import { TEXT } from './text.js';
import { state } from '../../core/state.js';
import { escHtml, fmtDateTime, renderAvatarHtml } from '../../core/dom.js';
import { subjectNames, genderName, teacherGradeName, methodName, priceRangeText, ratingText, starsHtml, reviewStatusTagHtml } from '../../core/display.js';
import { matchDegree, matchDims, matchLevel, matchRowsHtml, matchNoteHtml } from '../../core/match.js';

export function renderTeacherCard(t, i) {
  const price = priceRangeText(t.price_min, t.price_max);
  return `<div class="list-card glass teacher-card" data-action="teacher.openProfile" data-id="${t.user_id}" data-reveal-index="${Math.min(i, 8)}">
    <div class="list-card-header">
      ${renderAvatarHtml(t.avatar, t.real_name || t.username, 'tc-avatar')}
      <span class="list-card-title">${escHtml(t.real_name || t.username)}</span>
      <span class="tag glass glass--solid">${starsHtml(t.rating)} ${ratingText(t.rating)}</span>
    </div>
    <div class="list-card-body">
      <span class="tag glass glass--solid">${escHtml(subjectNames(t.subjects))}</span>
      ${price ? `<span class="tag tag-warn glass glass--solid">${escHtml(price)}</span>` : ''}
      <span class="list-card-meta">${escHtml(t.school || '')}</span>
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
    <div class="profile-header"><span class="profile-name">${escHtml(p.real_name || p.username)}</span></div>`;
  for (const g of groups) {
    html += `<div class="profile-group"><p class="profile-group-title">${escHtml(g.title)}</p>`;
    for (const [k,v] of g.rows) {
      if (!v) continue;
      html += `<div class="profile-row"><span class="profile-label">${escHtml(k)}</span><span class="profile-value">${escHtml(String(v))}</span></div>`;
    }
    html += '</div>';
  }
  if (matched) html += `<div class="profile-match">${matched}</div>`;
  html += `<div class="profile-reviews" id="profile-reviews"></div><div class="profile-awards" id="profile-awards"></div>`;
  return html + '</div>';
}

export function renderProfileReviewsCard(r) {
  return `<div class="list-card glass review-card">
    <div class="list-card-header">
      <span class="list-card-title">${starsHtml(r.rating)} ${ratingText(r.rating)}</span>
      <span class="tag glass glass--solid ${reviewStatusTagHtml(r.status).cls}">${reviewStatusTagHtml(r.status).text}</span>
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

export function studentMatchDetailHtml(t, d) {
  const dims = matchDims(t, d);
  const degree = matchDegree(t, d);
  const level = matchLevel(degree);
  const rows = matchRowsHtml(dims);
  const note = matchNoteHtml(t, d, degree);
  return `<div class="match-detail">
    <p class="match-detail-title">${TEXT.MATCH_T_DEMAND_PREFIX}${degree}${TEXT.MATCH_T_PCT}</p>
    ${rows}
    ${note}
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
