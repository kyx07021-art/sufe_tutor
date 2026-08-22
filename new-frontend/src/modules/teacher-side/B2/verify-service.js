/**
 * verify-service.js - B2-1b/2a/2b verification status + submit channels (I-41/I-42/I-43)
 * ---------------------------------------------------------------------------------------
 * - Uses the core api() single point (@/core/api.js) for auth token + 401 handling.
 */
import { api } from '@/core/api.js'

/**
 * Fetch the verification gate state (I-43).
 * Missing/illegal fields get safe defaults (status 'none').
 * @returns {Promise<{ status:'none'|'pending'|'approved'|'rejected', provider?:string, verifyType?:string }>}
 */
const VERIFY_STATUSES = ['none', 'pending', 'approved', 'rejected']

export async function fetchVerifyStatus() {
  const json = await api('/teacher/verify-status')
  const raw = json && json.status ? json.status : 'none'
  // clamp to the whitelist: an out-of-range server status is treated as 'none' (C3/C5)
  const status = VERIFY_STATUSES.includes(raw) ? raw : 'none'
  return {
    status,
    provider: json && json.provider ? json.provider : undefined,
    verifyType: json && json.verifyType ? json.verifyType : undefined,
  }
}

/**
 * Submit a CHSI online verification code (I-41).
 * @param {string} code 12-16 alphanumeric verification code
 * @returns {Promise<{ ok:boolean, status:string, provider?:string }>}
 */
export async function submitChsi(code) {
  return api('/teacher/verify-chsi', { method: 'POST', body: { code } })
}

/**
 * Submit an admission notice image as a data URL (I-42).
 * @param {string} dataUrl jpeg/png/webp image data URL
 * @returns {Promise<{ ok:boolean, status:string }>}
 */
export async function submitAdmission(dataUrl) {
  return api('/teacher/verify-admission', { method: 'POST', body: { image: dataUrl } })
}
