import { onBeforeUnmount, ref, watch } from 'vue'

/**
 * useScrollFade - fade-mask state for scrollable containers
 * -------------------------------------------------------
 * - Used by modal A1 / step modal / confirm modal A1: when the container is scrollable, top/bottom white fade masks appear.
 * - The container element may be conditionally rendered (modal v-if), so it watches elRef (flush: post) to hook/unhook when the element appears/disappears.
 * - Returns { scrollable, atTop, atBottom, update }.
 */
export function useScrollFade(elRef) {
  const scrollable = ref(false)
  const atTop = ref(true)
  const atBottom = ref(true)
  let ro = null
  let el = null

  function update() {
    if (!el) return
    scrollable.value = el.scrollHeight > el.clientHeight + 1
    atTop.value = el.scrollTop <= 1
    atBottom.value = el.scrollTop + el.clientHeight >= el.scrollHeight - 1
  }

  function onScroll() {
    update()
  }

  watch(
    elRef,
    (val, old) => {
      if (old) {
        old.removeEventListener('scroll', onScroll)
        if (ro) {
          ro.disconnect()
          ro = null
        }
      }
      el = val
      if (val) {
        val.addEventListener('scroll', onScroll, { passive: true })
        update()
        if (typeof ResizeObserver !== 'undefined') {
          ro = new ResizeObserver(() => update())
          ro.observe(val)
        }
      }
    },
    { flush: 'post' },
  )

  onBeforeUnmount(() => {
    if (el) el.removeEventListener('scroll', onScroll)
    if (ro) ro.disconnect()
  })

  return { scrollable, atTop, atBottom, update }
}
