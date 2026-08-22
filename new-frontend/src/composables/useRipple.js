import { onBeforeUnmount, onMounted } from 'vue'

/**
 * useRipple - button/card ripple coordinate tracking + click dark spread
 * -------------------------------------------------------
 * - CSSOM data channel (el.style.setProperty), CSP style-src-attr 'none' compatible.
 * - Coordinate contract: always "component-local coordinates" (left/top relative to the component), consistent with the CSS --mx/--my semantics.
 *   pointermove/pointerdown each do one rect conversion; keyboard has no pointer -> component center.
 * - Click dark layer: add .is-rippling -> one-shot keyframes (ui-ripple) spread to fill + fade back;
 *   animationend removes the class. ui-ripple is defined globally in tokens.css (no scoped suffix);
 *   we still match animationName by prefix as a defensive measure.
 * - --btn-d is recomputed on every cover call (and on pointermove) so size changes after the first
 *   render (e.g. UiCheckButton stretching on select) still get a fully covering ripple circle.
 * - disabled skips all coordinate writes and ripples (disabled visuals are handled by CSS .is-disabled).
 */
export function useRipple(elRef, { disabled = null } = {}) {
  let el = null

  function updateCover() {
    if (!el) return
    const d = Math.hypot(el.offsetWidth || 0, el.offsetHeight || 0) * 2
    el.style.setProperty('--btn-d', d.toFixed(1) + 'px')
  }

  function toLocal(clientX, clientY) {
    const r = el.getBoundingClientRect()
    return [clientX - r.left, clientY - r.top]
  }

  function setPoint(lx, ly) {
    el.style.setProperty('--mx', Math.round(lx) + 'px')
    el.style.setProperty('--my', Math.round(ly) + 'px')
  }

  function isBlocked() {
    return el.disabled || (disabled && disabled.value)
  }

  function ripple(lx, ly) {
    if (isBlocked()) return
    updateCover()
    if (lx !== undefined) setPoint(lx, ly)
    el.classList.remove('is-rippling')
    void el.offsetWidth
    el.classList.add('is-rippling')
  }

  function onPointerMove(e) {
    if (isBlocked()) return
    updateCover()
    const p = toLocal(e.clientX, e.clientY)
    setPoint(p[0], p[1])
  }

  function onPointerDown(e) {
    if (e.button !== 0) return
    if (isBlocked()) return
    const p = toLocal(e.clientX, e.clientY)
    ripple(p[0], p[1])
  }

  function onKeyDown(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return
    if (e.repeat) return
    if (document.activeElement !== el) return
    if (e.key === ' ') e.preventDefault()
    ripple(el.offsetWidth / 2, el.offsetHeight / 2)
  }

  function onAnimationEnd(e) {
    if (e.animationName && e.animationName.indexOf('ui-ripple') === 0 && e.target === el) {
      el.classList.remove('is-rippling')
    }
  }

  onMounted(() => {
    el = elRef.value
    if (!el) return
    updateCover()
    el.addEventListener('pointermove', onPointerMove, { passive: true })
    el.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('animationend', onAnimationEnd)
  })

  onBeforeUnmount(() => {
    if (!el) return
    el.removeEventListener('pointermove', onPointerMove)
    el.removeEventListener('pointerdown', onPointerDown)
    document.removeEventListener('keydown', onKeyDown)
    document.removeEventListener('animationend', onAnimationEnd)
  })
}
