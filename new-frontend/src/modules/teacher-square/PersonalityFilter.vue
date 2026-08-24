<script setup>
import { computed } from 'vue'
import FilterTrigger from '@/components/shared/FilterTrigger.vue'
import UiCheckButton from '@/components/ui/UiCheckButton.vue'
import { TEACHER_SQUARE_TEXT as T } from '@/constants/m-teacher-square.js'
import { PERSONALITY_TAGS, tagLabel } from '@/modules/my-demands/region.js'

/**
 * PersonalityFilter - M7-10 teacher-personality filter card (multi-select check rows)
 * ----------------------------------------------------------------------------------
 * - Self-contained filter card: a shared FilterTrigger (AK-N-㉛ unified trigger) with
 *   title + dropdown. Resting text = T.FILTER_ALL_PERSONALITY; once tags are selected
 *   the trigger shows them comma-joined with a single-line ellipsis (valueText).
 * - The panel lists every tag in region.js PERSONALITY_TAGS as UiCheckButton rows
 *   (single column, variant B). Toggling mutates the selection array of ENGLISH ids only
 *   (PA-2-F4); labels come from tagLabel(). Rows toggle in/out and the panel stays open
 *   while toggling (multi-select). It closes on click-outside or Escape (focus returns
 *   to the trigger).
 * - Any-hit matching semantics belong to the match engine (match-dimensions.js).
 * - Emits update:modelValue(next array) + change(next array).
 */
const props = defineProps({
  modelValue: { type: Array, default: () => [] },
})

const emit = defineEmits(['update:modelValue', 'change'])

/** Normalized selection (guards null / undefined, contract C3). */
const selected = computed(() => (Array.isArray(props.modelValue) ? props.modelValue : []))

const isSelected = (tag) => selected.value.includes(tag)

const displayText = computed(() =>
  selected.value.length ? selected.value.map(tagLabel).join(T.FILTER_JOIN) : '',
)

function toggleTag(tag) {
  const next = isSelected(tag)
    ? selected.value.filter((x) => x !== tag)
    : [...selected.value, tag]
  emit('update:modelValue', next)
  emit('change', next)
}
</script>

<template>
  <FilterTrigger
    :label="T.FILTER_TITLE_PERSONALITY"
    :placeholder="T.FILTER_ALL_PERSONALITY"
    :value-text="displayText"
    match-width
  >
    <div class="pf-list">
      <UiCheckButton
        v-for="tag in PERSONALITY_TAGS"
        :key="tag.value"
        variant="B"
        :model-value="isSelected(tag.value)"
        :label="tag.label"
        :fill="isSelected(tag.value) ? 'gray-10' : 'auto'"
        @update:model-value="toggleTag(tag.value)"
      />
    </div>
  </FilterTrigger>
</template>

<style scoped>
/* anchored list: compact full-width B rows; active = gray-10 fill, check reserved */
.pf-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.pf-list :deep(.ui-checkbtn) {
  --btn-w: 100%;
  --btn-h: 40px;
  --btn-fs: var(--fs-sm);
  --btn-pad: var(--space-3);
  --btn-radius: var(--radius-sm);
  justify-content: flex-start;
}
.pf-list :deep(.ui-checkbtn.is-checked) {
  width: 100%;
}
.pf-list :deep(.ui-checkbtn__check),
.pf-list :deep(.ui-checkbtn.is-checked .ui-checkbtn__check) {
  width: 28px;
}
</style>
