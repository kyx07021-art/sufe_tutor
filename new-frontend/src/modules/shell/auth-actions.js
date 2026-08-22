import { setAuth, persistAuth, clearAuth } from './auth-store.js'
import { api } from '@/core/api.js'
import { dhClearAll } from '@/core/datahub.js'
import { clearLastPage } from './last-page.js'
import { runCleanupCallbacks } from './cleanup-registry.js'

/**
 * auth-actions - login / register / logout network actions
 * ---------------------------------------------------------
 * - All requests go through the api() single point (fetch wrapper, X-Auth-Token
 *   injection, 401 dead-token fallback).
 * - Successful auth updates the authStore immediately (F7) and persists to the
 *   dual storage via auth-store helpers.
 * - Logout is idempotent on the network side; local state + storage are always
 *   cleared and shell cleanup callbacks run.
 * - Contract: M2-10 auth-actions.js (CONTRACT.md §3.4).
 */

export async function login({ identifier, code, remember = false, deviceId } = {}) {
  const data = await api('/auth/login/code', {
    method: 'POST',
    body: { identifier, code, ...(deviceId ? { deviceId } : {}) },
    auth: false,
  })
  const { user, authToken } = data
  setAuth({ token: authToken, user })
  persistAuth({ token: authToken, user, remember })
  return user
}

export async function register(payload) {
  const data = await api('/auth/register', { method: 'POST', body: payload, auth: false })
  const { user, authToken } = data
  setAuth({ token: authToken, user })
  persistAuth({ token: authToken, user, remember: false })
  return user
}

export async function logout() {
  try {
    await api('/auth/logout', { method: 'POST' })
  } catch (e) {
    /* idempotent: a revoked/already-logged-out token must still clear local state */
  }
  clearAuth()
  clearLastPage()
  dhClearAll()
  runCleanupCallbacks()
}
