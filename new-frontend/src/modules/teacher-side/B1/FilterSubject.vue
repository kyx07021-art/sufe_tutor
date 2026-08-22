<script setup>
/**
 * FilterSubject - B1-5a subject filter card (two-column checkbox grid)
 * -------------------------------------------------------
 * - Renders SUBJECT_OPTIONS as a 2-column grid of toggle chips.
 * - v-model: modelValue = string[] of selected subjects.
 * - Clicking toggles membership; the new array is emitted as a fresh copy.
 */
import { TEACHER_COPY, SUBJECT_OPTIONS } from '@/constants/ui.js'

const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  options: { type: Array, default: () => SUBJECT_OPTIONS },
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
      <button
        v-for="subject in options"
        :key="subject"
        type="button"
        class="filter-subject__item"
        :class="{ 'is-checked': isChecked(subject) }"
        :aria-pressed="isChecked(subject)"
        @click="toggle(subject)"
      >{{ subject }}</button>
    </div>
  </div>
</template>

<style scoped>
.filter-subject__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-2);
}
.filter-subject__item {
  box-sizing: border-box;
  min-width: 0;
  padding: var(--space-2) var(--space-3);
  border: var(--border-w) solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--paper);
  color: var(--ink);
  font-size: var(--fs-sm);
  line-height: 1.3;
  text-align: left;
  cursor: pointer;
  transition:
    background var(--dur-sm) var(--ease-out),
    border-color var(--dur-sm) var(--ease-out);
}
.filter-subject__item:hover {
  background: var(--gray-10);
}
.filter-subject__item.is-checked {
  background: var(--gray-10);
  border-color: var(--ink);
}
.filter-subject__item:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--brand);
}

@media (prefers-reduced-motion: reduce) {
  .filter-subject__item { transition: none; }
}
</style>
