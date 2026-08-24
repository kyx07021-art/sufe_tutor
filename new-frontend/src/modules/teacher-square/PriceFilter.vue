<script setup>
import { computed } from 'vue'
import { TEACHER_SQUARE_TEXT as T } from '@/constants/m-teacher-square.js'

/**
 * PriceFilter - M7-11 price-range filter card
 * -------------------------------------------------------
 * - Self-contained filter card for the "price range" dimension.
 * - Card = title (T.FILTER_TITLE_PRICE) above a trigger-width row of
 *   [min input] [~] [max input]. The whole row spans the width of one
 *   filter-trigger (the parent card grid sets the equal card width).
 * - Each input is digit-only (non-digits stripped on input) with placeholders
 *   T.PRICE_MIN_PLACEHOLDER / T.PRICE_MAX_PLACEHOLDER, styled as a bordered
 *   small-radius rounded rectangle so the silhouette matches the sibling
 *   dropdown-trigger filter cards.
 * - Emits update:modelValue and change with the normalized { min, max } payload
 *   ('' for blank). Range-overlap matching is intentionally NOT here - that is
 *   match-dimensions.js priceHit (M7-12).
 * - Interface: prop modelValue { min, max } (digit strings or ''); events
 *   update:modelValue + change carry the same { min, max } object.
 * - Zero inline event/style attrs; zero v-html; zero runtime style-element injection;
 *   zero raw CJK in template/comments; CSS tokens only.
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

function onMinInput(e) {
  const raw = e.target.value
  const v = raw.replace(/\D/g, '')
  if (v !== raw) e.target.value = v
  commit(v, maxStr.value)
}

function onMaxInput(e) {
  const raw = e.target.value
  const v = raw.replace(/\D/g, '')
  if (v !== raw) e.target.value = v
  commit(minStr.value, v)
}
</script>

<template>
  <div class="pf">
    <div class="ui-title-sm">{{ T.FILTER_TITLE_PRICE }}</div>
    <div class="pf__row">
      <input
        class="pf__input"
        type="text"
        inputmode="numeric"
        pattern="[0-9]*"
        autocomplete="off"
        :value="minStr"
        :placeholder="T.PRICE_MIN_PLACEHOLDER"
        :aria-label="T.PRICE_MIN_PLACEHOLDER"
        @input="onMinInput"
      >
      <span class="pf__sep" aria-hidden="true">{{ T.PRICE_TILDE }}</span>
      <input
        class="pf__input"
        type="text"
        inputmode="numeric"
        pattern="[0-9]*"
        autocomplete="off"
        :value="maxStr"
        :placeholder="T.PRICE_MAX_PLACEHOLDER"
        :aria-label="T.PRICE_MAX_PLACEHOLDER"
        @input="onMaxInput"
      >
    </div>
  </div>
</template>

<style scoped>
.pf {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
}
.pf__row {
  display: flex;
  align-items: center;
  width: 100%;
  min-width: 0;
  gap: var(--space-1);
}
.pf__input {
  box-sizing: border-box;
  flex: 1 1 0;
  min-width: 0;
  height: var(--input-h);
  padding: 0 var(--input-pad-x);
  border: var(--border-w) solid var(--ink);
  border-radius: var(--radius-md); /* small-radius rounded rectangle, matching the other filter triggers */
  background: var(--paper);
  color: var(--ink);
  font-size: var(--fs-base);
  line-height: 1;
  transition:
    border-color var(--dur-sm) var(--ease-out),
    box-shadow var(--dur-sm) var(--ease-out);
}
.pf__input::placeholder {
  color: var(--gray-30);
}
.pf__input:focus-visible {
  outline: none;
  border-color: var(--brand);
  box-shadow: 0 0 0 2px var(--brand);
}
.pf__sep {
  flex: none;
  color: var(--ink);
  font-size: var(--fs-base);
  line-height: 1;
  user-select: none;
}
@media (prefers-reduced-motion: reduce) {
  .pf__input { transition: none; }
}
</style>
