/**
 * midPrice - shared pure mid-price helper (M0 shared; M7 teacher / M9 demand)
 * ---------------------------------------------------------------------------
 * - Core (min+max)/2 logic, shared by teacher-square/sort.js (priceMin/priceMax)
 *   and teacher-side/B1/demands-model.js (budgetMin/budgetMax). The two modules
 *   map their own field names onto this helper; only the pure math lives here.
 * - Single side present -> that side; both null/undefined -> null.
 * - Pure (no .vue / no '@' alias) so node tests import it directly.
 */

/**
 * Mid price of a [lo, hi] pair: (lo+hi)/2; single side -> that side; both null -> null.
 * @param {number|null|undefined} lo
 * @param {number|null|undefined} hi
 * @returns {number|null}
 */
export function midPriceOf(lo, hi) {
  const hasLo = lo != null
  const hasHi = hi != null
  if (!hasLo && !hasHi) return null
  if (!hasLo) return hi
  if (!hasHi) return lo
  return (lo + hi) / 2
}
