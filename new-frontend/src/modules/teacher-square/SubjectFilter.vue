<script setup>
import { computed } from 'vue'
import FilterTrigger from '@/components/shared/FilterTrigger.vue'
import UiCheckButton from '@/components/ui/UiCheckButton.vue'
import { TEACHER_SQUARE_TEXT as T } from '@/constants/m-teacher-square.js'
import { SUBJECTS, subjectLabel } from '@/modules/my-demands/region.js'

/**
 * SubjectFilter - M7-08 subject filter card (double-column multi-select)
 * -------------------------------------------------------
 * - Self-contained filter card for the "subject" dimension: a shared FilterTrigger
 *   (AK-N-㉛ unified trigger) with title + dropdown. Resting text = T.FILTER_ALL_SUBJECT;
 *   once subjects are selected the trigger shows the comma-joined Chinese labels,
 *   ellipsis-truncated (valueText).
 * - The panel (FilterTrigger default slot) lists every subject (region.js SUBJECTS =
 *   backend English ids) as a two-column grid of UiCheckButton variant B rows. Toggling
 *   mutates the selection array of ENGLISH ids only (PA-2-F4); any-hit semantics belong
 *   to the match engine (M7-12). Panel stays open while toggling (multi-select).
 * - Emits update:modelValue(next array) + change(next array).
 * - Contract 6: zero inline event/style attrs, zero v-html, zero raw CJK (copy from T).
 */
const props = defineProps({
  /** array of selected subject strings (v-model) */
  modelValue: { type: Array, default: () => [] },
})

const emit = defineEmits(['update:modelValue', 'change'])

const selected = computed(() =>
  Array.isArray(props.modelValue) ? props.modelValue : [],
)
const displayText = computed(() =>
  selected.value.length ? selected.value.map(subjectLabel).join(', ') : '',
)

function isSelected(subject) {
  return selected.value.includes(subject)
}

function toggleSubject(subject) {
  const next = selected.value.includes(subject)
    ? selected.value.filter((s) => s !== subject)
    : [...selected.value, subject]
  emit('update:modelValue', next)
  emit('change', next)
}
</script>

<template>
  <FilterTrigger
    :label="T.FILTER_TITLE_SUBJECT"
    :placeholder="T.FILTER_ALL_SUBJECT"
    :value-text="displayText"
    panel-width="min(320px, calc(100vw - var(--space-4)))"
  >
    <div class="subject-filter__grid">
      <UiCheckButton
        v-for="s in SUBJECTS"
        :key="s.value"
        variant="B"
        :model-value="isSelected(s.value)"
        :label="s.label"
        :fill="isSelected(s.value) ? 'gray-10' : 'auto'"
        @update:model-value="toggleSubject(s.value)"
      />
    </div>
  </FilterTrigger>
</template>

<style scoped>
/* two-column grid inside the anchored panel; rows compact, check reserved on every row */
.subject-filter__grid {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
  grid-template-rows: repeat(10, auto);
  gap: var(--space-1) var(--space-2);
}
.subject-filter__grid :deep(.ui-checkbtn) {
  width: 100%;
  --btn-h: 36px;
  --btn-fs: 14px;
}
.subject-filter__grid :deep(.ui-checkbtn.is-checked) {
  width: 100%;
}
.subject-filter__grid :deep(.ui-checkbtn__check),
.subject-filter__grid :deep(.ui-checkbtn.is-checked .ui-checkbtn__check) {
  width: 28px;
}
</style>
