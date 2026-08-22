/**
 * M3-03 Concentric-circle layout for the C1 relations module.
 *
 * Pure geometric layout (no Vue/DOM dependency, Node-testable). Every related
 * user's avatar sits on one concentric circle (the circle itself is never
 * drawn). Each avatar owns a central angle proportional to its dashed-line
 * count (edgeCount) and is placed on the bisector of that angle; all central
 * angles tile the circle (sum to 2π). The avatar with the most edges is placed
 * at angle 0 (east) and is the reference used to rotate every other avatar.
 */

const TAU = Math.PI * 2;

/**
 * Normalize an angle into the [0, 2π) range.
 * @param {number} a - Raw angle in radians (may be negative or >= 2π).
 * @returns {number} Normalized angle in [0, 2π).
 */
function normalizeAngle(a) {
  return ((a % TAU) + TAU) % TAU;
}

/**
 * Lay out avatars on one concentric circle without overlap.
 *
 * Each node's central angle is proportional to its edgeCount, floored so that
 * every span is at least `minSep` — the minimum angular separation between
 * adjacent avatar centers that keeps the chord distance >= avatarDiameter.
 *
 * @param {Array<{userId: number, edgeCount: number}>} nodes - Input nodes;
 *   only `edgeCount` and `userId` are read. `positions` preserves input order.
 * @param {Object} options - Layout options.
 * @param {number} options.radius - Circle radius in px (> 0).
 * @param {{x: number, y: number}} [options.center] - Circle center; defaults to {x: 0, y: 0}.
 * @param {number} [options.avatarDiameter] - Diameter of outer avatars in px (>= 0).
 * @returns {{
 *   positions: Array<{node: Object, x: number, y: number, angle: number}>,
 *   meta: { radius: number, center: {x: number, y: number}, minSep: number,
 *           overlap: boolean, maxEdgeUserId: number|null },
 * }}
 */
export function layoutCircle(nodes, { radius, center, avatarDiameter }) {
  const ctr = center ?? { x: 0, y: 0 };

  // Step 1: empty input short-circuit.
  if (!nodes || nodes.length === 0) {
    return {
      positions: [],
      meta: {
        radius,
        center: ctr,
        minSep: 0,
        overlap: false,
        maxEdgeUserId: null,
      },
    };
  }

  const n = nodes.length;

  // Step 2: effective edge counts (guard: non-positive edgeCounts count as 1).
  const edges = nodes.map((node) => (node.edgeCount > 0 ? node.edgeCount : 1));
  let total = 0;
  for (const edge of edges) total += edge;
  // `total` is always >= n here; a totally flat input is treated as all ones.

  // Step 3: minimum angular separation between adjacent avatar centers so the
  // chord distance between them is >= avatarDiameter (no overlap).
  let minSep = 0;
  if (avatarDiameter > 0 && radius > 0) {
    minSep = 2 * Math.asin(Math.min(1, avatarDiameter / (2 * radius)));
  }

  // Step 4: feasibility — n avatars of `minSep` separation need n*minSep of
  // angular room. If the circle cannot fit them without overlap, fall back to
  // equal spacing and flag `overlap` (best-effort; positions still returned).
  let overlap = false;
  if (n * minSep > TAU) {
    minSep = TAU / n;
    overlap = true;
  }

  // Step 5: angular span per node. The minSep floor guarantees every
  // adjacent-center gap (span_i + span_{i+1})/2 >= minSep, so avatars never
  // overlap even when pure proportional placement would. Spans sum to 2π:
  //   Σ span = n*minSep + (Σ edge/total)*(2π − n*minSep) = 2π.
  const spans = edges.map((edge) => minSep + (edge / total) * (TAU - n * minSep));

  // Step 6: bisector center angles before rotation (spans tile the circle).
  // c_0 = span_0/2, then c_i = c_{i-1} + (span_{i-1} + span_i)/2, which equals
  // the cumulative form c_i = (Σ_{j<i} span_j) + span_i/2.
  const angles = new Array(n);
  let cumulative = 0;
  for (let i = 0; i < n; i++) {
    cumulative += spans[i] / 2;
    angles[i] = cumulative;
    cumulative += spans[i] / 2;
  }

  // Step 7: rotate so the FIRST node with the max edgeCount sits at angle 0
  // (east) — the reference used to position all others.
  let maxEdgeIndex = 0;
  let maxEdge = -Infinity;
  for (let i = 0; i < n; i++) {
    if (edges[i] > maxEdge) {
      maxEdge = edges[i];
      maxEdgeIndex = i;
    }
  }
  const rotateBy = angles[maxEdgeIndex];
  const rotated = angles.map((a) => normalizeAngle(a - rotateBy));

  // Step 8: cartesian positions on the circle.
  const positions = nodes.map((node, i) => {
    const angle = rotated[i];
    return {
      node,
      x: ctr.x + radius * Math.cos(angle),
      y: ctr.y + radius * Math.sin(angle),
      angle,
    };
  });

  // Step 9: meta.
  return {
    positions,
    meta: {
      radius,
      center: ctr,
      minSep,
      overlap,
      maxEdgeUserId: nodes[maxEdgeIndex].userId,
    },
  };
}
