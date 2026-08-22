<script setup>
import { ref, computed } from 'vue'
import UiStepModal from '@/components/ui/UiStepModal.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlertModal from '@/components/ui/UiAlertModal.vue'
import { showToast } from '@/composables/useToast'
import StepGradeProvince from './steps/StepGradeProvince.vue'
import StepSubjectMethod from './steps/StepSubjectMethod.vue'
import StepScore from './steps/StepScore.vue'
import StepAddress from './steps/StepAddress.vue'
import StepPreferences from './steps/StepPreferences.vue'
import { useDemandForm } from './useDemandForm.js'
import { useDemandDelete } from './useDemandDelete.js'
import { MY_DEMANDS_COPY } from '@/constants/m-my-demands.js'

/**
 * DemandEditorModal - A2.2 create/edit demand wizard (M8-06 skeleton + step controller)
 * -------------------------------------------------------
 * - 5-step wizard over UiStepModal: grade-province / subject-method / score / address-time / preferences.
 * - Controller (useDemandForm) owns the reactive form, per-step gates, prefill (M8-13),
 *   and the submit write path (M8-12). Steps are presentational, mutating `form`.
 * - Edit mode adds a delete entry in the last step (M8-14) behind a danger confirm modal.
 * - Parent calls ref.openCreate() / ref.openEdit(demand); success emits 'done'.
 */
const emit = defineEmits(['done'])

const {
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
} = useDemandForm()

const { remove } = useDemandDelete()
const deleteOpen = ref(false)

const pageTitles = [
  MY_DEMANDS_COPY.STEP_GRADE_PROVINCE,
  MY_DEMANDS_COPY.STEP_SUBJECT_METHOD,
  MY_DEMANDS_COPY.STEP_SCORE,
  MY_DEMANDS_COPY.STEP_ADDRESS_TIME,
  MY_DEMANDS_COPY.STEP_PREFERENCES,
]

const nextText = computed(() => (editingId.value ? MY_DEMANDS_COPY.SUBMIT_EDIT : MY_DEMANDS_COPY.SUBMIT_CREATE))

async function onSubmit() {
  if (submitting.value) return
  const ok = await submitForm()
  if (ok) emit('done')
}

function onDeleteClick() {
  if (editingId.value == null) return
  deleteOpen.value = true
}

async function onDeleteConfirm() {
  deleteOpen.value = false
  const res = await remove(editingId.value)
  if (res.ok) {
    showToast(MY_DEMANDS_COPY.DELETE_DONE)
    close()
    emit('done')
  } else {
    showToast(res.message || MY_DEMANDS_COPY.DELETE_FAILED)
  }
}

defineExpose({ openCreate, openEdit })
</script>

<template>
  <UiStepModal
    v-model:open="open"
    v-model:current="current"
    :page-count="5"
    :page-titles="pageTitles"
    :can-next="canNext"
    :next-text="nextText"
    :close-on-outside="true"
    @submit="onSubmit"
    @close="close"
  >
    <template #page-0><StepGradeProvince :form="form" /></template>
    <template #page-1><StepSubjectMethod :form="form" /></template>
    <template #page-2><StepScore :form="form" /></template>
    <template #page-3><StepAddress :form="form" /></template>
    <template #page-4>
      <StepPreferences :form="form" />
      <p v-if="submitError" class="demand-editor__error" role="alert">{{ submitError }}</p>
      <div v-if="editingId" class="demand-editor__delete">
        <UiButton variant="S1" @click="onDeleteClick">{{ MY_DEMANDS_COPY.DELETE_ACTION }}</UiButton>
      </div>
    </template>
  </UiStepModal>

  <UiAlertModal
    v-model:open="deleteOpen"
    danger
    :message="MY_DEMANDS_COPY.DELETE_CONFIRM"
    @confirm="onDeleteConfirm"
  />
</template>

<style scoped>
.demand-editor__error {
  margin-top: var(--space-3);
  color: var(--danger);
  font-size: var(--fs-sm);
}
.demand-editor__delete {
  margin-top: var(--space-4);
  display: flex;
  justify-content: flex-end;
}
</style>
