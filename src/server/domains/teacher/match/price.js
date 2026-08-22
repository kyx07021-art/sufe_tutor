/**
 * S4-18 price dimension (pure). Weight 20.
 * Interval-overlap scoring between the teacher price range and the student budget range.
 * - Teacher has no price at all -> NOT applicable (null).
 * - Demand has no budget at all -> NOT applicable (null).
 * - Either side collapses to a single point: full score iff the point falls inside the
 *   other range (open-ended bounds are treated as unbounded: min ?? 0, max ?? Infinity).
 * - Otherwise score = overlapLen / min(teacherSpan, demandSpan), clamped to [0,1].
 */
import { WEIGHTS } from './weights.js';

/**
 * @param {import('./normalize.js').NormalizedTeacher} t
 * @param {import('./normalize.js').NormalizedDemand} d
 * @returns {{key:'price', score:number|null, weight:number}[]}
 */
export function price(t, d) {
  const { priceMin: tMin, priceMax: tMax } = t;
  const { budgetMin: dMin, budgetMax: dMax } = d;
  if (tMin == null && tMax == null) return [{ key: 'price', score: null, weight: WEIGHTS.budget }];
  if (dMin == null && dMax == null) return [{ key: 'price', score: null, weight: WEIGHTS.budget }];

  const lo = tMin ?? 0, hi = tMax ?? Number.POSITIVE_INFINITY;
  const dlo = dMin ?? 0, dhi = dMax ?? Number.POSITIVE_INFINITY;

  // Single-point cases (either side collapses to one number)
  if (hi - lo === 0 || dhi - dlo === 0) {
    const point = hi - lo === 0 ? lo : dlo;
    const rLo = hi - lo === 0 ? dlo : lo;
    const rHi = hi - lo === 0 ? dhi : hi;
    return [{ key: 'price', score: point >= rLo && point <= rHi ? 1 : 0, weight: WEIGHTS.budget }];
  }

  const overlap = Math.max(0, Math.min(hi, dhi) - Math.max(lo, dlo));
  const tSpan = hi - lo, dSpan = dhi - dlo;
  const denom = Math.min(tSpan, dSpan);
  if (!Number.isFinite(denom) || denom <= 0) {
    // Both spans unbounded (e.g. teacher [min, null], demand [min, null]) -> full overlap
    return [{ key: 'price', score: 1, weight: WEIGHTS.budget }];
  }
  return [{ key: 'price', score: Math.min(1, overlap / denom), weight: WEIGHTS.budget }];
}
