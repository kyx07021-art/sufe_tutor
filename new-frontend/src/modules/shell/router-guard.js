/**
 * router-guard.js - role-gated routing guard (M2-09)
 * ---------------------------------------------------
 * - beforeEach: enforces the login gate and the role gate. Public routes pass
 *   through untouched. An unauthenticated user hitting a protected route gets
 *   the identity-auth UI opened (mode login) and is redirected to the landing
 *   page. A user whose role is not allowed by the target route is redirected to
 *   their role's default page (when one exists).
 * - afterEach: remembers the last visited page (except landing) and runs all
 *   registered leave hooks so page background work (polling / listeners) is torn
 *   down on departure.
 * - Injects the dead-token redirect (back to landing + open login) into
 *   handle-dead-token, the single 401 login-death channel.
 * - The `roles` meta is assembled by router/index.js from page.roles onto the
 *   child meta (contract M2 §3.11); this module only reads it.
 * - Contract: M2-09 router-guard.js (CONTRACT.md §3.13) + ADR 0003 §1.3 / §2.4.
 */

import { authStore } from './auth-store.js'
import { defaultPageForRole } from './page-registry.js'
import { saveLastPage } from './last-page.js'
import { runLeaveHooks } from './leave-hooks.js'
import { setDeadTokenRedirect } from './handle-dead-token.js'
import { getIface } from './ifaces.js'

export function installRouterGuard(router) {
  // 401 single channel: dead token redirects to landing and invites re-login.
  setDeadTokenRedirect(() => {
    router.push('/')
    const open = getIface('openIdentityAuth')
    if (open) open({ mode: 'login' })
  })

  router.beforeEach((to) => {
    const requiresAuth = to.matched.some((r) => r.meta.requiresAuth)
    if (!requiresAuth) return true

    if (!authStore.token) {
      const open = getIface('openIdentityAuth')
      if (open) open({ mode: 'login' })
      return { path: '/' }
    }

    const roles = to.meta.roles
    if (roles && authStore.user && !roles.includes(authStore.user.role)) {
      const def = defaultPageForRole(authStore.user.role)
      // fail-closed: a role-mismatched target redirects to the role default, or to
      // the landing when the role has no default (unknown/legacy role).
      return def ? { path: def } : { path: '/' }
    }

    return true
  })

  router.afterEach((to) => {
    if (to.path && to.path !== '/') saveLastPage(to.path)
    runLeaveHooks()
  })
}
