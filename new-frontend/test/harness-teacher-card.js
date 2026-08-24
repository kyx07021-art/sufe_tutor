/**
 * test/harness-teacher-card.js - focused TeacherCard geometry harness
 * ---------------------------------------------------------------------
 * - Mounts TeacherCard directly (bypassing the page-level filters/sort bars
 *   that live in sibling files) so card geometry can be asserted in isolation.
 * - Two fixtures: `full` (bio + subjects incl. an awards:[] array and an empty
 *   subject entry) and `minimal` (no bio, no subjects, no price) - the minimal
 *   card is the empty-state shape AK-N-D4 guarantees is never "flat".
 * - The card fixtures are already mapped I-29 teacher models (M7-01 shape).
 */
import { createApp, h } from 'vue'
import TeacherCard from '../src/modules/teacher-square/TeacherCard.vue'
import '../src/styles/tokens.css'
import '../src/styles/base.css'

const full = {
  teacherId: 11,
  name: 'Chen',
  avatar: '',
  rating: 4.5,
  reviewCount: 12,
  priceMin: 150,
  priceMax: 260,
  subjects: [
    { subject: 'math', score: 140, full: 150, awards: [] },
    { subject: 'english', score: 0, full: null, awards: [] },
    { subject: '', score: null, full: null, awards: [] },
  ],
  bio: 'test bio',
  region: 'Shanghai',
  experienceYears: 8,
  matchScore: 90,
  matchCount: 3,
  teachingMethod: 'both',
  timeSlots: [],
  personalityTags: ['patience'],
  gender: 'male',
  verified: true,
  chsiVerified: true,
}

const minimal = {
  teacherId: 12,
  name: 'He',
  avatar: '',
  rating: 0,
  reviewCount: 0,
  priceMin: null,
  priceMax: null,
  subjects: [],
  bio: '',
  region: '',
  experienceYears: null,
  matchScore: 0,
  matchCount: 0,
  teachingMethod: '',
  timeSlots: [],
  personalityTags: [],
  gender: null,
  verified: false,
  chsiVerified: false,
}

const app = createApp({
  setup() {
    // Render function (not a template string) - the project builds the
    // runtime-only Vue, so the template compiler is not available in dev.
    return () =>
      h('div', { class: 'grid' }, [
        h('div', { class: 'cell' }, [h(TeacherCard, { teacher: full })]),
        h('div', { class: 'cell' }, [h(TeacherCard, { teacher: minimal })]),
      ])
  },
})
app.mount('#app')
