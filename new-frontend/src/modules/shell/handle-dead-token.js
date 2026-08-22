/**
 * handle-dead-token.js - single 401 login-death channel
 * -------------------------------------------------------
 * - Triggered by core/api.js dispatching the window 'auth:dead' CustomEvent on any
 *   authenticated 401 (the ONE login-determination channel). Also callable directly
 *   (e.g. router guard).
 * - Clears auth state + dual storage, clears last-page memory, runs all registered
 *   cleanup callbacks (stop polling / timers / listeners), shows the "login expired"
 *   toast (unless silent), then triggers the router redirect handler injected by
 *   router-guard (back to landing + open login).
 * - Toast dedup (PA-1g-F2): concurrent 401s (a first-screen burst of parallel
 *   fetches all failing together) each dispatch 'auth:dead'; only the first call
 *   announces the toast, the rest of the burst are silenced. Cleanup + redirect
 *   stay idempotent and run on every call.
 */

import { authStore, clearAuth } from './auth-store.js'
import { runCleanupCallbacks } from './cleanup-registry.js'
import { clearLastPage } from './last-page.js'
import { dhClearAll } from '@/core/datahub.js'
import { showToast } from '@/composables/useToast.js'
import { SHELL_COPY } from '@/constants/m-shell.js'

let redirectHandler = null
let listenerInstalled = false

/**
 * One-shot toast guard (PA-1g-F2): armed when a login-expiry toast is announced,
 * so a concurrent burst of 401s only announces once. Re-armed lazily — a fresh
 * session (authStore.token truthy again on a later handleDeadToken call) means the
 * next 401 is a DISTINCT expiry event and must announce once more. An anonymous
 * 401 (no live session) never announces.
 */
let toastAnnounced = false

export function setDeadTokenRedirect(fn) {
  redirectHandler = fn
}

export function handleDeadToken({ silent = false } = {}) {
  if (authStore.token && toastAnnounced) toastAnnounced = false
  const hadSession = Boolean(authStore.token)
  clearAuth()
  clearLastPage()
  dhClearAll()
  runCleanupCallbacks()
  if (!silent && hadSession && !toastAnnounced) {
    toastAnnounced = true
    showToast(SHELL_COPY.LOGIN_EXPIRED)
  }
  if (redirectHandler) redirectHandler()
}

/**
 * Install the window 'auth:dead' listener once (F3 dedupe). core/api.js dispatches
 * this event on any authenticated 401; this is the bridge into the single dead-token
 * fallback. Called once from main.js at boot.
 */
export function installDeadTokenListener() {
  if (listenerInstalled) return
  listenerInstalled = true
  window.addEventListener('auth:dead', () => handleDeadToken())
}
