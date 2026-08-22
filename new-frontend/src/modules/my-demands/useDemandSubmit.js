import { ref } from 'vue'
import { api } from '@/core/api.js'
import { dhInvalidate } from '@/core/datahub.js'
import { MY_DEMANDS_COPY } from '@/constants/m-my-demands.js'

/**
 * useDemandSubmit - create/update demand write path (M8-12)
 * -------------------------------------------------------
 * - POST /api/demands (create) / PUT /api/demands/:id (update, I-36 cover-style).
 * - F6 busy lock: submitting guards against double submit.
 * - F7: on success dhInvalidate('demands') so the list refetches on next read.
 * - Returns { ok, message }; errors surface via ApiError.message (server code/copy/message).
 */
export function useDemandSubmit() {
  const submitting = ref(false)

  async function submit({ payload, demandId = null }) {
    if (submitting.value) return { ok: false, message: '' }
    submitting.value = true
    try {
      if (demandId != null) {
        await api(`/demands/${demandId}`, { method: 'PUT', body: payload })
      } else {
        await api('/demands', { method: 'POST', body: payload })
      }
      dhInvalidate('demands')
      return { ok: true }
    } catch (e) {
      return { ok: false, message: (e && e.message) || MY_DEMANDS_COPY.SUBMIT_FAILED }
    } finally {
      submitting.value = false
    }
  }

  return { submitting, submit }
}
