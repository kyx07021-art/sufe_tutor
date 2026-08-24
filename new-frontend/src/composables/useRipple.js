import { onBeforeUnmount, onMounted } from 'vue'
import { createRipple } from './createRipple'

/**
 * useRipple - composable thin shell over createRipple (TASK A single-path dynamics).
 * -------------------------------------------------------------------------------
 * The whole ripple implementation lives in createRipple; this hook only binds it to
 * a Vue template ref with Vue lifecycle. The dynamics are shared with the vRipple
 * directive (src/directives/ripple.js), so click and keyboard activation behave
 * identically across every component.
 * - Click ripple: origin converges from the trigger point to the button center while
 *   the radius grows to hypot/2+2 -> the circle covers the whole button (no spray).
 * - The ripple IS the mask: it stays visible after the spread (fill forwards), cleared
 *   on pointerleave / blur. No second persistent overlay.
 * - CSSOM data channel (el.style.setProperty) only - CSP style-src-attr 'none' compatible.
 * - disabled skips all coordinate writes and ripples (CSS .is-disabled hides the layers).
 */
export function useRipple(elRef, { disabled = null } = {}) {
  let ripple = null

  onMounted(() => {
    if (!elRef.value) return
    ripple = createRipple(elRef.value, { disabled })
    ripple.bind()
  })

  onBeforeUnmount(() => {
    if (ripple) ripple.unbind()
  })

  return ripple
}
