import { reactive } from 'vue'

/**
 * useToast - toast singleton
 * -------------------------------------------------------
 * - UiToast.vue mounts once and consumes toastState; any component calling showToast pops one up.
 * - Auto-dismisses after duration seconds; 0 keeps it (needs manual dismiss).
 */

export const toastState = reactive({ items: [] })
let seq = 0

export function showToast(message, { duration = 2600 } = {}) {
  const id = ++seq
  toastState.items.push({ id, message })
  if (duration > 0) {
    window.setTimeout(() => dismissToast(id), duration)
  }
}

export function dismissToast(id) {
  const i = toastState.items.findIndex((t) => t.id === id)
  if (i >= 0) toastState.items.splice(i, 1)
}

export function useToast() {
  return { showToast, dismissToast, state: toastState }
}
