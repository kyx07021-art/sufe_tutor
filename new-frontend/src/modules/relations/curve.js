/**
 * M3-04 Dashed-curve bend algorithm for the C1 relations module.
 *
 * Given `edgeCount` dashed lines between two shared endpoints, produce the SVG
 * path `d` strings with the plan's bend behavior:
 *   - N=1           : straight line
 *   - N=2           : both lines bow OUTWARD (double outer bend), symmetric
 *   - N=3           : middle line straight, outer two bow outward SLIGHTLY MORE
 *                     than the N=2 bend (~1.2x)
 *   - N>=4          : bend increases with N
 *   - midpoints spread apart perpendicular to the axis with adjacent midpoint
 *     gap >= CURVE_GAP_MIN; mirror-symmetric about the from->to axis; all curves
 *     share both endpoints.
 *
 * Amplitude scheme: N=2 outer amplitude = G; N>=3 outer amplitude =
 * OUTER_STEP_FACTOR * G * (N-1)/2. The adjacent midpoint step is therefore 2G
 * for N=2 and OUTER_STEP_FACTOR*G for N>=3 — both >= the G threshold — while
 * the N=3 outer bend stays "slightly larger" than N=2 (1.2x, not 2x).
 *
 * Curve type: cubic Bezier. Control points ride the from->to axis at 1/3 of the
 * distance (gentle, tangent entry at each endpoint) plus a perpendicular offset.
 * For a cubic `M P0 C P1 P2 P3` the actual midpoint is `(P0+3P1+3P2+P3)/8`; with
 * P1/P2 offset by `s` perpendicularly the midpoint offset is `0.75*s`, so
 * `s = CUBIC_MID_FACTOR * desiredMidOffset`.
 *
 * Gap invariant (precise): in the full-scale regime (chord length >=
 * BEND_REF_LENGTH) the adjacent-midpoint gap is 2G for N=2 and 1.2G for N>=3
 * (both >= CURVE_GAP_MIN). Below that length the whole bend scales as
 * length/BEND_REF_LENGTH; independently, the outer midpoint offset is capped at
 * CURVE_BOW_RATIO_MAX of the chord so large-N fans cannot arch higher than the
 * chord. Degenerate chords (length < CURVE_MIN_LENGTH or non-finite coords)
 * yield no curves.
 *
 * Pure math, zero DOM/Vue dependencies (Node-testable). English only.
 */

/** Minimum gap between adjacent curve midpoints (px) — also the N=2 base
 *  amplitude (dual role: one constant drives both the gap threshold and the
 *  N=2 bend; do not "fix" the N=2 amplitude to match the gap, that would break
 *  the N=3-slightly-larger ratio). Module single source. */
export const CURVE_GAP_MIN = 12

/** N>=3 outer bend is this many times the N=2 bend ("slightly larger"). */
export const OUTER_STEP_FACTOR = 1.2

/** Cubic Bezier midpoint identity factor: control offset = factor * mid offset. */
export const CUBIC_MID_FACTOR = 4 / 3

/** Chords shorter than this scale the bend down (arcs never fold back on themselves). */
const BEND_REF_LENGTH = CURVE_GAP_MIN * 4

/** Outer midpoint offset is capped at this fraction of the chord length
 *  (prevents large-N / short-chord arches that are taller than the chord). */
export const CURVE_BOW_RATIO_MAX = 0.4

/** Chords shorter than this produce no curves (degenerate guard; never throws). */
export const CURVE_MIN_LENGTH = 1

const EPS = 1e-9

/** Round to 1 decimal (sub-pixel; keeps path strings compact + test diffs deterministic). */
function r1(value) {
  return Math.round(value * 10) / 10
}

/** Outer (max) bend amplitude for N lines. */
function amplitude(N) {
  if (N <= 1) return 0
  if (N === 2) return CURVE_GAP_MIN // 1.0 * G
  return (OUTER_STEP_FACTOR * CURVE_GAP_MIN * (N - 1)) / 2 // N >= 3: step stays 1.2G, amplitude grows
}

/**
 * Build the dashed-curve SVG paths between two shared endpoints.
 *
 * @param {number} edgeCount - number of dashed lines (>= 1). 0 -> [].
 * @param {{x: number, y: number}} from - outer avatar center (px).
 * @param {{x: number, y: number}} to   - center/self avatar center (px).
 * @returns {Array<{path: string}>} one entry per line, ordered by offset.
 */
export function buildCurves(edgeCount, from, to) {
  const N = Math.floor(Number(edgeCount))
  if (!Number.isFinite(N) || N <= 0) return []

  const dx = to.x - from.x
  const dy = to.y - from.y
  const L = Math.hypot(dx, dy)
  // Degenerate guards (fail-closed, never throw): non-finite coordinates or a
  // sub-pixel chord produce no curves (nothing visible to draw).
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || L < CURVE_MIN_LENGTH) return []

  let ux = 1
  let uy = 0
  if (L > EPS) {
    ux = dx / L
    uy = dy / L
  }
  const vx = -uy // perpendicular unit
  const vy = ux

  // Effective amplitude: length ramp (short chords scale the whole bend down)
  // AND bow-ratio cap (outer midpoint offset never exceeds a fraction of the
  // chord, so large-N fans cannot arch higher than their chord).
  const baseA = amplitude(N)
  let scale = L >= BEND_REF_LENGTH ? 1 : L / BEND_REF_LENGTH
  if (baseA > 0) {
    const bowCap = (CURVE_BOW_RATIO_MAX * L) / baseA
    if (bowCap < scale) scale = bowCap
  }
  const A = baseA * scale
  const uMax = (N - 1) / 2
  const third = L / 3
  const curves = []

  for (let i = 0; i < N; i++) {
    // Desired ACTUAL midpoint offset (symmetric arithmetic progression).
    const h = uMax === 0 ? 0 : (A * (i - (N - 1) / 2)) / uMax

    if (Math.abs(h) < EPS) {
      // Straight line: N=1, or the middle line of odd N.
      curves.push({ path: `M ${r1(from.x)} ${r1(from.y)} L ${r1(to.x)} ${r1(to.y)}` })
      continue
    }

    // Cubic control-point perpendicular offset so the actual midpoint offset = h.
    const s = CUBIC_MID_FACTOR * h
    const p1x = from.x + ux * third + vx * s
    const p1y = from.y + uy * third + vy * s
    const p2x = to.x - ux * third + vx * s
    const p2y = to.y - uy * third + vy * s
    curves.push({
      path: `M ${r1(from.x)} ${r1(from.y)} C ${r1(p1x)} ${r1(p1y)} ${r1(p2x)} ${r1(p2y)} ${r1(to.x)} ${r1(to.y)}`,
    })
  }

  return curves
}
