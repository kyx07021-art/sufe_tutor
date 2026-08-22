<script setup>
/**
 * FilterGender - B1-5b preferred-gender filter card (single-select)
 * -------------------------------------------------------
 * - Three options in one row: male / female / any (the "any" option clears to '').
 * - v-model: modelValue = '' | 'male' | 'female'.
 * - Clicking a value selects it (re-click keeps it selected); clicking "any" clears to ''.
 */
import { TEACHER_COPY } from '@/constants/ui.js'

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
    <button
      v-for="opt in options"
      :key="opt.value || 'any'"
      type="button"
      class="filter-gender__item"
      :class="{ 'is-checked': modelValue === opt.value }"
      role="radio"
      :aria-checked="modelValue === opt.value"
      @click="select(opt.value)"
    >{{ opt.label }}</button>
  </div>
</template>

<style scoped>
.filter-gender {
  display: flex;
  gap: var(--space-2);
}
.filter-gender__item {
  flex: 1 1 0;
  min-width: 0;
  box-sizing: border-box;
  padding: var(--space-2) var(--space-3);
  border: var(--border-w) solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--paper);
  color: var(--ink);
  font-size: var(--fs-sm);
  line-height: 1.3;
  text-align: center;
  cursor: pointer;
  transition:
    background var(--dur-sm) var(--ease-out),
    border-color var(--dur-sm) var(--ease-out);
}
.filter-gender__item:hover {
  background: var(--gray-10);
}
.filter-gender__item.is-checked {
  background: var(--gray-10);
  border-color: var(--ink);
}
.filter-gender__item:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--brand);
}

@media (prefers-reduced-motion: reduce) {
  .filter-gender__item { transition: none; }
}
</style>
