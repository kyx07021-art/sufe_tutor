import { onBeforeUnmount, onMounted, watch } from 'vue'

/**
 * useGalleryWheel - corridor wheel-to-horizontal scroll (N-F5 carried into the
 * new-site landing; PA-2a 3)
 * ----------------------------------------------------------------------------
 * - Hovering the corridor and rolling the mouse wheel scrolls the corridor
 *   horizontally instead of the page: the vertical wheel delta maps onto
 *   scrollLeft and the default page scroll is prevented while the pointer is
 *   over the viewport, so page scrollY stays put (the corridor owns the gesture).
 * - deltaMode normalization: line mode (Firefox) multiplies by LINE_H and page
 *   mode by the viewport height to keep the feel consistent with pixel mode.
 * - Non-passive listener (preventDefault is the point). Corridor is the only
 *   interception surface: the listener lives on the viewport element, so wheel
 *   events anywhere else still scroll the page natively.
 * - Idempotent bind/detach + F3 cleanup on unmount, mirroring useGalleryDrag.
 */
export function useGalleryWheel(viewportRef) {
  const LINE_H = 24
  let el = null

  function onWheel(e) {
    if (!el) return
    const factor = e.deltaMode === 1 ? LINE_H : e.deltaMode === 2 ? el.clientHeight : 1
    el.scrollLeft += (e.deltaX || e.deltaY) * factor
    e.preventDefault()
  }

  function detach() {
    if (!el) return
    el.removeEventListener('wheel', onWheel)
    el = null
  }

  function bind() {
    const next = viewportRef.value
    if (next === el) return
    detach()
    el = next
    if (!el) return
    el.addEventListener('wheel', onWheel, { passive: false })
  }

  onMounted(() => bind())

  watch(viewportRef, () => bind(), { flush: 'post' })

  onBeforeUnmount(() => detach())

  return {}
}
