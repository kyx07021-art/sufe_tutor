import { ref } from 'vue'
import { api } from '@/core/api.js'
import { dhFetch, dhInvalidate } from '@/core/datahub.js'
import { MY_DEMANDS_COPY } from '@/constants/m-my-demands.js'

/**
 * useDemands - A2 my-demands list data wiring (M8-02)
 * -------------------------------------------------------
 * - Consumes I-33 GET /api/demands/mine (login+student), response { items: [...] } (per-subject row shape).
 * - dhFetch('demands') cache: page reads and post-write invalidate share the same cache key (F7).
 *   401 -> api() single point clears token + dispatches 'auth:dead' (M2 fallback); silent stop here (loading set false).
 * - Exposes: demands / loading / error / load(force) / invalidate().
 */
export function useDemands() {
  const demands = ref([])
  const loading = ref(false)
  const error = ref('')

  async function load(force = false) {
    loading.value = true
    error.value = ''
    try {
      const data = await dhFetch(
        'demands',
        () => api('/demands/mine'),
        { force },
      )
      demands.value = Array.isArray(data?.items) ? data.items : []
    } catch (e) {
      if (e && e.status === 401) {
        // token cleared by api() single point; M2 routes to login. Silent stop here.
        demands.value = []
        dhInvalidate('demands')
      } else {
        error.value = (e && e.message) || MY_DEMANDS_COPY.LOAD_FAILED
      }
    } finally {
      loading.value = false
    }
  }

  /** F7 single-point post-write invalidation (M8-12/14 call after create/update/delete; next read naturally refetches). */
  function invalidate() {
    dhInvalidate('demands')
  }

  return { demands, loading, error, load, invalidate }
}
