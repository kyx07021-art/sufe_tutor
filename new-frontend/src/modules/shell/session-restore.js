/**
 * session-restore.js - M2-11 session restore pipeline
 * ---------------------------------------------------
 * - Boot-time restore: optimistically restore stored auth -> validate the token
 *   with GET /api/auth/me -> enter the role default page, or the remembered last
 *   page when it is still permitted for the restored role.
 * - 401 handling is single-point: core/api clears the token and dispatches
 *   window 'auth:dead'; handle-dead-token.js (M2-12) clears auth state and
 *   redirects to the landing page. This module intentionally does NOT re-clear.
 * - Cross-module bindings (authStore / api / router / page registry / last page)
 *   are dereferenced only at call time inside restoreSession().
 * - Contract: src/modules/shell/CONTRACT.md §3.7 (M2-11); auth shape I-05
 *   { id, username, role, avatar } for user.
 */

import { authStore, setAuth, readStoredAuth } from './auth-store.js'
import { api } from '@/core/api.js'
import { router } from '@/router/index.js'
import { getLastPage } from './last-page.js'
import { getPageByPath, defaultPageForRole } from './page-registry.js'

/**
 * restoreSession()
 * - Returns the restored user on success, or null when no stored auth exists
 *   (or the restore failed). Sets authStore.ready in finally so the app always
 *   renders after the boot path settles.
 */
export async function restoreSession() {
  try {
    const stored = readStoredAuth()
    if (!stored) {
      authStore.ready = true
      return null
    }

    // Optimistic restore so the UI paints immediately while the token is
    // verified against the server.
    setAuth({ token: stored.token, user: stored.user })

    // Validate the token. On 401, core/api clears the token and dispatches
    // 'auth:dead' -> handleDeadToken clears state and redirects to landing;
    // the thrown ApiError(401, 'UNAUTHORIZED') is swallowed in catch below.
    const data = await api('/auth/me')

    // Confirmed: replace the optimistic user with the server-verified profile.
    setAuth({ token: stored.token, user: data.user })

    // Target navigation: keep the remembered last page only if it still exists
    // in the registry AND admits the restored role; otherwise fall back to the
    // role default page, then '/' as a last resort.
    const last = getLastPage()
    const pg = last ? getPageByPath(last) : null
    const ok = pg && pg.roles && pg.roles.includes(data.user.role)
    const target = ok ? last : (defaultPageForRole(data.user.role) || '/')
    if (router.currentRoute.value.path !== target) await router.push(target)

    return data.user
  } catch (e) {
    if (e.status !== 401) {
      // Non-401 restore failure (e.g. network error): not fatal for the boot
      // path. The router guard still redirects protected pages whenever the
      // token/user are absent, so the app settles into a safe view.
    }
  } finally {
    authStore.ready = true
  }
  return null
}
