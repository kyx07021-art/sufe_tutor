/**
 * profile-service.js - B2-3/5/6 teacher profile fetch + save + avatar (I-39/I-40/I-11)
 * ------------------------------------------------------------------------------------
 * - Uses the core api() single point (@/core/api.js).
 * - Pure mapping lives in ./profile-model.js (normalizeProfile / buildSaveBody); this file
 *   is the network seam only. saveProfile sends the frozen I-40 camelCase field set with
 *   `province` (required) mapped from the edit `region`.
 */
import { api } from '@/core/api.js'
import { DEFAULT_PROFILE, normalizeProfile, buildSaveBody } from './profile-model.js'

/**
 * Fetch the teacher's own profile (I-39) and normalize to the edit shape.
 * The server wraps the profile row in `{ profile: {...} }` (handleGetProfile);
 * a flat shape is accepted too for callers/tests passing the mapper output directly.
 * @returns {Promise<Object>}
 */
export async function fetchMyProfile() {
  const json = await api('/teacher/profile')
  if (!json || typeof json !== 'object') return { ...DEFAULT_PROFILE }
  return normalizeProfile(json.profile || json)
}

/**
 * Save the teacher profile (I-40). Body built by buildSaveBody (camelCase full field set,
 * `province` required, subjects as { subject, score } rows).
 * @param {Object} payload edit shape (camelCase internal)
 * @returns {Promise<Object>}
 */
export async function saveProfile(payload) {
  return api('/teacher/profile', { method: 'PUT', body: buildSaveBody(payload) })
}

/**
 * Save a new avatar (I-11). The dataURL is pre-cropped to the max circle square.
 * @param {string} dataUrl
 * @returns {Promise<Object>}
 */
export async function saveAvatar(dataUrl) {
  return api('/settings', { method: 'PUT', body: { avatar: dataUrl } })
}
