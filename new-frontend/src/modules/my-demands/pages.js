/**
 * pages.js - A2 my-demands page registration (M8)
 * -------------------------------------------------------
 * - Route registry entry (consumed by M2-08 memory history): array shape
 *   { path, name, roles?, component, meta? }; roles present = role-gated.
 * - page-registry.js only merges exported ARRAYS of page defs, so a single
 *   object export is silently skipped. Must export `pages` as an array.
 * - roles: [ROLES.STUDENT] - only the student client top bar shows the
 *   "my-demands" tab.
 */
import MyDemandsPage from './MyDemandsPage.vue'
import { ROLES } from '@/modules/shell/auth-store.js'
import { MY_DEMANDS_COPY } from '@/constants/m-my-demands.js'

export const pages = [
  {
    path: '/my-demands',
    name: 'my-demands',
    roles: [ROLES.STUDENT],
    component: MyDemandsPage,
    meta: { tab: true, title: MY_DEMANDS_COPY.PAGE_TITLE, tabOrder: 20 },
  },
]
