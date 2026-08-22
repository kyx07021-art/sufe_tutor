import { onBeforeUnmount, ref } from 'vue'

/**
 * useCountdown - second-level countdown
 * - start(seconds) arms it; remaining decrements each second; auto-stops at 0.
 * - Used by the captcha resend / confirm modal countdown (duration constants in constants/ui.js).
 */
export function useCountdown() {
  const remaining = ref(0)
  const active = ref(false)
  let timer = null
  let endAt = 0

  function start(seconds) {
    stop()
    if (!seconds || seconds <= 0) return
    remaining.value = seconds
    active.value = true
    endAt = Date.now() + seconds * 1000
    timer = setInterval(() => {
      const rem = Math.max(0, Math.ceil((endAt - Date.now()) / 1000))
      remaining.value = rem
      if (rem <= 0) stop()
    }, 250)
  }

  function stop() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    active.value = false
    remaining.value = 0
  }

  onBeforeUnmount(stop)

  return { remaining, active, start, stop }
}
