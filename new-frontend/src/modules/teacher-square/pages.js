/**
 * pages.js - M7 A1 teacher-square page registry
 * -------------------------------------------------------
 * - M2 route registry collects every module's `pages.js` (page-registry.js glob).
 * - Each entry: { path, name, roles?, component, meta? }; `roles` present makes the
 *   route role-gated (student client only).
 */
import TeacherSquarePage from './TeacherSquarePage.vue'
import { TEACHER_SQUARE_TEXT as T } from '@/constants/m-teacher-square.js'

export const pages = [
  {
    path: '/teacher-square',
    name: 'teacher-square',
    roles: ['student'],
    component: TeacherSquarePage,
    meta: { title: T.PAGE_TITLE, home: true, tabOrder: 10 },
  },
]
