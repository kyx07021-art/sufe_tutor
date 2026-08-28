/**
 * match-degree input normalization (C3: undefined/null/missing all collapse to
 * typed defaults). Both the teacher and the demand arrive from many shapes
 * (legacy v2 snake_case, new-model camelCase, single-subject demand, legacy array
 * target_subjects). Every dimension consumes ONLY the normalized shape below, so a
 * missing field can never crash a dimension — it becomes a typed default and the
 * dimension reports "not applicable" (null) instead.
 */

/** Finite number or null ('' / undefined / null / NaN / Infinity all -> null). */
export function numOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** String trim with '' for missing ('' stays ''). */
function strOrEmpty(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

/** Array of strings (objects -> their `subject`/`id` key when present), [] for missing. */
function strArray(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const x of v) {
    if (typeof x === 'string') { if (x) out.push(x); }
    else if (x && typeof x === 'object') {
      const k = x.subject ?? x.id ?? x.key;
      if (typeof k === 'string' && k) out.push(k);
    }
  }
  return out;
}

/**
 * Normalize a raw teacher profile row into the dimension-consumed shape.
 * @param {Object} t raw teacher (mapper output or camelCase API shape)
 */
export function normalizeTeacher(t) {
  if (!t || typeof t !== 'object') t = {};
  return {
    subjects: strArray(t.subjects),                                  // academic subject ids
    nonacademic: strArray(t.nonacademic_projects),                   // non-academic project ids
    province: strOrEmpty(t.province),
    address: strOrEmpty(t.address),                                  // structured '区·镇/街道'
    priceMin: numOrNull(t.price_min ?? t.priceMin),
    priceMax: numOrNull(t.price_max ?? t.priceMax),
    method: strOrEmpty(t.teaching_method ?? t.teachingMethod),       // online|offline|both|''
    personalityTags: strArray(t.personality_tags ?? t.personalityTags),
    gender: strOrEmpty(t.gender),
  };
}

/**
 * Normalize a raw demand row into the dimension-consumed shape.
 * Accepts both the new single-subject model and the legacy target_subjects array.
 * @param {Object} d raw demand row
 */
export function normalizeDemand(d) {
  if (!d || typeof d !== 'object') d = {};
  // single subject (new model) takes precedence; legacy array first element as fallback
  const subject = strOrEmpty(d.subject)
    || (Array.isArray(d.target_subjects) && d.target_subjects[0] ? strOrEmpty(d.target_subjects[0]) : '');
  return {
    subject,
    province: strOrEmpty(d.province),
    address: strOrEmpty(d.addressArea ?? d.address),
    method: strOrEmpty(d.teachingMethod ?? d.teaching_method),       // online|offline|both|''
    budgetMin: numOrNull(d.budgetMin ?? d.budget_min),
    budgetMax: numOrNull(d.budgetMax ?? d.budget_max),
    preferredTags: strArray(d.preferredTags ?? d.preferred_personality_tags),
    preferredGender: strOrEmpty(d.preferredGender ?? d.preferred_teacher_gender),
  };
}
