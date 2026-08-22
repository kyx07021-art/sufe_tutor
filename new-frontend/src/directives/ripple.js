import { isRef } from 'vue'

/**
 * v-ripple - ripple directive (v-for dynamic buttons / any clickable element)
 * -------------------------------------------------------
 * - Usage: <button v-ripple>...</button>; pairs with the CSS dual circle layers (::before hover / ::after click) consuming --mx/--my/--btn-d.
 * - Coordinate contract = component-local coordinates; CSSOM setProperty writes --mx/--my (CSP compatible).
 * - Keyboard activation (Enter/Space) spreads from the element center; disabled elements are skipped.
 * - animationend removes .is-rippling (ui-ripple is global in tokens.css; matched by prefix defensively).
 */

function updateCover(el) {
  const d = Math.hypot(el.offsetWidth || 0, el.offsetHeight || 0) * 2
  el.style.setProperty('--btn-d', d.toFixed(1) + 'px')
}

function toLocal(el, clientX, clientY) {
  const r = el.getBoundingClientRect()
  return [clientX - r.left, clientY - r.top]
}

function setPoint(el, lx, ly) {
  el.style.setProperty('--mx', Math.round(lx) + 'px')
  el.style.setProperty('--my', Math.round(ly) + 'px')
}

function isBlocked(el) {
  if (el.disabled) return true
  if (el.__rippleDisabled && el.__rippleDisabled()) return true
  return false
}

function ripple(el, lx, ly) {
  if (isBlocked(el)) return
  updateCover(el)
  if (lx !== undefined) setPoint(el, lx, ly)
  el.classList.remove('is-rippling')
  void el.offsetWidth
  el.classList.add('is-rippling')
}

function onMove(e) {
  const el = e.currentTarget
  if (isBlocked(el)) return
  updateCover(el)
  const p = toLocal(el, e.clientX, e.clientY)
  setPoint(el, p[0], p[1])
}

function onDown(e) {
  if (e.button !== 0) return
  const el = e.currentTarget
  if (isBlocked(el)) return
  const p = toLocal(el, e.clientX, e.clientY)
  ripple(el, p[0], p[1])
}

function onAnimEnd(e) {
  if (e.animationName && e.animationName.indexOf('ui-ripple') === 0) {
    e.target.classList.remove('is-rippling')
  }
}

function onKeyDown(e) {
  if (e.key !== 'Enter' && e.key !== ' ') return
  if (e.repeat) return
  const el = document.activeElement
  if (!el || !el.dataset.ripple) return
  if (e.key === ' ') e.preventDefault()
  ripple(el, el.offsetWidth / 2, el.offsetHeight / 2)
}

if (typeof document !== 'undefined') {
  document.addEventListener('keydown', onKeyDown)
}

export const vRipple = {
  mounted(el, binding) {
    updateCover(el)
    el.dataset.ripple = '1'
    // support dynamic disabled determination (binding.value can be () => boolean)
    el.__rippleDisabled = isRef(binding.value)
      ? () => binding.value.value
      : typeof binding.value === 'function'
        ? binding.value
        : () => Boolean(binding.value)
    el.addEventListener('pointermove', onMove, { passive: true })
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('animationend', onAnimEnd)
  },
  updated(el, binding) {
    el.__rippleDisabled = isRef(binding.value)
      ? () => binding.value.value
      : typeof binding.value === 'function'
        ? binding.value
        : () => Boolean(binding.value)
  },
  unmounted(el) {
    delete el.dataset.ripple
    el.removeEventListener('pointermove', onMove)
    el.removeEventListener('pointerdown', onDown)
    el.removeEventListener('animationend', onAnimEnd)
  },
}

export default vRipple
