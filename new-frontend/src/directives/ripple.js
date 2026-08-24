import { isRef } from 'vue'
import { createRipple } from '@/composables/createRipple'

/**
 * v-ripple - directive thin shell over createRipple (TASK A single-path dynamics).
 * -------------------------------------------------------------------------------
 * - Usage: <button v-ripple>...</button>; pairs with the CSS dual circle layers
 *   (::before hover fill / ::after click ripple = mask) consuming --mx/--my/--r/--btn-d.
 * - Coordinate contract = component-local coordinates; CSSOM setProperty writes
 *   --mx/--my/--r (CSP style-src-attr 'none' compatible).
 * - Keyboard activation (Enter/Space) spreads from the element center; disabled elements
 *   are skipped. animationend carries an e.target === el guard so a child animation
 *   (e.g. the check SVG) bubbling up cannot clear the mask.
 * - The ripple IS the mask: it stays visible after the spread until pointerleave/blur.
 */

function resolveDisabled(binding) {
  if (isRef(binding.value)) return () => binding.value.value
  if (typeof binding.value === 'function') return binding.value
  return () => Boolean(binding.value)
}

export const vRipple = {
  mounted(el, binding) {
    el.__ripple = createRipple(el, { disabled: resolveDisabled(binding) })
    el.__ripple.bind()
  },
  updated(el, binding) {
    if (el.__ripple) el.__ripple.unbind()
    el.__ripple = createRipple(el, { disabled: resolveDisabled(binding) })
    el.__ripple.bind()
  },
  unmounted(el) {
    if (el.__ripple) el.__ripple.unbind()
  },
}

export default vRipple
