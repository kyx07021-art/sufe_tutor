/**
 * match-dimensions.js - M7-12 teacher match dimensions (4-dim config)
 * -------------------------------------------------------
 * Dimension-table-driven config consumed by the shared useMatchGroup engine.
 * Dimension shape: { key, active(filters) -> boolean, matches(item, filters) -> boolean }.
 * M9 (B1) supplies its own 3-dim config; the engine is dimension-agnostic.
 *
 * Key contract surface ② - price filtering = RANGE CROSS HIT (single/double sided):
 *   teacher range [lo,hi] overlaps the selected [priceMin, priceMax].
 */

/** Range-cross-hit price test (single/double sided teacher price). */
export function priceHit(t, f) {
  const fmin = f.priceMin
  const fmax = f.priceMax
  const hasFmin = fmin !== '' && fmin !== null && fmin !== undefined
  const hasFmax = fmax !== '' && fmax !== null && fmax !== undefined
  if (!hasFmin && !hasFmax) return false
  const lo = t.priceMin ?? t.priceMax
  const hi = t.priceMax ?? t.priceMin
  if (lo === null || lo === undefined || hi === null || hi === undefined) return false
  if (hasFmin && hi < Number(fmin)) return false
  if (hasFmax && lo > Number(fmax)) return false
  return true
}

function subjectsList(t) {
  return Array.isArray(t.subjects)
    ? t.subjects.map((s) => (typeof s === 'string' ? s : s && s.subject))
    : []
}

export const TEACHER_MATCH_DIMENSIONS = [
  {
    key: 'subjects',
    active: (f) => Array.isArray(f.subjects) && f.subjects.length > 0,
    matches: (t, f) => subjectsList(t).some((s) => f.subjects.includes(s)),
  },
  {
    key: 'gender',
    active: (f) => !!f.gender && f.gender !== 'any' && f.gender !== 'all' && f.gender !== '',
    matches: (t, f) => !!t.gender && t.gender === f.gender,
  },
  {
    key: 'personality',
    active: (f) => Array.isArray(f.personalities) && f.personalities.length > 0,
    matches: (t, f) => {
      const tags = Array.isArray(t.personalityTags) ? t.personalityTags : []
      return tags.some((p) => f.personalities.includes(p))
    },
  },
  {
    key: 'price',
    active: (f) => {
      const v = [f.priceMin, f.priceMax]
      return v.some((x) => x !== '' && x !== null && x !== undefined)
    },
    matches: priceHit,
  },
]
