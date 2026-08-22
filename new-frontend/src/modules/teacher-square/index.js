/**
 * index.js - M7 A1 teacher-square module entry (assembly re-export)
 * -------------------------------------------------------
 * - TeacherSquarePage: registered into the central page registry (src/pages.js).
 * - Pure-function surface: consumed by tests / other modules.
 */
export { default as TeacherSquarePage } from './TeacherSquarePage.vue'
export { default as SecondBar } from './SecondBar.vue'
export * from './sort.js'
export * from './teachers-api.js'
export * from './match-dimensions.js'
export * from './prefs.js'
