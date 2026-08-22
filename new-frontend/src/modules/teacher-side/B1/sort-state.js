/**
 * sort-state.js - B1-3a sort preference persistence + B1-5d3 filter reset
 * -------------------------------------------------------
 * - Persists the B1 demand plaza sort preference (sort key + order) in
 *   localStorage so a returning teacher keeps their last sort.
 * - Validates on read: any corrupt/illegal persisted value falls back to
 *   DEFAULT_SORT instead of crashing the plaza.
 * - resetFilters() returns a fresh default filter state (B1-5d3 reset button).
 * - Pure module: no DOM access beyond localStorage, importable from anywhere.
 */

export const SORT_STATE_KEY = 'teacher-side:sort-state'

export const DEFAULT_SORT = { sort: 'match', order: 'desc' }

const SORT_VALUES = ['match', 'price']
const ORDER_VALUES = ['asc', 'desc']

function fallbackSort() {
  return { ...DEFAULT_SORT }
}

/**
 * Read and validate the persisted sort state.
 * @returns {{ sort: 'match'|'price', order: 'asc'|'desc' }}
 */
export function loadSortState() {
  if (typeof localStorage === 'undefined') return fallbackSort()
  const raw = localStorage.getItem(SORT_STATE_KEY)
  if (!raw) return fallbackSort()
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    console.warn('sort-state: ignoring corrupt persisted sort state', err)
    return fallbackSort()
  }
  if (!parsed || typeof parsed !== 'object') return fallbackSort()
  return {
    sort: SORT_VALUES.includes(parsed.sort) ? parsed.sort : DEFAULT_SORT.sort,
    order: ORDER_VALUES.includes(parsed.order) ? parsed.order : DEFAULT_SORT.order,
  }
}

/**
 * Persist the sort state (clamped to legal values).
 * @param {{ sort: 'match'|'price', order: 'asc'|'desc' }} state
 */
export function saveSortState({ sort, order }) {
  if (typeof localStorage === 'undefined') return
  const clean = {
    sort: SORT_VALUES.includes(sort) ? sort : DEFAULT_SORT.sort,
    order: ORDER_VALUES.includes(order) ? order : DEFAULT_SORT.order,
  }
  try {
    localStorage.setItem(SORT_STATE_KEY, JSON.stringify(clean))
  } catch (err) {
    console.warn('sort-state: failed to persist sort state', err)
  }
}

/** B1-5d3 reset: fresh default filter state (new copies, never a shared object). */
export function resetFilters() {
  return {
    subjects: [],
    gender: '',
    priceMin: null,
    priceMax: null,
  }
}
