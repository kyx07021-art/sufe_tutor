/**
 * student/demand domain display mappings.
 * Pure functions; text from constants/text.js + shared enums single source only.
 * Cross-domain helpers come from core/display.js (subjectName / priceRangeText).
 */
import { CONFIG } from '../../../shared/config.js';
import {
  DEMAND_TYPES, NONACADEMIC_PROJECTS, STUDENT_GRADES, STATUS, WEEKDAYS,
} from '../../../shared/enums.js';
import { TEXT } from '../../constants/text.js';
import { subjectName, priceRangeText, enumName } from '../../core/display.js';

export function demandTargetName(id, type) {
  if (type === DEMAND_TYPES.NONACADEMIC) return enumName(NONACADEMIC_PROJECTS, id, '');
  return subjectName(id);
}
export function demandTargetNameList(ids, type) {
  return (ids || []).map(id => demandTargetName(id, type)).filter(Boolean);
}
export function demandTargetNames(ids, type) {
  return demandTargetNameList(ids, type).join(TEXT.LIST_SEP);
}

export function demandIsActive(d) {
  const status = typeof d === 'string' ? d : (d && d.status);
  return status === STATUS.OPEN;
}

export function demandOptionText(d) {
  const id = String(d.display_id || d.id).padStart(CONFIG.DISPLAY_ID_PAD || 4, '0');
  const name = demandTargetNames(d.target_subjects, d.target_type) || TEXT.EMPTY_DASH;
  const hasBudget = (d.budget_min > 0) || (d.budget_max > 0);
  const price = hasBudget ? priceRangeText(d.budget_min, d.budget_max, TEXT.PRICE_UNIT) : '';
  return ['#' + id, name, price].filter(Boolean).join(' · ');
}

export function expectedTimeText(raw) {
  if (!raw) return '';
  // T-6-F3: teacher time_slots now arrives parsed (safeJsonArray output); string JSON retained
  // for demand expected_time.
  let arr = Array.isArray(raw) ? raw : null;
  if (!arr) {
    try { const p = JSON.parse(raw); if (Array.isArray(p)) arr = p; } catch { arr = null; }
  }
  if (!arr) return String(raw);
  const texts = arr
    .filter(s => s && typeof s === 'object' && s.type === 'week')
    .map(s => {
      const day = (WEEKDAYS.find(d => d.id === s.dow) || {}).name || '';
      const range = (typeof s.start === 'string' && typeof s.end === 'string') ? `${s.start}-${s.end}` : '';
      return [day, range].filter(Boolean).join(' ');
    }).filter(Boolean);
  return texts.join(TEXT.LIST_SEP);
}

export function studentGradeName(id) {
  if (!id) return '';
  return enumName(STUDENT_GRADES, id, '');
}

export function demandIdText(displayId) {
  const n = Number(displayId);
  return n ? `${TEXT.DEMAND_PREFIX}#${String(n).padStart(CONFIG.DISPLAY_ID_PAD || 4, '0')}` : '';
}
