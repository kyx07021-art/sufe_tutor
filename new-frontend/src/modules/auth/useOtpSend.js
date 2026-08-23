import { ref } from 'vue'
import { api } from '@/core/api.js'
import { showToast } from '@/composables/useToast'
import { UI_COPY } from '@/constants/ui.js'
import { AUTH_COPY, buildOtpRequestBody } from '@/constants/m-auth.js'

/**
 * useOtpSend - M6-5 send-verification-code chain (I-01)
 * -------------------------------------------------------
 * - POST /api/auth/otp/request { channel, target?, scene? } (public).
 * - Guards against duplicate in-flight sends (busy); on success shows the
 *   standard OTP-sent toast (UI_COPY.OTP_SENT) and returns true so the caller
 *   arms the resend countdown on the captcha input.
 * - `target` is omitted when the caller has no value (verify scene: the server
 *   resolves the logged-in user's bound contact from the session).
 * - Body assembly (incl. AUTH_SCENES -> OTP scene literal translation, PA-2-F7)
 *   is delegated to the pure, directly-tested buildOtpRequestBody.
 */
export function useOtpSend() {
  const sending = ref(false)

  async function send({ channel, target, scene }) {
    if (sending.value) return false
    sending.value = true
    try {
      const body = buildOtpRequestBody({ channel, target, scene })
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
