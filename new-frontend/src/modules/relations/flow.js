/**
 * M3-07 flow.js - dash flow animation gate
 * -------------------------------------------------------
 * - The page (M3-10) calls `isFlowAllowed()` once on mount and toggles the
 *   `.is-flowing` class on the board root accordingly (JS only toggles classes;
 *   the actual animation lives in flow.css).
 * - Users who request reduced motion get the dashed lines WITHOUT the drift.
 */

/** True when the dash flow animation is allowed (no reduced-motion preference). */
export function isFlowAllowed() {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}
