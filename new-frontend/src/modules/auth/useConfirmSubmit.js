import { ref } from 'vue'
// Relative imports (no '@' alias): this file is imported directly by the Node
// end-session capToken flow test, so it must resolve from plain Node — the same
// constraint core/api.js documents. Vite resolves both forms identically.
import { api } from '../../core/api.js'
import { showToast } from '../../composables/useToast.js'
import { AUTH_COPY } from '../../constants/m-auth.js'
import { authOverlay } from './authState.js'

/**
 * useConfirmSubmit - M6-10 confirm submit chain for the verify scene (I-06)
 * -------------------------------------------------------
 * - POST /api/auth/verify (logged-in) with body
 *   { credential: { type: 'otp' | 'password', value }, captchaVerified: true,
 *     captchaId }. The slider puzzle is verified first (M6-8b -> I-07) and the
 *   locally generated captchaId is echoed here as a correlation id; the captcha
 *   is an anti-abuse UX gate, not an auth boundary (the server-verified credential
 *   + OTP/password + rate limits are the real defense, AK-A1b).
 * - Returns true on success so the caller can run onVerified + close; false on
 *   failure (modal stays open). Busy guard (F6) prevents double submits.
 * - The response carries a fresh capToken for the calling flow (interfaces.md
 *   §19); it is parked on authOverlay.capToken so AuthHost can hand it to the
 *   caller's onVerified (three-exit contract).
 */
export function useConfirmSubmit() {
  const submitting = ref(false)

  async function submit({ type, value, captchaId }) {
    if (submitting.value) return false
    submitting.value = true
    try {
      const r = await api('/auth/verify', {
        method: 'POST',
        auth: true,
        body: { credential: { type, value }, captchaVerified: true, captchaId: captchaId || '' },
      })
      if (!r || r.verified !== true) {
        showToast((r && r.message) || AUTH_COPY.VERIFY_FAIL)
        return false
      }
      authOverlay.capToken = r.capToken || ''
      return true
    } catch (err) {
      showToast(err.message || AUTH_COPY.VERIFY_FAIL)
      return false
    } finally {
      submitting.value = false
    }
  }

  return { submitting, submit }
}
