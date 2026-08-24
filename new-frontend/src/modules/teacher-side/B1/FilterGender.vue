<script setup>
/**
 * FilterGender - B1-5b preferred-gender filter card (single-select)
 * -------------------------------------------------------
 * - Three options in one row: male / female / any (the "any" option clears to '').
 * - Rendered as shared UiCheckButton variant B (AK-N-㉛: standard components, not
 *   hand-written buttons); the active row gets a gray-10 fill (AK-I selected fill).
 * - v-model: modelValue = '' | 'male' | 'female'.
 * - Clicking a value selects it (re-click keeps it selected); clicking "any" clears to ''.
 */
import { TEACHER_COPY } from '@/constants/ui.js'
import UiCheckButton from '@/components/ui/UiCheckButton.vue'

const props = defineProps({
  modelValue: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue'])

const options = [
  { value: 'male', label: TEACHER_COPY.B1_GENDER_MALE },
  { value: 'female', label: TEACHER_COPY.B1_GENDER_FEMALE },
  { value: '', label: TEACHER_COPY.B1_GENDER_ANY },
]

function select(value) {
  emit('update:modelValue', value)
}
</script>

<template>
  <div class="filter-gender" role="radiogroup" :aria-label="TEACHER_COPY.B1_FILTER_GENDER">
    <UiCheckButton
      v-for="opt in options"
      :key="opt.value || 'any'"
      variant="B"
      :model-value="modelValue === opt.value"
      :label="opt.label"
      :fill="modelValue === opt.value ? 'gray-10' : 'auto'"
      @update:model-value="select(opt.value)"
    />
  </div>
</template>

<style scoped>
.filter-gender {
  display: flex;
  gap: var(--space-2);
}
/* equal-share full-width B rows; active = gray-10 fill, check reserved */
.filter-gender :deep(.ui-checkbtn) {
  flex: 1 1 0;
  min-width: 0;
  --btn-w: 100%;
  --btn-h: 40px;
  --btn-fs: var(--fs-sm);
  --btn-pad: var(--space-3);
  --btn-radius: var(--radius-sm);
}
.filter-gender :deep(.ui-checkbtn.is-checked) {
  width: 100%;
}
.filter-gender :deep(.ui-checkbtn__check),
.filter-gender :deep(.ui-checkbtn.is-checked .ui-checkbtn__check) {
  width: 28px;
}
</style>
