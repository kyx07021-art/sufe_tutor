import { onBeforeUnmount, onMounted, watch } from 'vue'

/**
 * useGalleryShrink - corridor edge linear shrink (M1-09)
 * --------------------------------------------------------------------
 * - Images shrink linearly as their center moves away from the viewport's
 *   CENTER AXIS; the shrink is direction-independent (depends only on the
 *   x-coordinate) and never reaches 0 (lower bound --gallery-shrink-min).
 * - Formula: shrink starts when the image center passes the viewport edge
 *   (t0 = vw/2) and reaches the minimum when the image is fully off the edge
 *   plus the mask band (t1 = t0 + imgW/2 + maskW).
 * - Only the CSSOM data channel is used: each image gets `--g-scale`; the
 *   `transform: scale(var(--g-scale, 1))` CSS lives in LandingGallery.vue
 *   (wired by the module lead). Never sets transform/opacity directly.
 * - Values are read from tokens at runtime (single source) with safe fallbacks.
 */
export function useGalleryShrink(viewportRef) {
  let el = null
  let raf = 0
  let minScale = 0.72
  let maskW = 50

  function readTokens() {
    if (typeof document === 'undefined') return
    const cs = getComputedStyle(document.documentElement)
    const ms = parseFloat(cs.getPropertyValue('--gallery-shrink-min'))
    const mw = parseFloat(cs.getPropertyValue('--gallery-mask-w'))
    if (Number.isFinite(ms)) minScale = ms
    if (Number.isFinite(mw)) maskW = mw
  }

  function apply() {
    raf = 0
    if (!el || !el.querySelector) return
    const er = el.getBoundingClientRect()
    if (!er.width) return
    const cx = er.left + er.width / 2
    const t0 = er.width / 2
    const imgs = el.querySelectorAll('img')
    for (const img of imgs) {
      const ir = img.getBoundingClientRect()
      const ix = ir.left + ir.width / 2
      const d = Math.abs(ix - cx)
      const t1 = t0 + ir.width / 2 + maskW
      const t = Math.max(0, Math.min(1, (d - t0) / (t1 - t0 || 1)))
      const scale = 1 - (1 - minScale) * t
      img.style.setProperty('--g-scale', scale.toFixed(3))
    }
  }

  function schedule() {
    if (raf) return
    raf = requestAnimationFrame(apply)
  }

  function onScroll() {
    schedule()
  }

  function onResize() {
    schedule()
  }

  function bind(target) {
    el = target
    if (!el) return
    readTokens()
    el.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onResize)
    schedule()
  }

  function unbind() {
    if (!el) return
    el.removeEventListener('scroll', onScroll)
    window.removeEventListener('resize', onResize)
    if (raf) cancelAnimationFrame(raf)
    raf = 0
    el = null
  }

  watch(viewportRef, (val, old) => {
    if (old) unbind()
    if (val) bind(val)
  }, { flush: 'post' })

  onMounted(() => {
    if (viewportRef.value) bind(viewportRef.value)
  })

  onBeforeUnmount(() => {
    unbind()
  })

  return { update: apply }
}
