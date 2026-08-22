/**
 * test/harness-teacher-square.js - M7 teacher-square page render harness
 * -------------------------------------------------------
 * - Mounts TeacherSquarePage in isolation for smoke-teacher-square.mjs (Vite dev entry).
 * - The page fetches I-29 via core/api.js; the test intercepts /api/teachers* and
 *   seeds localStorage authToken (core/api.js readAuthToken source).
 */
import { createApp } from 'vue'
import TeacherSquarePage from '../src/modules/teacher-square/TeacherSquarePage.vue'
import '../src/styles/tokens.css'
import '../src/styles/base.css'

const app = createApp(TeacherSquarePage, { source: 'live' })
app.mount('#app')
