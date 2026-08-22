import { computed, nextTick, onBeforeUnmount, reactive } from 'vue'

/**
 * useAnchoredPanel - panel positioned relative to the trigger element (fixed positioning + viewport clamping)
 * -------------------------------------------------------
 * - Used by dropdown panels A/B. The panel is Teleported to body; position is computed with fixed + left/top.
 * - align: 'down' | 'up' | 'left' | 'right' (float-in direction)
 * - alignX: 'left' | 'center' | 'right' (horizontal alignment, only applies to down/up)
 * - matchWidth: panel width = trigger element width (common for dropdown buttons)
 * - gap: spacing between panel and trigger
 * - place() is called after the panel mounts / when options change / on scroll / on resize.
 * - Returns a style (computed) for :style binding (explicit stringification, avoiding reactive :style binding uncertainty).
 */
export function useAnchoredPanel(panelRef, triggerRef, {
  align = 'down',
  alignX = 'left',
  gap = 8,
  matchWidth = false,
  minWidth = true,
} = {}) {
  const pos = reactive({
    left: -9999,
    top: -9999,
    width: '',
    visibility: 'hidden',
  })

  /** explicit stringification: number + px; invalid value falls back off-screen (invisible but not exploding) */
  const style = computed(() => ({
    left: Number.isFinite(pos.left) ? pos.left + 'px' : '-9999px',
    top: Number.isFinite(pos.top) ? pos.top + 'px' : '-9999px',
    width: pos.width || undefined,
    visibility: pos.visibility,
  }))

  let placed = false

  function place() {
    const panel = panelRef.value
    const trigger = triggerRef.value
    if (!panel || !trigger) return
    const tr = trigger.getBoundingClientRect()
    const pw = panel.offsetWidth
    const ph = panel.offsetHeight
    const vw = window.innerWidth
    const vh = window.innerHeight
    const dir = typeof align === 'string' ? align : align.value
    const ax = typeof alignX === 'string' ? alignX : alignX.value

    let left = 0
    let top = 0
    if (dir === 'up') {
      left = ax === 'right' ? tr.right - pw : ax === 'center' ? tr.left + tr.width / 2 - pw / 2 : tr.left
      top = tr.top - ph - gap
    } else if (dir === 'left') {
      left = tr.left - pw - gap
      top = tr.top
    } else if (dir === 'right') {
      left = tr.right + gap
      top = tr.top
    } else {
      // down
      left = ax === 'right' ? tr.right - pw : ax === 'center' ? tr.left + tr.width / 2 - pw / 2 : tr.left
      top = tr.bottom + gap
    }

    // viewport clamp (4px margin)
    left = Math.max(4, Math.min(left, vw - pw - 4))
    top = Math.max(4, Math.min(top, vh - ph - 4))

    pos.left = Math.round(left)
    pos.top = Math.round(top)
    pos.width = matchWidth ? tr.width + 'px' : ''
    if (minWidth && (dir === 'down' || dir === 'up') && !matchWidth) {
      if (pw < tr.width) pos.width = tr.width + 'px'
    }
    pos.visibility = 'visible'
    placed = true
  }

  async function placeNextTick() {
    await nextTick()
    place()
  }

  function onViewportChange() {
    if (placed) place()
  }

  onBeforeUnmount(() => {
    window.removeEventListener('scroll', onViewportChange, true)
    window.removeEventListener('resize', onViewportChange)
  })

  function bind() {
    window.addEventListener('scroll', onViewportChange, true)
    window.addEventListener('resize', onViewportChange)
  }

  function unbind() {
    window.removeEventListener('scroll', onViewportChange, true)
    window.removeEventListener('resize', onViewportChange)
  }

  return { style, pos, place, placeNextTick, bind, unbind }
}
