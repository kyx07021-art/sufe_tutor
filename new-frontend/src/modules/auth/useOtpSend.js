import { ref } from 'vue'
import { api } from '@/core/api.js'
import { showToast } from '@/composables/useToast'
import { UI_COPY } from '@/constants/ui.js'
import { AUTH_COPY } from '@/constants/m-auth.js'

/**
 * useOtpSend - M6-5 send-verification-code chain (I-01)
 * -------------------------------------------------------
 * - POST /api/auth/otp/request { channel, target?, scene? } (public).
 * - Guards against duplicate in-flight sends (busy); on success shows the
 *   standard OTP-sent toast (UI_COPY.OTP_SENT) and returns true so the caller
 *   arms the resend countdown on the captcha input.
 * - `target` is omitted when the caller has no value (verify scene: the server
 *   resolves the logged-in user's bound contact from the session).
 */
export function useOtpSend() {
  const sending = ref(false)

  async function send({ channel, target, scene }) {
    if (sending.value) return false
    sending.value = true
    try {
      const body = { channel, scene }
      if (target) body.target = String(target).trim()
      const r = await api('/auth/otp/request', { method: 'POST', auth: false, body })
      if (r && r.ok === false) {
        showToast(AUTH_COPY.OTP_SEND_FAIL)
        return false
      }
      showToast(UI_COPY.OTP_SENT)
      return true
    } catch (err) {
      showToast(err.message || AUTH_COPY.OTP_SEND_FAIL)
      return false
    } finally {
      sending.value = false
    }
  }

  return { sending, send }
}
