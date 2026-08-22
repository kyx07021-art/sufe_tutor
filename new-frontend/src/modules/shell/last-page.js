/**
 * last-page.js - last visited page memory (memory-history companion)
 * -------------------------------------------------------
 * - With memory history there is no URL to recover on refresh; the router
 *   afterEach guard saves the last visited path here so session restore can
 *   return the user to where they left off (ADR 0003 §2.2 last-page memory).
 * - Storage is sessionStorage (per-tab), key `sufe.lastPage`.
 * - Every access is try/catch guarded: storage can be unavailable in
 *   private/incognito mode or under SSR, and a failed write must never
 *   break navigation (clearLastPage keeps the key cleared on failure).
 */
const KEY = 'sufe.lastPage'

export function saveLastPage(path) {
  try {
    window.sessionStorage.setItem(KEY, path)
  } catch (e) {
    /* non-fatal: storage unavailable */
  }
}

export function getLastPage() {
  try {
    return window.sessionStorage.getItem(KEY)
  } catch (e) {
    return null
  }
}

export function clearLastPage() {
  try {
    window.sessionStorage.removeItem(KEY)
  } catch (e) {
    /* non-fatal: storage unavailable */
  }
}
