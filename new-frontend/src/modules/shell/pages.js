/**
 * M2 shell page registry
 * -------------------------------------------------------
 * - Exports `pages` consumed by the router (page-registry.js glob collects every
 *   module's `pages.js`). Each entry: { path, name, roles?, component, meta? }.
 * - `/` landing is public (M1 rebuilds it; this stub is the interface cap until then).
 * - `/home` is the client-shell fallback (role default while real module pages land).
 * - `/preview` keeps the M0 component showcase reachable (dev/QA only; M0 tests
 *   target it so the base layer stays verifiable after routing takes over).
 */
import LandingPage from '@/views/landing/LandingPage.vue'
import HomePlaceholder from './HomePlaceholder.vue'
import { ROLES } from './auth-store.js'

export const pages = [
  {
    path: '/',
    name: 'landing',
    component: LandingPage,
    meta: { public: true },
  },
  {
    path: '/home',
    name: 'shell.home',
    roles: [ROLES.STUDENT, ROLES.TEACHER, ROLES.ADMIN],
    component: HomePlaceholder,
    meta: { tab: false },
  },
  {
    path: '/preview',
    name: 'dev.preview',
    component: () => import('@/components/preview/PreviewPage.vue'),
    meta: { public: true, tab: false },
  },
]
