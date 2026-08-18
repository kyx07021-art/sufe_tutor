/**
 * teacher domain display mappings (V-2-4b: moved out of core/display.js).
 * Pure functions; text from constants/text.js + shared enums single source only.
 * Rating/stars/grade/review-status are teacher-profile display attrs, reused by
 * teacher and student (teacher card) features.
 */
import { TEACHER_GRADES, STATUS } from '../../../shared/enums.js';
import { TEXT } from '../../constants/text.js';
import { enumName } from '../../core/display.js';

export function teacherGradeName(id) { return enumName(TEACHER_GRADES, id, ''); }

export function starsHtml(rating) {
  const r = rating || 4.5;
  let html = '<span class="stars">';
  for (let i = 1; i <= 5; i++) {
    html += `<span class="star ${i <= Math.round(r) ? 'filled' : ''}">★</span>`;
  }
  return html + '</span>';
}
export function ratingText(rating) { return (rating || 4.5).toFixed(1); }

export function reviewStatusTagHtml(status) {
  if (status === STATUS.APPROVED) return `<span class="tag tag-ok">${TEXT.STATUS_APPROVED}</span>`;
  if (status === STATUS.REJECTED) return `<span class="tag tag-danger">${TEXT.STATUS_REJECTED}</span>`;
  if (status === STATUS.PENDING) return `<span class="tag tag-warn">${TEXT.STATUS_PENDING}</span>`;
  return '';
}
