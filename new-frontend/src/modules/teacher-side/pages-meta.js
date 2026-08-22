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
  { path: '/teacher/demands', name: 'B1', roles: ['teacher'], meta: { title: TEACHER_COPY.B1_TITLE } },
  { path: '/teacher/profile', name: 'B2', roles: ['teacher'], meta: { title: TEACHER_COPY.B2_TITLE } },
  { path: '/teacher/resources', name: 'B3', roles: ['teacher'], meta: { title: TEACHER_COPY.B3_TITLE } },
]
