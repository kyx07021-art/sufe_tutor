/**
 * demands-model.js - B1-2a I-34 demand mapping (pure, node-testable)
 * -----------------------------------------------------------------
 * - Normalizes a raw /api/demands item into the card/display shape.
 * - Explicitly reads `matchScore` / `matchCount` (I-32 field contract);
 *   missing fields get safe defaults (C3 normalization covers undefined/null).
 * - Provides the pure sort comparator (matchScore / mid-price, order-aware).
 */
import { midPriceOf } from '../../../components/shared/midPrice.js'

/** Pure: normalize one raw I-34 item. */
export function mapDemandItem(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}
  return {
    id: r.id ?? 0,
    user_id: r.user_id ?? null,
    subject: r.subject || '',
    targetType: r.targetType || '',
    grade: r.grade || '',
    province: r.province || '',
    teachingMethod: r.teachingMethod || 'online',
    currentScore: r.currentScore ?? null,
    currentScoreFull: r.currentScoreFull ?? null,
    addressArea: r.addressArea || '',
    expectedTime: r.expectedTime || '',
    preferredTags: Array.isArray(r.preferredTags) ? r.preferredTags.slice() : [],
    preferredGender: r.preferredGender || '',
    budgetMin: r.budgetMin ?? null,
    budgetMax: r.budgetMax ?? null,
    additionalInfo: r.additionalInfo || '',
    status: r.status || 'open',
    createdAt: r.createdAt || '',
    studentName: r.studentName || '',
    studentAvatar: r.studentAvatar || '',
    /* I-32 explicit read: matchScore (0-100) / matchCount (filter dims hit) */
    matchScore: typeof r.matchScore === 'number' && Number.isFinite(r.matchScore) ? r.matchScore : 0,
    matchCount: typeof r.matchCount === 'number' && Number.isFinite(r.matchCount) ? r.matchCount : 0,
  }
}

/** Pure: normalize a raw list (non-array -> empty list). */
export function mapDemandList(rawItems) {
  return (Array.isArray(rawItems) ? rawItems : []).map(mapDemandItem)
}

/** Pure: mid price (budgetMin+budgetMax)/2, single edge -> that edge, none -> null. */
export function midPrice(d) {
  return midPriceOf(d.budgetMin, d.budgetMax)
}

/**
 * Pure: sort comparator for a sort key + order.
 * sort: 'match' (matchScore desc default) | 'price' (mid price).
 * null prices always sort last regardless of order.
 */
export function compareBySort(sort, order = 'desc') {
  const dir = order === 'asc' ? 1 : -1
  if (sort === 'price') {
    return (a, b) => {
      const am = midPrice(a)
      const bm = midPrice(b)
      if (am == null && bm == null) return 0
      if (am == null) return 1
      if (bm == null) return -1
      return (am - bm) * dir
    }
  }
  return (a, b) => (a.matchScore - b.matchScore) * dir
}
