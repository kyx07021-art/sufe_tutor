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
 * - Root zoom (--ui-scale via SettingsAppearance) is respected: the trigger rect is in
 *   visual space, the fixed panel lives in layout space, so the anchor is divided by the
 *   zoom factor (AK-N-H2). Open panels are re-placed on a scale change because the
 *   settings control dispatches a synthetic window resize (the same listener used here).
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
  // Natural (un-stretched) panel width in layout px, cached per mounted panel element.
  // The minWidth/matchWidth stretch overwrites the panel width, so offsetWidth can no
  // longer be trusted after the first place; caching the first measurement keeps the
  // stretch decision stable across scroll / resize / zoom re-places.
  let naturalPanel = null
  let naturalW = null

  function place() {
    const panel = panelRef.value
    const trigger = triggerRef.value
    if (!panel || !trigger) return
    const tr = trigger.getBoundingClientRect()
    // Root zoom (--ui-scale on <html>) scales the whole UI: getBoundingClientRect is
    // in visual (post-zoom) space while fixed left/top/width live in layout (pre-zoom)
    // space. Run all anchor math in visual space, then divide the final left/top/width
    // by the zoom factor so the fixed panel is not scaled a second time (AK-N-H2).
    const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1
    const dir = typeof align === 'string' ? align : align.value
    const ax = typeof alignX === 'string' ? alignX : alignX.value

    if (panel !== naturalPanel) {
      naturalPanel = panel
      // A stale minWidth/matchWidth width from a previous open is still held in the
      // reactive pos.width, so this fresh element may mount already stretched. Clear
      // the inline width on the element itself (CSSOM data channel) so offsetWidth
      // reads the natural unstretched width; place() re-applies the correct width
      // for this open below.
      panel.style.width = ''
      naturalW = panel.offsetWidth
    }
    const pwV = naturalW * zoom
    const phV = panel.offsetHeight * zoom
    const twV = tr.width

    // effective visual width after the optional stretch up to the trigger width
    const stretch = matchWidth || (minWidth && (dir === 'down' || dir === 'up') && !matchWidth && pwV < twV)
    const effW = stretch ? twV : pwV

    let left = 0
    let top = 0
    if (dir === 'up') {
      left = ax === 'right' ? tr.right - effW : ax === 'center' ? tr.left + tr.width / 2 - effW / 2 : tr.left
      top = tr.top - phV - gap
    } else if (dir === 'left') {
      left = tr.left - effW - gap
      top = tr.top
    } else if (dir === 'right') {
      left = tr.right + gap
      top = tr.top
    } else {
      // down
      left = ax === 'right' ? tr.right - effW : ax === 'center' ? tr.left + tr.width / 2 - effW / 2 : tr.left
      top = tr.bottom + gap
    }

    // viewport clamp (4px visual margin, using the effective width)
    left = Math.max(4, Math.min(left, window.innerWidth - effW - 4))
    top = Math.max(4, Math.min(top, window.innerHeight - phV - 4))

    pos.left = Math.round(left / zoom)
    pos.top = Math.round(top / zoom)
    pos.width = stretch ? effW / zoom + 'px' : ''
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
