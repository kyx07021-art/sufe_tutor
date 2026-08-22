import { ref } from 'vue'
import { api } from '@/core/api.js'
import { dhInvalidate } from '@/core/datahub.js'
import { MY_DEMANDS_COPY } from '@/constants/m-my-demands.js'

/**
 * useDemandDelete - delete demand write path (M8-14)
 * -------------------------------------------------------
 * - DELETE /api/demands/:id (I-37, owner guard). Confirmation modal is the caller's
 *   concern (ConfirmModal); this composable owns the request + F6 busy + F7 invalidate.
 * - Returns { ok, message }.
 */
export function useDemandDelete() {
  const deleting = ref(false)

  async function remove(id) {
    if (deleting.value) return { ok: false, message: '' }
    deleting.value = true
    try {
      await api(`/demands/${id}`, { method: 'DELETE' })
      dhInvalidate('demands')
      return { ok: true }
    } catch (e) {
      return { ok: false, message: (e && e.message) || MY_DEMANDS_COPY.DELETE_FAILED }
    } finally {
      deleting.value = false
    }
  }

  return { deleting, remove }
}
