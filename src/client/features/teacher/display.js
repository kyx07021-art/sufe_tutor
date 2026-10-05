/**
 * teacher domain display mappings.
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

/** Review moderation status -> {text, cls} meta (contractStatusMeta-style shape);
 *  unknown status -> null (caller skips the tag). */
export function reviewStatusMeta(status) {
  if (status === STATUS.APPROVED) return { text: TEXT.STATUS_APPROVED, cls: 'tag-ok' };
  if (status === STATUS.REJECTED) return { text: TEXT.STATUS_REJECTED, cls: 'tag-danger' };
  if (status === STATUS.PENDING) return { text: TEXT.STATUS_PENDING, cls: 'tag-warn' };
  return null;
}
