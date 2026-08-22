/**
 * teachers-api.js - M7-01 teacher list fetch + response mapping (I-29)
 * -------------------------------------------------------
 * - Consumes I-29 GET /api/teachers (interfaces.md §19, ready).
 * - Explicitly reads matchScore / matchCount / experienceYears (new-model fields).
 * - Network single point: the default caller is core/api.js api() (contract 6:
 *   fetch lives in core/api.js only). `fetcher` is injectable for tests.
 */
// Relative import (not the @ alias) so this module stays importable from plain Node
// tests; core/api.js is the single fetch point (contract 6).
import { api } from '../../core/api.js'

export const I29_PATH = '/api/teachers'

/** Build the I-29 query string from sort/order/filters. */
export function buildTeachersQuery({ sort = 'match', order = 'desc', filters = {} } = {}) {
  const q = new URLSearchParams()
  q.set('sort', sort)
  q.set('order', order)
  if (Array.isArray(filters.subjects) && filters.subjects.length) q.set('subjects', filters.subjects.join(','))
  if (filters.gender && filters.gender !== 'any' && filters.gender !== 'all') q.set('gender', filters.gender)
  if (Array.isArray(filters.personalities) && filters.personalities.length) q.set('personalities', filters.personalities.join(','))
  if (filters.priceMin !== '' && filters.priceMin !== null && filters.priceMin !== undefined) q.set('priceMin', String(filters.priceMin))
  if (filters.priceMax !== '' && filters.priceMax !== null && filters.priceMax !== undefined) q.set('priceMax', String(filters.priceMax))
  return q.toString()
}

/** Map one raw I-29 item to the internal teacher model (explicit field reads). */
export function mapTeacherResponse(raw) {
  return {
    teacherId: raw.teacherId ?? raw.id ?? null,
    name: raw.name ?? raw.teacherName ?? raw.username ?? '',
    avatar: raw.avatar ?? '',
    rating: raw.rating ?? null,
    reviewCount: raw.reviewCount ?? 0,
    priceMin: raw.priceMin ?? null,
    priceMax: raw.priceMax ?? null,
    subjects: Array.isArray(raw.subjects) ? raw.subjects : [],
    bio: raw.bio ?? '',
    region: raw.region ?? '',
    experienceYears: raw.experienceYears ?? null,
    matchScore: raw.matchScore ?? 0,
    matchCount: raw.matchCount ?? 0,
    teachingMethod: raw.teachingMethod ?? '',
    timeSlots: raw.timeSlots ?? [],
    personalityTags: raw.personalityTags ?? [],
    gender: raw.gender ?? null,
    verified: !!raw.verified,
    chsiVerified: !!raw.chsiVerified,
  }
}

/** Map a raw I-29 item array. */
export function mapTeacherResponseList(rawList) {
  return (Array.isArray(rawList) ? rawList : []).map(mapTeacherResponse)
}

/**
 * Fetch I-29.
 * - default `fetcher` = core/api.js api() (path WITHOUT the /api prefix, returns
 *   parsed JSON, throws ApiError on failure).
 * - Never throws: returns { ok: true, items, total } | { ok: false, error }.
 * - A 200 body that is not an `{items:[...]}` object (malformed / SPA fallback) is
 *   treated as an error, not as an empty list.
 */
export async function fetchTeachers({ sort = 'match', order = 'desc', filters = {}, fetcher } = {}) {
  const q = buildTeachersQuery({ sort, order, filters })
  const call = fetcher || api
  try {
    const data = await call(`/teachers?${q}`)
    if (!data || !Array.isArray(data.items)) return { ok: false, error: 'malformed' }
    return { ok: true, items: mapTeacherResponseList(data.items), total: data.total }
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : 'network' }
  }
}
