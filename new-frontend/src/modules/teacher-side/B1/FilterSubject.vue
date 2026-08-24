<script setup>
/**
 * FilterSubject - B1-5a subject filter card (two-column checkbox grid)
 * -------------------------------------------------------
 * - Renders SUBJECTS (region.js, backend English ids + Chinese labels) as a
 *   2-column grid of shared UiCheckButton variant B toggle rows (AK-N-㉛: standard
 *   components, not hand-written buttons); the active row gets a gray-10 fill
 *   (AK-I selected fill). C2-F1: the emitted value must be the backend English id,
 *   never the Chinese label, else any subject filter returns zero results
 *   (PA-2-F4 fixed the same bug on teacher-square; this propagates it to teacher-side B1).
 * - v-model: modelValue = string[] of selected subject VALUE ids (English).
 * - Clicking toggles membership; the new array is emitted as a fresh copy.
 */
import { TEACHER_COPY } from '@/constants/ui.js'
import { SUBJECTS } from '@/modules/my-demands/region.js'
import UiCheckButton from '@/components/ui/UiCheckButton.vue'

const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  options: { type: Array, default: () => SUBJECTS },
})

const emit = defineEmits(['update:modelValue'])

function isChecked(subject) {
  return props.modelValue.includes(subject)
}

function toggle(subject) {
  const next = props.modelValue.includes(subject)
    ? props.modelValue.filter((s) => s !== subject)
    : props.modelValue.concat(subject)
  emit('update:modelValue', next)
}
</script>

<template>
  <div class="filter-subject" role="group" :aria-label="TEACHER_COPY.B1_FILTER_SUBJECT">
    <div class="filter-subject__grid">
      <UiCheckButton
        v-for="s in options"
        :key="s.value"
        variant="B"
        :model-value="isChecked(s.value)"
        :label="s.label"
        :fill="isChecked(s.value) ? 'gray-10' : 'auto'"
        @update:model-value="toggle(s.value)"
      />
    </div>
  </div>
</template>

<style scoped>
.filter-subject__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-2);
}
/* full-width B rows that never stretch out of the grid cell on select */
.filter-subject__grid :deep(.ui-checkbtn) {
  width: 100%;
  min-width: 0;
  --btn-h: 40px;
  --btn-fs: var(--fs-sm);
  --btn-pad: var(--space-3);
  --btn-radius: var(--radius-sm);
}
.filter-subject__grid :deep(.ui-checkbtn.is-checked) {
  width: 100%;
}
.filter-subject__grid :deep(.ui-checkbtn__check),
.filter-subject__grid :deep(.ui-checkbtn.is-checked .ui-checkbtn__check) {
  width: 28px;
}
</style>
