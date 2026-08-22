/**
 * card-layout.js - M3-08 relation-card placement planner (F4 refinement)
 * ----------------------------------------------------------------------
 * - Pure function (no Vue/DOM dependency, Node-testable). Single source of
 *   truth for WHERE relation cards hang and HOW WIDE they are.
 * - The board renders float cards with their center at the dashed-edge
 *   midpoint; the card list below the board renders when the board cannot fit
 *   readable cards.
 * - F4 refined model: the fitted width is the intersection of three limits and
 *   is NEVER clamped upward (the base implementation clamped UP to a floor,
 *   which forced too-narrow cards onto the board):
 *     fitted = max(0, 2 * (radius/2 - selfRadius - gap))   center clearance
 *     adj    = max(0, radius * sin(minDelta/2) - gap)      adjacent-card chord
 *     width  = min(cardWidthMax, fitted, adj)
 *   If that width falls below cardWidthMin the mode switches to 'list' (cards
 *   render as a vertical list below the board) rather than rendering
 *   too-narrow / overlapping cards on the board.
 * - English only: zero raw CJK in source (contract 6).
 */

/**
 * Plan relation-card placement for the current concentric layout.
 *
 * @param {Array<{node: object, x: number, y: number, angle: number}>} positions
 *   - M3-03 `layoutCircle` positions (one per relation node).
 * @param {object} options - Planner options.
 * @param {{x: number, y: number}} options.center - Board center (px).
 * @param {number} options.radius - Concentric-circle radius (px).
 * @param {number} options.selfDiameter - Center (self) avatar diameter (px).
 * @param {number} options.cardWidthMax - Upper bound on card width (px).
 * @param {number} options.cardWidthMin - Readable minimum that gates midpoint
 *   vs list mode (px).
 * @param {number} options.gap - Clearance kept between a card and the self
 *   avatar / its neighbors (px).
 * @returns {{ mode: 'midpoint'|'list', cardWidth: number,
 *             cards: Array<{x: number, y: number, width: number}> }}
 */
export function planRelationCards(positions, { center, radius, selfDiameter, cardWidthMax, cardWidthMin, gap }) {
  const n = positions.length
  if (n === 0) return { mode: 'list', cardWidth: cardWidthMax, cards: [] }

  // Cards sit at the dashed-line midpoint = half the radius from the center.
  const mid = radius / 2
  // Center clearance: the half-width must leave room for the self avatar plus
  // the gap on the facing side. NO upper clamp here.
  const fitted = Math.max(0, 2 * (mid - selfDiameter / 2 - gap))

  // Smallest angular gap between adjacent avatar centers (circular measure).
  let minDelta = Math.PI * 2
  if (n >= 2) {
    const sorted = positions.map((p) => p.angle).sort((a, b) => a - b)
    for (let i = 0; i < n; i++) {
      const d = (sorted[(i + 1) % n] - sorted[i] + Math.PI * 2) % (Math.PI * 2)
      if (d < minDelta) minDelta = d
    }
  }

  // Adjacent-card clearance: the chord between adjacent card centers must clear
  // the gap. A single card has no neighbor to clear, so adj is unbounded there.
  const adj = n >= 2 ? Math.max(0, radius * Math.sin(minDelta / 2) - gap) : Number.POSITIVE_INFINITY

  // Never clamp UP: the fitted width is the tightest limit that keeps the card
  // clear of the self avatar and its neighbors.
  const cardWidth = Math.min(cardWidthMax, fitted, adj)

  // Geometric gate: only float cards on the board when the fitted width is at
  // least the readable minimum; otherwise the vertical list below the board
  // takes over.
  const mode = cardWidth >= cardWidthMin ? 'midpoint' : 'list'

  const cards = positions.map((p) => ({
    x: (p.x + center.x) / 2,
    y: (p.y + center.y) / 2,
    width: cardWidth,
  }))

  return { mode, cardWidth, cards }
}
