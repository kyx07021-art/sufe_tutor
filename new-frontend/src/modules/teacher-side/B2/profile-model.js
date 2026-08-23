/**
 * profile-model.js - B2-3/5 teacher profile pure mapping (I-39 -> edit, edit -> I-40 body)
 * --------------------------------------------------------------------------------------
 * - Pure + node-testable (no network, no `@` alias): mirrors the B1 split of
 *   demands-model.js (pure) / demands-service.js (network seam).
 * - normalizeProfile maps a raw I-39 mapper row to the edit shape. `region` carries the
 *   province pinyin id (mapper `province`), which the save path sends back as I-40
 *   `province` (required). Missing fields get safe defaults (C3 covers undefined/null).
 * - buildSaveBody builds the I-40 PUT `{ profile }` body with the frozen camelCase field
 *   set (interfaces.md §19); `subjects` collapses each row to { subject, score }.
 * - formatTimeSlots renders structured time-slot rows as readable Chinese text; the
 *   structured rows (not free text) are what the save path sends back (I-40 time_slots
 *   requires the {type:'week',dow,start,end} object-row shape server-side).
 */
import { MY_DEMANDS_COPY } from '../../../constants/m-my-demands.js'

// Single source for weekday labels (shared with my-demands TimeSlotEditor; dow 1..7 order).
const DAY_LABELS = MY_DEMANDS_COPY.DAY_LABELS

export const DEFAULT_PROFILE = {
  teacherName: '',
  bio: '',
  region: '', // province pinyin id (== I-40 province, required)
  addressArea: '',
  teachingMethod: '',
  priceMin: null,
  priceMax: null,
  experienceYears: 0,
  gender: '',
  graduationYear: '',
  timeSlots: [],
  personalityTags: [],
  subjects: [],
  philosophy: '',
}

function numOrNull(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function arr(v) {
  return Array.isArray(v) ? v.slice() : []
}

/** Normalize a raw I-39 profile row (mapper output) to the edit shape. Pure. */
export function normalizeProfile(p) {
  const src = p && typeof p === 'object' ? p : {}
  const exp = src.experienceYears != null ? src.experienceYears : src.experience_years
  return {
    teacherName: src.teacher_name || src.teacherName || '',
    bio: src.bio || src.intro || '',
    region: src.province || '',
    addressArea: src.addressArea || src.address || '',
    teachingMethod: src.teachingMethod || src.teaching_method || '',
    priceMin: numOrNull(src.priceMin != null ? src.priceMin : src.price_min),
    priceMax: numOrNull(src.priceMax != null ? src.priceMax : src.price_max),
    experienceYears: exp != null && exp !== '' ? Math.max(0, Number(exp) || 0) : 0,
    gender: src.gender || '',
    graduationYear:
      src.graduationYear != null
        ? src.graduationYear
        : src.graduation_year != null
          ? src.graduation_year
          : '',
    timeSlots: arr(src.timeSlots != null ? src.timeSlots : src.time_slots),
    personalityTags: arr(src.personalityTags != null ? src.personalityTags : src.personality_tags),
    subjects: Array.isArray(src.subjects)
      ? src.subjects.map((s) => ({
          subject: (s && s.subject) || '',
          score: s && s.score != null ? s.score : null,
          full: s && s.full != null ? s.full : null,
          awards: Array.isArray(s && s.awards) ? s.awards.slice() : [],
        }))
      : [],
    philosophy: src.philosophy || src.teaching_philosophy || '',
    avatar: src.avatar || '',
  }
}

/**
 * Build the I-40 PUT body from the edit payload. Pure.
 * Field names are the frozen I-40 camelCase set (interfaces.md §19); `province` is required
 * and comes from the edit `region` (province pinyin id). `subjects` collapses each row to
 * { subject, score } per I-40. The body is wrapped in `{ profile }` to match
 * handleSaveProfile's `const { profile: p } = body` destructure.
 * @param {Object} payload edit shape (camelCase internal)
 * @returns {Object} `{ profile: {...} }`
 */
/**
 * Format structured time-slot rows [{type:'week',dow,start,end}] into readable text like
 * 'Mon 18:00-20:00, Wed 09:00-11:00' (weekday labels from the single DAY_LABELS source).
 * Unknown/malformed rows are skipped.
 * Pure + node-testable; used by the B2 edit card for read-only display while the save
 * path keeps the structured rows (I-40 requires the object-row shape server-side).
 * @param {Array} rows time-slot object rows
 * @returns {string} readable text ('' when empty/invalid)
 */
export function formatTimeSlots(rows) {
  if (!Array.isArray(rows)) return ''
  const parts = []
  for (const it of rows) {
    if (!it || typeof it !== 'object') continue
    const day = DAY_LABELS[Number(it.dow) - 1]
    if (!day) continue
    if (typeof it.start !== 'string' || typeof it.end !== 'string') continue
    parts.push(`${day} ${it.start}-${it.end}`)
  }
  return parts.join('、')
}

export function buildSaveBody(payload) {
  const subjects = (Array.isArray(payload && payload.subjects) ? payload.subjects : []).map(
    (s) => ({
      subject: (s && s.subject) || '',
      score: s && s.score != null ? s.score : null,
    }),
  )
  return {
    profile: {
      province: payload.region,
      teacherName: payload.teacherName,
      bio: payload.bio,
      addressArea: payload.addressArea || '',
      teachingMethod: payload.teachingMethod || '',
      priceMin: payload.priceMin,
      priceMax: payload.priceMax,
      experienceYears: payload.experienceYears,
      gender: payload.gender,
      graduationYear: payload.graduationYear,
      timeSlots: payload.timeSlots,
      personalityTags: payload.personalityTags,
      subjects,
      philosophy: payload.philosophy || '',
    },
  }
}
