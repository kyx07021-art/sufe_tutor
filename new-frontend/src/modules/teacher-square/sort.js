/**
 * sort.js - M7-03 teacher-list sort pure function
 * -------------------------------------------------------
 * 4 keys x asc/desc. Price sorts by MID price (priceMin+priceMax)/2; single-sided
 * uses the present side; both-null sorts LAST regardless of order.
 * Key contract surface ① - mutation target: dropping the mid-price for raw min
 * changes the ordering (see smoke test fixtures).
 */
import { midPriceOf } from '../../components/shared/midPrice.js'

export const SORT_KEYS = ['match', 'rating', 'exp', 'price']

/**
 * Mid price: (priceMin+priceMax)/2, single side uses that side, both null -> null.
 * @param {{ priceMin?: number|null, priceMax?: number|null }} t
 * @returns {number|null}
 */
export function midPrice(t) {
  if (!t) return null
  return midPriceOf(t.priceMin, t.priceMax)
}

const ACCESSORS = {
  match: (t) => t.matchScore ?? -1,
  rating: (t) => t.rating ?? -1,
  exp: (t) => t.experienceYears ?? -1,
  price: (t) => midPrice(t), // null => always sorted last
}

/**
 * Stable comparator factory for a sort key + order.
 * null/undefined values always sort last regardless of asc/desc.
 */
export function makeTeacherSorter(key, order = 'asc') {
  const acc = ACCESSORS[key] || ACCESSORS.match
  const dir = order === 'desc' ? -1 : 1
  return (a, b) => {
    const va = acc(a)
    const vb = acc(b)
    const aNull = va === null || va === undefined
    const bNull = vb === null || vb === undefined
    if (aNull && bNull) return 0
    if (aNull) return 1
    if (bNull) return -1
    if (va < vb) return -1 * dir
    if (va > vb) return 1 * dir
    return 0
  }
}

/** Sort a copy of items by key + order (stable; input not mutated). */
export function sortTeachers(items, { key = 'match', order = 'asc' } = {}) {
  return [...items].sort(makeTeacherSorter(key, order))
}
