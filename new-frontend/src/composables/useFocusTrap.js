import { onBeforeUnmount, onMounted } from 'vue'

/**
 * useFocusTrap - modal focus trap (Tab cycles within the container, Shift+Tab reversed)
 * - On modal open, focus should first move to the first focusable element (handled by the component itself).
 */
export function useFocusTrap(elRef, { active = null } = {}) {
  const FOCUSABLE =
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

  function onKeyDown(e) {
    if (e.key !== 'Tab') return
    if (active && !active.value) return
    const el = elRef.value
    if (!el) return
    const items = el.querySelectorAll(FOCUSABLE)
    if (!items.length) {
      e.preventDefault()
      return
    }
    const first = items[0]
    const last = items[items.length - 1]
    if (e.shiftKey && (document.activeElement === first || !el.contains(document.activeElement))) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && (document.activeElement === last || !el.contains(document.activeElement))) {
      e.preventDefault()
      first.focus()
    }
  }

  onMounted(() => document.addEventListener('keydown', onKeyDown))
  onBeforeUnmount(() => document.removeEventListener('keydown', onKeyDown))
}
