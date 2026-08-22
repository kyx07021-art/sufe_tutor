import { reactive, ref, computed } from 'vue'
import { emptyDemandForm, demandPayload } from './demandForm.js'
import { useDemandSubmit } from './useDemandSubmit.js'
import { useDemandEditPrefill } from './useDemandEditPrefill.js'
import { MY_DEMANDS_COPY } from '@/constants/m-my-demands.js'

/**
 * useDemandForm - step-modal form controller (M8-06 core)
 * -------------------------------------------------------
 * - Owns the reactive form, current step, open state, editing id, and per-step
 *   required gates (step rules live here; each step component documents its fields).
 * - openCreate(): reset + open at page 0.
 * - openEdit(demand): force-fresh I-38 prefill (M8-13) then open (edit-aware initial page).
 * - canNext drives the UiStepModal right-button gray-out (the ONLY gate condition).
 * - submitForm(): M8-12 write path (POST/PUT + F6 busy + F7 invalidate), closes on success.
 */
export function useDemandForm() {
  const form = reactive(emptyDemandForm())
  const open = ref(false)
  const current = ref(0)
  const editingId = ref(null) // null = create
  const submitting = ref(false)
  const submitError = ref('')

  const { submit } = useDemandSubmit()
  const { loadDemand, prefill } = useDemandEditPrefill()

  /** Per-step required rules (index = step). Rules reference the live reactive form. */
  const stepValidators = [
    (f) => !!(f.grade && f.province), // step 0: grade + province
    (f) => !!(f.subject && f.teachingMethod), // step 1: subject + method
    (f) => true, // step 2: score optional (no gate)
    (f) => {
      // step 3: address required only when method is offline/both (M8-10a)
      const needsAddress = f.teachingMethod === 'offline' || f.teachingMethod === 'both'
      return !needsAddress || !!f.addressArea
    },
    (f) => {
      // step 4: budget required + intro <= 200
      return !!(f.budgetMin && f.budgetMax) && (f.additionalInfo || '').length <= 200
    },
  ]

  const canNext = computed(() => {
    const v = stepValidators[current.value]
    return v ? v(form) : true
  })

  function reset() {
    Object.assign(form, emptyDemandForm())
    current.value = 0
    editingId.value = null
    submitError.value = ''
  }

  async function openCreate() {
    reset()
    open.value = true
  }

  async function openEdit(demand) {
    reset()
    const id = demand && demand.id
    if (id == null) return
    editingId.value = id
    try {
      const row = await loadDemand(id) // force-fresh I-38 (M8-13)
      prefill(form, row)
      open.value = true
    } catch (e) {
      submitError.value = (e && e.message) || MY_DEMANDS_COPY.LOAD_DETAIL_FAILED
    }
  }

  function close() {
    if (submitting.value) return
    open.value = false
  }

  async function submitForm() {
    if (submitting.value) return false
    submitting.value = true
    submitError.value = ''
    try {
      const res = await submit({ payload: demandPayload(form), demandId: editingId.value })
      if (res.ok) {
        open.value = false
        return true
      }
      submitError.value = res.message
      return false
    } finally {
      submitting.value = false
    }
  }

  return {
    form,
    open,
    current,
    canNext,
    editingId,
    submitting,
    submitError,
    openCreate,
    openEdit,
    close,
    submitForm,
  }
}
