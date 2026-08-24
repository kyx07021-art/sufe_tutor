/**
 * pages-meta.js - pure page definitions for the teacher-side registry
 * -------------------------------------------------------------------
 * - Pure data (no .vue imports) so node tests can assert the registration
 *   contract without the SFC compiler. pages.js wires these into the registry.
 * - Titles resolve to TEACHER_COPY (module copy single source) via a relative
 *   import so the file stays node-testable (the '@' alias is Vite-only).
 */
import { TEACHER_COPY } from '../../constants/m-teacher-side.js'

export const TEACHER_PAGES_META = [
  // AK-N-B1: B1 demand plaza is the teacher default page (meta.home); tabOrder
  // encodes the logical progression plaza -> own items -> chat -> relations (TabBar sorts by it).
  { path: '/teacher/demands', name: 'B1', roles: ['teacher'], meta: { title: TEACHER_COPY.B1_TITLE, home: true, tabOrder: 10 } },
  { path: '/teacher/profile', name: 'B2', roles: ['teacher'], meta: { title: TEACHER_COPY.B2_TITLE, tabOrder: 20 } },
  { path: '/teacher/resources', name: 'B3', roles: ['teacher'], meta: { title: TEACHER_COPY.B3_TITLE, tabOrder: 25 } },
]
