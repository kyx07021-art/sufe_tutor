/**
 * prefs.js - M7-02 sort preference persistence + filter reset
 * -------------------------------------------------------
 * - Sort preference (sort key + order) persists across page re-entries (localStorage).
 * - Filter state resets on every page entry
 *   (spec: sort preference persists, filter selection resets on each page entry).
 * - Key contract surface ④: delete persistence -> refresh loses sort order (red);
 *   delete reset -> stale filters persist (red).
 */

const STORAGE_KEY = 'tsq:sortPref'

export function loadSortPref() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const p = JSON.parse(raw)
    if (typeof p !== 'object' || !p || typeof p.key !== 'string') return null
    if (p.order !== 'asc' && p.order !== 'desc') return null
    return { key: p.key, order: p.order }
  } catch {
    return null
  }
}

export function saveSortPref({ key, order }) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ key, order }))
  } catch {
    // storage unavailable (private mode / blocked) - persistence is best-effort
  }
}

/** Fresh empty filter state (reset on every page entry). */
export function emptyFilters() {
  return { subjects: [], gender: '', personalities: [], priceMin: '', priceMax: '' }
}
