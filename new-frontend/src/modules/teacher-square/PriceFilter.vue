<script setup>
import { computed } from 'vue'
import { UiInput } from '@/components/ui/index.js'
import { TEACHER_SQUARE_TEXT as T } from '@/constants/m-teacher-square.js'

/**
 * PriceFilter - M7-11 price-range filter card
 * -------------------------------------------------------
 * - Self-contained filter card for the "price range" dimension: title above a
 *   trigger-width row of [min input] [~] [max input]. The whole row spans the width
 *   of one filter-trigger card (the parent card grid sets the equal card width).
 * - Each input is a shared UiInput with filter="digits" (the standard input component,
 *   AK-N-㉛: no hand-written <input>), styled to match the sibling FilterTrigger
 *   silhouette (44px outer / radius-md / 1px --line border / fs-sm). The `--input-h`
 *   override keeps the OUTER box at 44px after the 1px border (42 + 2 = 44).
 * - Emits update:modelValue + change with the normalized { min, max } payload
 *   ('' for blank). Range-overlap matching is NOT here - that is match-dimensions.js
 *   priceHit (M7-12).
 * - Contract 6: zero inline event/style attrs, zero v-html, zero raw CJK (copy from T).
 */
const props = defineProps({
  modelValue: { type: Object, default: () => ({ min: '', max: '' }) },
})

const emit = defineEmits(['update:modelValue', 'change'])

const minStr = computed(() => normalize(props.modelValue && props.modelValue.min))
const maxStr = computed(() => normalize(props.modelValue && props.modelValue.max))

/** Keep the displayed value a plain digit string ('' for blank). */
function normalize(v) {
  return v == null ? '' : String(v).replace(/\D/g, '')
}

function commit(nextMin, nextMax) {
  const payload = { min: nextMin, max: nextMax }
  emit('update:modelValue', payload)
  emit('change', payload)
}

function onMinInput(value) {
  commit(value, maxStr.value)
}

function onMaxInput(value) {
  commit(minStr.value, value)
}
</script>

<template>
  <div class="price-filter">
    <div class="ui-title-sm">{{ T.FILTER_TITLE_PRICE }}</div>
    <div class="price-filter__row">
      <UiInput
        class="price-filter__input"
        :model-value="minStr"
        filter="digits"
        :placeholder="T.PRICE_MIN_PLACEHOLDER"
        :aria-label="T.PRICE_MIN_PLACEHOLDER"
        @update:model-value="onMinInput"
      />
      <span class="price-filter__sep" aria-hidden="true">{{ T.PRICE_TILDE }}</span>
      <UiInput
        class="price-filter__input"
        :model-value="maxStr"
        filter="digits"
        :placeholder="T.PRICE_MAX_PLACEHOLDER"
        :aria-label="T.PRICE_MAX_PLACEHOLDER"
        @update:model-value="onMaxInput"
      />
    </div>
  </div>
</template>

<style scoped>
.price-filter {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
}
.price-filter__row {
  display: flex;
  align-items: center;
  width: 100%;
  min-width: 0;
  gap: var(--space-1);
}
/* SPECIAL CASE (AK-N-㉛): UiInput is a borderless capsule by default; the filter-bar
   price inputs must share the FilterTrigger field silhouette (44px / radius-md /
   1px --line). Because UiInput's box-sizing is border-box, the inner --input-h is
   dropped to 42px so the outer box = 42 + 2px border = 44px, matching the trigger.
   Impact scope: the teacher-square price input pair only; every other UiInput keeps
   the capsule. Flex-share so the pair shrinks on mobile. */
.price-filter__input {
  --input-radius: var(--radius-md);
  --input-h: 42px;
  flex: 1 1 0;
  min-width: 0;
  border: var(--border-w) solid var(--line);
  background: var(--paper);
}
.price-filter__input:focus-within {
  border-color: var(--brand);
}
.price-filter__sep {
  flex: none;
  color: var(--ink);
  font-size: var(--fs-sm);
  line-height: 1;
  user-select: none;
}
</style>
