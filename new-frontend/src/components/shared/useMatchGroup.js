/**
 * useMatchGroup - dimension-table-driven match grouping (M0 shared, M7 four-dim / M9 three-dim)
 * -------------------------------------------------------------------------------------------
 * - Soft-match semantics: an item is kept if it matches at least one active filter
 *   dimension; kept items are grouped by matchCount (number of active dims hit,
 *   descending) and within a group sorted by the caller's sortBy comparator.
 * - When no filter dimension is active, all items are returned as one implicit group.
 * - Dimensions are plain config objects, so M7 (teacher: subject/gender/personality/price)
 *   and M9 (demand: subject/gender/price) share this module without code duplication.
 *
 * dimension shape: { key, active(filters) -> boolean, matches(item, filters) -> boolean }
 */

/** Pure: number of active filter dimensions. */
export function activeDimCount(filters, dimensions) {
  return dimensions.reduce((n, d) => n + (d.active(filters) ? 1 : 0), 0)
}

/** Pure: number of active dimensions this item matches. */
export function computeMatchCount(item, filters, dimensions) {
  let hits = 0
  for (const d of dimensions) {
    if (d.active(filters) && d.matches(item, filters)) hits += 1
  }
  return hits
}

/** Pure: keep items matching at least one active dim; no active dims -> all items. */
export function filterItems(items, filters, dimensions) {
  const active = dimensions.filter((d) => d.active(filters))
  if (!active.length) return items.slice()
  return items.filter((it) => active.some((d) => d.matches(it, filters)))
}

/**
 * Pure: full pipeline -> list of groups `[{ count, items }]`, groups sorted by
 * matchCount desc, items within a group sorted by `sortBy` (comparator).
 * No active filters -> single group `[{ count: null, items }]`.
 */
export function matchGroup(items, filters, dimensions, sortBy) {
  const active = dimensions.filter((d) => d.active(filters))
  if (!active.length) {
    return [{ count: null, items: items.slice().sort(sortBy) }]
  }
  const kept = items.filter((it) => active.some((d) => d.matches(it, filters)))
  const buckets = new Map()
  for (const it of kept) {
    const c = computeMatchCount(it, filters, dimensions)
    if (!buckets.has(c)) buckets.set(c, [])
    buckets.get(c).push(it)
  }
  return [...buckets.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([count, its]) => ({ count, items: its.sort(sortBy) }))
}

/** Composable surface (pure, no state). */
export function useMatchGroup() {
  return { activeDimCount, computeMatchCount, filterItems, matchGroup }
}
