import { api } from '@/core/api.js'
import { emptyDemandForm, parseTimeSlots } from './demandForm.js'

/**
 * useDemandEditPrefill - edit-mode prefill (M8-13)
 * -------------------------------------------------------
 * - loadDemand(id): force-fresh I-38 GET /api/demands/:id (not cached; a stale list row
 *   must never drive the edit form). 403 (not owner) surfaces as ApiError.
 * - prefill(form, row): per-value echo of every I-38 field into the reactive form
 *   (mode/score/grade preserved exactly; expectedTime string parsed back to slots).
 */
export function useDemandEditPrefill() {
  async function loadDemand(id) {
    const data = await api(`/demands/${id}`)
    return data && data.demand ? data.demand : data
  }

  function prefill(form, row) {
    const base = emptyDemandForm()
    Object.keys(base).forEach((k) => {
      if (k === 'expectedTime') return
      form[k] = row[k] != null ? row[k] : base[k]
    })
    form.currentScore = row.currentScore != null ? String(row.currentScore) : ''
    form.currentScoreFull = row.currentScoreFull != null ? String(row.currentScoreFull) : ''
    form.budgetMin = row.budgetMin != null ? String(row.budgetMin) : ''
    form.budgetMax = row.budgetMax != null ? String(row.budgetMax) : ''
    form.preferredTags = Array.isArray(row.preferredTags) ? row.preferredTags.slice() : []
    form.expectedTime = parseTimeSlots(row.expectedTime)
  }

  return { loadDemand, prefill }
}
