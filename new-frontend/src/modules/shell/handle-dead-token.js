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
 * - Idempotent: repeated calls are safe — every step is a no-op once the cleared
 *   state is reached, and the toast/redirect only fire per call.
 */

import { clearAuth } from './auth-store.js'
import { runCleanupCallbacks } from './cleanup-registry.js'
import { clearLastPage } from './last-page.js'
import { dhClearAll } from '@/core/datahub.js'
import { showToast } from '@/composables/useToast.js'
import { SHELL_COPY } from '@/constants/m-shell.js'

let redirectHandler = null
let listenerInstalled = false

export function setDeadTokenRedirect(fn) {
  redirectHandler = fn
}

export function handleDeadToken({ silent = false } = {}) {
  clearAuth()
  clearLastPage()
  dhClearAll()
  runCleanupCallbacks()
  if (!silent) showToast(SHELL_COPY.LOGIN_EXPIRED)
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
