import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

/**
 * useGalleryDrift - corridor idle auto-scroll with pause/resume (M1-07b)
 * --------------------------------------------------------------------
 * - Continuously increases `scrollLeft` by `speed` px/second (leftward image
 *   motion), time-based via rAF + performance.now delta (frame-rate independent).
 * - Pauses while: the pointer hovers the viewport, a drag is in progress
 *   (viewport has the `is-dragging` class added by M1-07a), the document is
 *   hidden, or the corridor is scrolled out of view (IntersectionObserver).
 * - Respects prefers-reduced-motion: never drifts when reduced (and stops if it
 *   flips while running).
 * - The M1-06 scroll listener owns the scrollLeft modulo wrap; this composable
 *   only ever increases scrollLeft.
 */
export function useGalleryDrift(viewportRef, { speed = 40 } = {}) {
  const isDrifting = ref(false)

  let el = null
  let raf = 0
  let lastTs = 0
  let hovering = false
  let inView = true
  let observer = null
  let reduced = false

  const reducedQuery = typeof window !== 'undefined'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null

  function start() {
    if (!el || reduced || !inView || hovering || document.hidden || raf) return
    isDrifting.value = true
    lastTs = performance.now()
    raf = requestAnimationFrame(tick)
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf)
    raf = 0
    if (isDrifting.value) isDrifting.value = false
  }

  function tick(ts) {
    raf = 0
    if (reduced || !inView || hovering || document.hidden) return
    const delta = (ts - lastTs) / 1000
    lastTs = ts
    el.scrollLeft += speed * delta
    raf = requestAnimationFrame(tick)
  }

  function onEnter() {
    hovering = true
    stop()
  }

  function onLeave() {
    hovering = false
    start()
  }

  function onVisibility() {
    if (document.hidden) stop()
    else start()
  }

  function bind(target) {
    el = target
    if (!el) return
    el.addEventListener('pointerenter', onEnter)
    el.addEventListener('pointerleave', onLeave)
    document.addEventListener('visibilitychange', onVisibility)
    if ('IntersectionObserver' in window) {
      observer = new IntersectionObserver(
        (entries) => {
          inView = entries[0]?.isIntersecting ?? true
          if (inView) start()
          else stop()
        },
        { threshold: 0 },
      )
      observer.observe(el)
    }
    if (reducedQuery) {
      reduced = reducedQuery.matches
      reducedQuery.addEventListener('change', onReducedChange)
    }
    start()
  }

  function onReducedChange() {
    reduced = reducedQuery.matches
    if (reduced) stop()
    else start()
  }

  function unbind() {
    if (!el) return
    el.removeEventListener('pointerenter', onEnter)
    el.removeEventListener('pointerleave', onLeave)
    document.removeEventListener('visibilitychange', onVisibility)
    if (observer) {
      observer.disconnect()
      observer = null
    }
    if (reducedQuery) reducedQuery.removeEventListener('change', onReducedChange)
    stop()
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

  return { isDrifting }
}
