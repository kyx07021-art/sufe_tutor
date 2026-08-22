/**
 * auth.js - M5 auth gate (thin seam over M2 authStore)
 * -------------------------------------------------------
 * - The authed state is owned by M2 authStore (token/user) - single source.
 *   This file only wraps the check + the blocked-path handler; it keeps NO
 *   module-level authed boolean (contract: auth state lives in auth-store.js).
 * - requireAuth(): returns true when authStore.token is present; when not authed
 *   it triggers the registered handler (default = login-required toast). M6 can
 *   register a real login redirect via setRequireAuthHandler.
 * - The module-local http.js (apiFetch) has been removed: all network calls go
 *   through the site-wide core/api.js single point (contract 6: fetch lives
 *   there only).
 */
import { showToast } from '@/composables/useToast'
import { NOTIF_COPY } from '@/constants/m-notifications'
import { authStore } from '@/modules/shell/auth-store.js'

let requireAuthHandler = null

/** M6 registers the real login redirect here. */
export function setRequireAuthHandler(fn) {
  requireAuthHandler = typeof fn === 'function' ? fn : null
}

export function requireAuth() {
  if (authStore.token) return true
  if (requireAuthHandler) {
    requireAuthHandler()
  } else {
    showToast(NOTIF_COPY.LOGIN_REQUIRED)
  }
  return false
}
