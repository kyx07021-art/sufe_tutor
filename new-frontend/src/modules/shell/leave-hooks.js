/**
 * leave-hooks.js - Route leave hooks (afterEach cleanup)
 * -------------------------------------------------------
 * - Register cleanup hooks fired on route leave (router.afterEach).
 * - Hooks unregister themselves with their page lifecycle; runLeaveHooks()
 *   does not clear the registry.
 * - Each registerLeaveHook() returns an unregister function for early removal.
 * - No dependencies.
 */

const hooks = new Set()
export function registerLeaveHook(fn) { hooks.add(fn); return () => hooks.delete(fn) }
export function runLeaveHooks() { hooks.forEach((fn) => { try { fn() } catch (e) {} }) }
