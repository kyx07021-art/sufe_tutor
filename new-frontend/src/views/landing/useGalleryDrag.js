import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

/**
 * useGalleryDrag - M1-07a corridor drag
 * -------------------------------------------------------
 * - Pointer-based drag on the corridor viewport (mouse + touch via Pointer Events).
 * - Coordinate contract: pointer math captures the starting position exactly once at
 *   drag start (startX / startScroll), never per-move. Only clientX deltas are used,
 *   which are origin-independent, so no rect conversion is required at all.
 * - Only reads/writes scrollLeft; M1-06 owns the modulo wrap into [seqW, 2*seqW) on
 *   its passive scroll listener, so a full-period jump preserves the on-screen picture.
 * - Toggles the is-dragging class on the viewport (CSS cursor: grabbing is wired by
 *   the lead during assembly); zero inline style attributes, zero stopPropagation.
 * - Pointer capture keeps the drag alive even when the pointer leaves the viewport and
 *   guarantees it does not fire outside it; lostpointercapture ends the drag.
 * - Returns { isDragging }.
 */
export function useGalleryDrag(viewportRef) {
  const isDragging = ref(false)
  let el = null
  let pointerId = null
  let startX = 0
  let startScroll = 0

  function onPointerDown(e) {
    if (!el || isDragging.value) return
    if (e.button !== 0) return
    pointerId = e.pointerId
    startX = e.clientX
    startScroll = el.scrollLeft
    el.setPointerCapture(e.pointerId)
    el.classList.add('is-dragging')
    isDragging.value = true
    e.preventDefault()
  }

  function onPointerMove(e) {
    if (!el || !isDragging.value) return
    el.scrollLeft = startScroll + (startX - e.clientX)
  }

  function onPointerUp() {
    if (!el || !isDragging.value) return
    el.classList.remove('is-dragging')
    isDragging.value = false
    if (pointerId !== null) {
      if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId)
      pointerId = null
    }
  }

  function detach() {
    if (!el) return
    if (isDragging.value) onPointerUp()
    el.removeEventListener('pointerdown', onPointerDown)
    el.removeEventListener('pointermove', onPointerMove)
    el.removeEventListener('pointerup', onPointerUp)
    el.removeEventListener('pointercancel', onPointerUp)
    el.removeEventListener('lostpointercapture', onPointerUp)
    el = null
  }

  function bind() {
    const next = viewportRef.value
    if (next === el) return
    detach()
    el = next
    if (!el) return
    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove, { passive: true })
    el.addEventListener('pointerup', onPointerUp)
    el.addEventListener('pointercancel', onPointerUp)
    el.addEventListener('lostpointercapture', onPointerUp)
  }

  onMounted(() => bind())

  watch(viewportRef, () => bind(), { flush: 'post' })

  onBeforeUnmount(() => detach())

  return { isDragging }
}
