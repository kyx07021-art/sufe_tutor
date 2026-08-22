/**
 * profile-service.js - B2-3/5/6 teacher profile fetch + save + avatar (I-39/I-40/I-11)
 * ------------------------------------------------------------------------------------
 * - Uses the core api() single point (@/core/api.js).
 * - fetchMyProfile normalizes the I-39 response into the edit shape; saveProfile sends
 *   the edit shape back to I-40 (partial fields omitted = server keeps old values).
 */
import { api } from '@/core/api.js'

const DEFAULT_PROFILE = {
  teacherName: '',
  bio: '',
  region: '',
  priceMin: null,
  priceMax: null,
  experienceYears: 0,
  gender: '',
  graduation: '',
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

/**
 * Fetch the teacher's own profile (I-39) and normalize to the edit shape.
 * Missing fields get safe defaults (C3 normalization).
 * @returns {Promise<Object>}
 */
export async function fetchMyProfile() {
  const json = await api('/teacher/profile')
  if (!json || typeof json !== 'object') return { ...DEFAULT_PROFILE }
  const arr = (v) => (Array.isArray(v) ? v.slice() : [])
  return {
    teacherName: json.teacher_name || json.teacherName || '',
    bio: json.bio || '',
    region: json.region || json.addressArea || '',
    priceMin: numOrNull(json.priceMin),
    priceMax: numOrNull(json.priceMax),
    experienceYears:
      json.experience_years != null && json.experience_years !== ''
        ? Math.max(0, Number(json.experience_years) || 0)
        : 0,
    gender: json.gender || '',
    graduation: json.graduation || json.graduation_school || '',
    timeSlots: arr(json.timeSlots),
    personalityTags: arr(json.personalityTags),
    subjects: Array.isArray(json.subjects)
      ? json.subjects.map((s) => ({
          subject: (s && s.subject) || '',
          score: s && s.score != null ? s.score : null,
          full: s && s.full != null ? s.full : null,
          awards: Array.isArray(s && s.awards) ? s.awards.slice() : [],
        }))
      : [],
    philosophy: json.philosophy || json.teaching_philosophy || '',
    avatar: json.avatar || '',
  }
}

/**
 * Save the teacher profile (I-40). Partial fields omitted keep the old value.
 * Field names follow the frozen contract (interfaces.md §19 I-40): snake_case
 * `teacher_name` / `experience_years`; the avatar is a separate write path (I-11).
 * @param {Object} payload edit shape (camelCase internal)
 * @returns {Promise<Object>}
 */
export async function saveProfile(payload) {
  return api('/teacher/profile', {
    method: 'PUT',
    body: {
      teacher_name: payload.teacherName,
      bio: payload.bio,
      region: payload.region,
      priceMin: payload.priceMin,
      priceMax: payload.priceMax,
      experience_years: payload.experienceYears,
      gender: payload.gender,
      graduation: payload.graduation,
      timeSlots: payload.timeSlots,
      personalityTags: payload.personalityTags,
      subjects: payload.subjects,
      philosophy: payload.philosophy,
    },
  })
}

/**
 * Save a new avatar (I-11). The dataURL is pre-cropped to the max circle square.
 * @param {string} dataUrl
 * @returns {Promise<Object>}
 */
export async function saveAvatar(dataUrl) {
  return api('/settings', { method: 'PUT', body: { avatar: dataUrl } })
}
