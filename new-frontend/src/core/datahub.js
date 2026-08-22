/**
 * datahub.js - module data cache (first consumer: M8 my-demands)
 * -------------------------------------------------------
 * - Domain-keyed in-memory Map. Modules read shared data via dhFetch('demands') and
 *   invalidate after any mutation (F7: write -> invalidate -> next read refetches).
 * - Keys are business-domain names (e.g. 'demands', 'teachers', 'contracts') - single source;
 *   red-dot polling and page reads share the same cache.
 * - Values stored by reference; readers must treat them as read-only.
 */

const cache = new Map()

/** Read cached value (undefined when absent). */
export function dhGet(key) {
  return cache.get(key)
}

/** Write a value into the cache. */
export function dhSet(key, value) {
  cache.set(key, value)
}

/** Whether a key is present in the cache. */
export function dhHas(key) {
  return cache.has(key)
}

/** Invalidate one or more keys (single point for post-mutation cache expiry). */
export function dhInvalidate(...keys) {
  for (const k of keys) cache.delete(k)
}

/**
 * Fetch-if-missing: returns the cached value when present, otherwise runs the fetcher
 * and caches its result. force bypasses the cache (used after invalidate on page refresh).
 */
export async function dhFetch(key, fetcher, { force = false } = {}) {
  if (!force && cache.has(key)) return cache.get(key)
  const value = await fetcher()
  cache.set(key, value)
  return value
}
