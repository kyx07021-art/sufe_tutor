/**
 * M3 C1 relations page registry (M2 page-registry contract)
 * -------------------------------------------------------
 * - Collected by src/modules/shell/page-registry.js (import.meta.glob).
 * - `/relations` is role-gated (student + teacher) -> a child of the shell
 *   layout. Tab label comes from meta.title (copy single source).
 */
import RelationsPage from './RelationsPage.vue'
import { RELATIONS_COPY } from '@/constants/m-relations.js'

export const pages = [
  {
    path: '/relations',
    name: 'relations',
    roles: ['student', 'teacher'],
    component: RelationsPage,
    meta: { title: RELATIONS_COPY.PAGE_TITLE, tab: true },
  },
]
