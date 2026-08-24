import { isRef } from 'vue'

/**
 * createRipple - shared ripple core (single-path dynamics; the ripple IS the mask)
 * -------------------------------------------------------------------------------
 * Both `useRipple` (composable) and `vRipple` (directive) are thin shells over this
 * one core, so the click/keyboard path and the hover path behave identically across
 * every component (UiButton / UiCheckButton / UiCard / UiComboInput / UiCaptchaInput /
 * UiVariableInputSet).
 *
 * Dynamics model (user spec, 2026-08-24):
 * - Origin converges: on click the circle center P(t) travels from the trigger point
 *   P0 along the P0->button-center C line to C, while the radius r(t) grows; the
 *   terminal state is r(1) = hypot(w,h)/2 + 2px margin, so the circle covers the whole
 *   button from any click point (the old fixed-origin model left the far corner
 *   outside the circle and sprayed an arc beyond the button).
 * - Frame rate independent: rAF + performance.now delta drives three CSSOM variables
 *   (--mx/--my/--r) every frame; the circle body only touches `transform`
 *   (translate(-50%,-50%) scale(var(--r))) - compositor-only, zero layout.
 * - Fade-in is compressed to the first half (opacity 0->1 over <=T/2, then stays 1):
 *   the ripple spreads fully visible and then STAYS - it is the final mask. It is
 *   cleared on pointerleave / blur (mouse leaves or focus leaves). No second
 *   persistent overlay element (user: "ripple == mask, no dual elements").
 * - Disabled skips every coordinate write and ripple (CSS .is-disabled hides both layers).
 * - Reduced motion shows the mask instantly at full coverage (no animation).
 *
 * Contract 6: all style writes go through el.style.setProperty (CSSOM data channel,
 * CSP style-src-attr 'none' compatible). Zero inline style attributes, zero CJK.
 */
export function createRipple(el, { disabled = null } = {}) {
  // Normalize the disabled source: () => boolean | ref | boolean | null.
  const resolveDisabled = () => {
    if (typeof disabled === 'function') return disabled()
    if (isRef(disabled)) return Boolean(disabled.value)
    return Boolean(disabled)
  }

  let rafId = 0
  let active = false
  let startTime = 0
  let dur = 0
  let ox = 0
  let oy = 0 // origin (trigger point, component-local)
  let cx = 0
  let cy = 0 // button center (component-local)
  let termR = 0 // terminal radius (unitless px, for scale())

  function isBlocked() {
    return el.disabled || resolveDisabled()
  }

  /** Refresh --btn-d (hover cover diameter = diagonal) and --r (terminal radius). */
  function updateCover() {
    const w = el.offsetWidth || 0
    const h = el.offsetHeight || 0
    const diag = Math.hypot(w, h)
    el.style.setProperty('--btn-d', diag.toFixed(1) + 'px')
    el.style.setProperty('--r', (diag / 2 + 2).toFixed(1))
  }

  function toLocal(clientX, clientY) {
    const r = el.getBoundingClientRect()
    return [clientX - r.left, clientY - r.top]
  }

  function setOrigin(lx, ly) {
    el.style.setProperty('--mx', Math.round(lx) + 'px')
    el.style.setProperty('--my', Math.round(ly) + 'px')
  }

  function readDuration() {
    const v = getComputedStyle(el).getPropertyValue('--btn-dur-click').trim()
    const n = parseFloat(v)
    return Number.isFinite(n) && n > 0 ? n : 200
  }

  function frame(now) {
    if (!active) return
    const t = Math.min(1, (now - startTime) / dur)
    // easeOutCubic: origin leaves fast, settles onto the center so every edge
    // arrives almost together (the far corner accelerates to catch up).
    const k = 1 - Math.pow(1 - t, 3)
    el.style.setProperty('--mx', (ox + (cx - ox) * k).toFixed(1) + 'px')
    el.style.setProperty('--my', (oy + (cy - oy) * k).toFixed(1) + 'px')
    el.style.setProperty('--r', (termR * k).toFixed(2))
    if (t < 1) {
      rafId = requestAnimationFrame(frame)
    } else {
      active = false
    }
  }

  /** Remove the ripple (the mask). Called on pointerleave / blur. */
  function clearRipple() {
    active = false
    cancelAnimationFrame(rafId)
    el.classList.remove('is-rippling')
  }

  /**
   * Start the ripple from (lx, ly) in component-local coordinates.
   * lx === undefined -> button center (keyboard activation).
   */
  function ripple(lx, ly) {
    if (isBlocked()) return
    const w = el.offsetWidth || 0
    const h = el.offsetHeight || 0
    updateCover()
    cx = w / 2
    cy = h / 2
    ox = lx === undefined ? cx : lx
    oy = ly === undefined ? cy : ly
    termR = parseFloat(el.style.getPropertyValue('--r')) || Math.hypot(w, h) / 2 + 2
    el.classList.remove('is-rippling')
    void el.offsetWidth
    setOrigin(ox, oy)
    el.style.setProperty('--r', '0')
    el.classList.add('is-rippling')
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // reduced motion: the mask appears instantly at full coverage (no spread).
      setOrigin(cx, cy)
      el.style.setProperty('--r', termR.toFixed(1))
      return
    }
    dur = readDuration()
    active = true
    startTime = performance.now()
    cancelAnimationFrame(rafId)
    rafId = requestAnimationFrame(frame)
  }

  function onPointerMove() {
    if (isBlocked()) return
    // Refresh cover on size change (UiCheckButton stretches on select); the origin
    // never chases the mouse (the mask is a button-own overlay).
    updateCover()
  }

  function onPointerDown(e) {
    if (e.button !== 0) return
    if (isBlocked()) return
    const p = toLocal(e.clientX, e.clientY)
    ripple(p[0], p[1])
  }

  function onPointerLeave() {
    // The ripple IS the mask: moving away clears it (mouse leaves the overlay).
    clearRipple()
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
      // The animation is just the fade-in; the ripple stays as the mask
      // (animation-fill-mode: forwards) until pointerleave/blur clears it.
      active = false
    }
  }

  function bind() {
    el.addEventListener('pointermove', onPointerMove, { passive: true })
    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointerleave', onPointerLeave)
    el.addEventListener('blur', onPointerLeave)
    document.addEventListener('keydown', onKeyDown)
    el.addEventListener('animationend', onAnimationEnd)
    updateCover()
  }

  function unbind() {
    active = false
    cancelAnimationFrame(rafId)
    el.classList.remove('is-rippling')
    el.removeEventListener('pointermove', onPointerMove)
    el.removeEventListener('pointerdown', onPointerDown)
    el.removeEventListener('pointerleave', onPointerLeave)
    el.removeEventListener('blur', onPointerLeave)
    document.removeEventListener('keydown', onKeyDown)
    el.removeEventListener('animationend', onAnimationEnd)
  }

  return { bind, unbind, updateCover, ripple, clearRipple, isBlocked }
}
