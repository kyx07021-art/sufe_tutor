/**
 * demands-service.js - B1-2a I-34 data loading
 * ---------------------------------------------
 * - Uses the core api() single point (@/core/api.js, contract: fetch lives there only).
 * - Sort/order are sent to the server (B1-3a "sort select -> server sort param reload");
 *   filters are applied locally (B1-5d2 immediate-apply semantics), so they are NOT
 *   sent here.
 */
import { api } from '@/core/api.js'
import { mapDemandList } from './demands-model.js'

/**
 * Load the demand plaza list.
 * @param {{ sort?: 'match'|'price', order?: 'asc'|'desc' }} [query]
 * @returns {Promise<{ items: Array, total: number }>}
 */
export async function loadDemands({ sort = 'match', order = 'desc' } = {}) {
  const params = new URLSearchParams()
  params.set('sort', sort)
  params.set('order', order)
  const json = await api(`/demands?${params.toString()}`)
  return {
    items: mapDemandList(json && json.items),
    total: json && json.total ? json.total : 0,
  }
}
