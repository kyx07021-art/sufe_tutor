/**
 * pages.js - M9 teacher-side page registry (B1-1a / B2-1a / B3-1)
 * --------------------------------------------------------------
 * - Registers the three teacher-side pages (B1 demand plaza, B2 my info, B3 resource
 *   plaza) with the teacher role gate. M2 (routing + auth) consumes `teacherSidePages`
 *   when it lands; each module exposes the same registerPage shape.
 * - Page definitions are pure data in pages-meta.js (node-testable without .vue);
 *   this file wires the components in.
 */
import TeacherDemandPlaza from './B1/TeacherDemandPlaza.vue'
import MyInfo from './B2/MyInfo.vue'
import ResourcePlaza from './B3/ResourcePlaza.vue'
import { TEACHER_PAGES_META } from './pages-meta.js'

export const teacherSidePages = []

/**
 * @param {{ path:string, name:string, roles:string[], component:object, meta?:object }} def
 * @returns {number} registry length
 */
export function registerPage({ path, name, roles, component, meta = {} }) {
  if (!path || !name || !Array.isArray(roles) || !component) {
    throw new Error(`registerPage: invalid page definition for "${name || path}"`)
  }
  teacherSidePages.push({ path, name, roles, component, meta })
  return teacherSidePages.length
}

const COMPONENTS = { B1: TeacherDemandPlaza, B2: MyInfo, B3: ResourcePlaza }
for (const def of TEACHER_PAGES_META) {
  registerPage({ ...def, component: COMPONENTS[def.name] })
}
