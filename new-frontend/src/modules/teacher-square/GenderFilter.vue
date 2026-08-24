<script setup>
import { computed, ref } from 'vue'
import FilterTrigger from '@/components/shared/FilterTrigger.vue'
import UiCheckButton from '@/components/ui/UiCheckButton.vue'
import { TEACHER_SQUARE_TEXT as T } from '@/constants/m-teacher-square.js'

/**
 * GenderFilter - M7-09 gender filter card (single-select)
 * -------------------------------------------------------
 * - Self-contained filter card: a shared FilterTrigger (AK-N-㉛ unified trigger) with
 *   title + dropdown. Resting text = T.FILTER_ALL_GENDER; once a gender is chosen the
 *   trigger shows T.GENDER_MALE / T.GENDER_FEMALE (valueText).
 * - The panel lists three options (male / female / any) with radio semantics - exactly
 *   one active; the active row is UiCheckButton variant B with gray-10 fill. Picking an
 *   option emits update:modelValue + change and closes the panel (single-select).
 * - Closes on option pick, click outside, or Escape (focus returns to the trigger).
 * - Contract 6: zero inline event/style attrs, zero v-html, zero raw CJK (copy from T).
 */
const props = defineProps({
  /** '' = any | 'male' | 'female' */
  modelValue: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue', 'change'])

const triggerRef = ref(null)

const OPTIONS = [
  { value: 'male', label: T.GENDER_MALE },
  { value: 'female', label: T.GENDER_FEMALE },
  { value: '', label: T.GENDER_ANY },
]

const displayText = computed(() => {
  if (props.modelValue === 'male') return T.GENDER_MALE
  if (props.modelValue === 'female') return T.GENDER_FEMALE
  return ''
})

function pick(value) {
  if (value !== props.modelValue) {
    emit('update:modelValue', value)
    emit('change', value)
  }
  triggerRef.value?.close()
}
</script>

<template>
  <FilterTrigger
    ref="triggerRef"
    :label="T.FILTER_TITLE_GENDER"
    :placeholder="T.FILTER_ALL_GENDER"
    :value-text="displayText"
    match-width
  >
    <div class="gender-filter__list">
      <UiCheckButton
        v-for="opt in OPTIONS"
        :key="opt.value"
        variant="B"
        :model-value="modelValue === opt.value"
        :label="opt.label"
        :fill="modelValue === opt.value ? 'gray-10' : 'auto'"
        @update:model-value="pick(opt.value)"
      />
    </div>
  </FilterTrigger>
</template>

<style scoped>
/* anchored list: compact full-width B rows; active = gray-10 fill, check reserved */
.gender-filter__list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.gender-filter__list :deep(.ui-checkbtn) {
  --btn-w: 100%;
  --btn-h: 40px;
  --btn-fs: var(--fs-sm);
  --btn-pad: var(--space-3);
  --btn-radius: var(--radius-sm);
  justify-content: flex-start;
}
.gender-filter__list :deep(.ui-checkbtn.is-checked) {
  width: 100%;
}
.gender-filter__list :deep(.ui-checkbtn__check),
.gender-filter__list :deep(.ui-checkbtn.is-checked .ui-checkbtn__check) {
  width: 28px;
}
</style>
