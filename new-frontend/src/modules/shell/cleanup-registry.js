/**
 * cleanup-registry.js - F3-dedup cleanup registry
 * -------------------------------------------------------
 * - Register cleanup callbacks to stop polling / timers / listeners.
 * - runCleanupCallbacks() fires every registered callback once, then clears the
 *   registry; invoked on 401 and logout (handle-dead-token / auth-actions).
 * - Each registerCleanup() returns an unregister function for early removal.
 * - No dependencies.
 */

const callbacks = new Set()
export function registerCleanup(fn) { callbacks.add(fn); return () => callbacks.delete(fn) }
export function runCleanupCallbacks() { const list = [...callbacks]; callbacks.clear(); list.forEach((fn) => { try { fn() } catch (e) {} }) }
