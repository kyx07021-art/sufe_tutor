/**
 * v2 display core: parity migration of app-display.js D methods.
 * Pure functions; user-visible text comes from constants/text.js and shared enums.
 */
import { CONFIG } from '../../shared/config.js';
import {
  SUBJECTS, STUDENT_GRADES, TEACHER_GRADES, GENDERS, TEACHING_METHODS,
  WEEKDAYS, PERSONALITY_TAGS, NONACADEMIC_PROJECTS, TEACHING_GOALS,
  DEMAND_TYPES, STATUS, DEACTIVATED_USER_PREFIX,
} from '../../shared/enums.js';
import { SUFE_REGIONS } from '../constants/region-data.js';
import { TEXT } from '../constants/text.js';
import { escHtml } from './dom.js';

const enumName = (list, id, fallback) => {
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
export function demandStudentGenderName(id) { return genderName(id); }
export function teacherGradeName(id) { return enumName(TEACHER_GRADES, id, ''); }
export function methodName(id) { return enumName(TEACHING_METHODS, id, ''); }
export function personalityTagName(id) { return enumName(PERSONALITY_TAGS, id, ''); }
export function nonacademicProjectName(id) { return enumName(NONACADEMIC_PROJECTS, id, ''); }
export function teachingGoalName(id) { return enumName(TEACHING_GOALS, id, ''); }
export function graduationYearText(year) {
  return (year != null && year !== '') ? `${year}${TEXT.GRAD_YEAR_SUFFIX}` : '';
}

export function demandTargetName(id, type) {
  return type === DEMAND_TYPES.NONACADEMIC ? nonacademicProjectName(id) : subjectName(id);
}
export function demandTargetNameList(ids, type) {
  return (ids || []).map(id => demandTargetName(id, type)).filter(Boolean);
}
export function demandTargetNames(ids, type) {
  return demandTargetNameList(ids, type).join(TEXT.LIST_SEP);
}

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
  return role === 'student' ? TEXT.ROLE_STUDENT : role === 'teacher' ? TEXT.ROLE_TEACHER : TEXT.ADMIN_BADGE;
}

export function starsHtml(rating) {
  const r = rating || 4.5;
  let html = '<span class="stars">';
  for (let i = 1; i <= 5; i++) {
    html += `<span class="star ${i <= Math.round(r) ? 'filled' : ''}">★</span>`;
  }
  return html + '</span>';
}
export function ratingText(rating) { return (rating || 4.5).toFixed(1); }

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

export function demandScoreCell(cs) {
  const n = subjectName(cs.subject);
  if (cs.grade || cs.mode === 'grade') return cs.grade ? (n ? `${n}: ${cs.grade}` : cs.grade) : '';
  if (cs.score !== '' && cs.score != null) return n ? `${n}: ${cs.score}${TEXT.SCORE_UNIT}/${cs.scale}${TEXT.SCORE_SCALE_SUFFIX}` : '';
  return '';
}
export function gaokaoCell(gs) {
  return gs.score != null ? String(gs.score) : (gs.grade || '');
}

export function expectedTimeText(raw) {
  if (!raw) return '';
  let arr = null;
  try { const p = JSON.parse(raw); if (Array.isArray(p)) arr = p; } catch { arr = null; }
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

export function reviewStatusTagHtml(status) {
  if (status === STATUS.APPROVED) return `<span class="tag tag-ok">${TEXT.STATUS_APPROVED}</span>`;
  if (status === STATUS.REJECTED) return `<span class="tag tag-danger">${TEXT.STATUS_REJECTED}</span>`;
  if (status === STATUS.PENDING) return `<span class="tag tag-warn">${TEXT.STATUS_PENDING}</span>`;
  return '';
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

export function feedbackKindName(kind) {
  if (kind === 'bug') return TEXT.FEEDBACK_TAG_BUG;
  if (kind === 'complaint') return TEXT.FEEDBACK_TAG_COMPLAINT;
  return TEXT.FEEDBACK_TAG_SUGGEST;
}
export function feedbackSubjectName(subject) {
  if (subject === 'teacher') return TEXT.FEEDBACK_COMPLAINT_SUBJECT_TEACHER;
  if (subject === 'student') return TEXT.FEEDBACK_COMPLAINT_SUBJECT_STUDENT;
  if (subject === 'platform') return TEXT.FEEDBACK_COMPLAINT_SUBJECT_PLATFORM;
  return '';
}
export function complaintTargetName(targetType) {
  if (targetType === 'teacher') return TEXT.COMPLAINT_TAB_TEACHER;
  if (targetType === 'student') return TEXT.COMPLAINT_TAB_STUDENT;
  return TEXT.COMPLAINT_TAB_POST;
}

export function studentGradeName(id) {
  if (!id) return '';
  return enumName(STUDENT_GRADES, id, '');
}
export function demandIdText(displayId) {
  const n = Number(displayId);
  return n ? `${TEXT.DEMAND_PREFIX}#${String(n).padStart(CONFIG.DISPLAY_ID_PAD || 4, '0')}` : '';
}
export function demandBudgetText(d) {
  return (d.budget_min || d.budget_max)
    ? `${d.budget_min || TEXT.BUDGET_NO_LIMIT}~${d.budget_max || TEXT.BUDGET_NO_LIMIT}${TEXT.BUDGET_UNIT_SUFFIX}`
    : TEXT.BUDGET_NEGOTIABLE;
}
export function feedbackKindCls(kind) {
  return kind === 'bug' ? 'tag-danger' : kind === 'complaint' ? 'tag-warn' : 'tag-accent';
}
export function contractStatusMeta(ct) {
  const status = typeof ct === 'string' ? ct : (ct && ct.status);
  if (ct && typeof ct === 'object' && ct.revoked) return { text: TEXT.CONTRACT_STATUS_REVOKED, cls: 'tag-danger' };
  if (status === STATUS.SIGNED) return { text: TEXT.CONTRACT_STATUS_SIGNED, cls: 'tag-ok' };
  return { text: TEXT.CONTRACT_STATUS_SIGNING, cls: 'tag-warn' };
}

/**
 * LCS line diff (parity with app-display D.diffLines):
 * returns ops [{t:'same'|'del'|'add', text}].
 */
export function diffLines(oldText, newText) {
  const splitLines = t => (t == null || t === '') ? [] : String(t).split('\n');
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ t: 'same', text: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ t: 'del', text: a[i] }); i++; }
    else { ops.push({ t: 'add', text: b[j] }); j++; }
  }
  while (i < n) { ops.push({ t: 'del', text: a[i] }); i++; }
  while (j < m) { ops.push({ t: 'add', text: b[j] }); j++; }
  return ops;
}
