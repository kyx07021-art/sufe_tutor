/**
 * New frontend entry (M2)
 * -------------------------------------------------------
 * - Mounts global styles, the router (memory history), and the root component;
 *   registers the global v-ripple directive.
 * - Session restore runs after mount and routes a remembered/valid session into
 *   the client shell (role default or last page).
 * - The 401 dead-token listener is installed once (F3) so core/api.js 'auth:dead'
 *   events funnel into the single handleDeadToken channel.
 * - Cross-module overlay interfaces (M5 openC3/openC4) are registered on the
 *   ifaces registry so the shell top bar triggers them without deep coupling.
 * - window.__APP__ is a test hook (authStore / router / api) used by
 *   test/smoke-shell.mjs to drive auth flows in the real browser; the coordinator
 *   may gate or remove it at integration close.
 */
import { createApp } from 'vue'
import App from './App.vue'
import { vRipple } from '@/directives/ripple.js'
import { router } from '@/router/index.js'
import { api } from '@/core/api.js'
import { authStore, clearAuth } from '@/modules/shell/auth-store.js'
import { login, register, logout } from '@/modules/shell/auth-actions.js'
import { registerIface } from '@/modules/shell/ifaces.js'
import { restoreSession } from '@/modules/shell/session-restore.js'
import { installDeadTokenListener } from '@/modules/shell/handle-dead-token.js'
import { openC3, openC4, openSettings, openAbout, openFeedback } from '@/modules/notifications/index.js'
import './styles/tokens.css'
import './styles/base.css'

// M5 overlay entry points -> ifaces cap registry (decoupled top-bar triggers).
// The C4 sub-entries (settings/about/feedback) are registered so the shell's
// data-cap placeholder rows are fully wired pre/post M5 integration.
registerIface('openC3', openC3)
registerIface('openC4', openC4)
registerIface('openSettings', openSettings)
registerIface('openAbout', openAbout)
registerIface('openFeedback', openFeedback)

const app = createApp(App)
app.use(router)
app.directive('ripple', vRipple)
app.mount('#app')

installDeadTokenListener()

/**
 * Boot URL bridge (dev / M0 previews only).
 * -------------------------------------------------------
 * - The router is memory history (zero URL sync, ADR 0003). To keep the M0
 *   component showcase reachable via page.goto (smoke-preview/inputs/modals), a
 *   one-shot initial navigation honors an initial pathname (e.g. /preview) or the
 *   legacy `?page=preview` query. Production is unaffected: the SPA URL is always
 *   the root, so this is a no-op there. Never syncs state back to the URL.
 */
function bootNavigateFromUrl() {
  if (typeof window === 'undefined') return
  try {
    const path = window.location.pathname || '/'
    if (path && path !== '/') {
      router.replace(path)
      return
    }
    const page = new URLSearchParams(window.location.search).get('page')
    if (page === 'preview') router.replace('/preview')
  } catch (e) {
    /* ignore: a malformed URL must not break the boot path */
  }
}
bootNavigateFromUrl()

restoreSession()

// Test hook (smoke-shell.mjs); read-only usage expected.
if (typeof window !== 'undefined') {
  window.__APP__ = { authStore, router, api, login, register, logout, clearAuth }
}
