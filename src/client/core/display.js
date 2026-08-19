/**
 * v2 display core: cross-domain generic data->text mappings (V-2-4b moved domain-specific
 * mappings into each feature's display module). Pure functions; user-visible text comes
 * from constants/text.js and shared enums single source. Feature display modules reuse
 * the cross-domain helpers here (enumName / subjectName / priceRangeText).
 */
import {
  SUBJECTS, GENDERS, TEACHING_METHODS, DEACTIVATED_USER_PREFIX,
  ROLES,
} from '../../shared/enums.js';
import { SUFE_REGIONS } from '../constants/region-data.js';
import { TEXT } from '../constants/text.js';
import { escHtml } from './dom.js';

/** enum id -> name lookup (cross-domain; feature display modules reuse it) */
export const enumName = (list, id, fallback) => {
  const hit = (list || []).find(x => x.id === id);
  return hit ? hit.name : fallback;
};

export function subjectName(sid) {
  const hit = enumName(SUBJECTS, sid, null);
  if (hit !== null) return hit;
  return (SUFE_REGIONS && SUFE_REGIONS.subjectNames && SUFE_REGIONS.subjectNames[sid]) || '';
}
export function subjectNames(ids) { return (ids || []).map(subjectName).filter(Boolean); }

export function genderName(id) {
  if (!id || id === 'undeclared' || id === 'nonbinary') return '';
  return enumName(GENDERS, id, '');
}
export function methodName(id) { return enumName(TEACHING_METHODS, id, ''); }

export function priceRangeText(min, max, unitSuffix) {
  const unit = unitSuffix || '';
  const hasMin = min != null && min !== '';
  const hasMax = max != null && max !== '';
  if (hasMin && hasMax) return min === max ? `${min}${unit}` : `${min}~${max}${unit}`;
  if (hasMin) return `${min}${unit}${TEXT.PRICE_FROM_SUFFIX}`;
  if (hasMax) return `${TEXT.PRICE_TO_PREFIX}${max}${unit}`;
  return '';
}

export function provinceName(code) {
  return (SUFE_REGIONS && code) ? SUFE_REGIONS.provinceName(code) : '';
}

export function roleLabel(role) {
  return role === ROLES.STUDENT ? TEXT.ROLE_STUDENT : role === ROLES.TEACHER ? TEXT.ROLE_TEACHER : TEXT.ADMIN_BADGE;
}

export function usernameHtml(name) {
  const s = String(name || '');
  return s.startsWith(DEACTIVATED_USER_PREFIX)
    ? `<span class="username-deactivated">${escHtml(s)}</span>` : escHtml(s);
}
export function isDeactivated(name) {
  return String(name || '').startsWith(DEACTIVATED_USER_PREFIX);
}
export function deactivatedTag(name) {
  return isDeactivated(name) ? `<span class="tag-deactivated">${escHtml(TEXT.PEER_DEACTIVATED_TAG)}</span>` : '';
}
