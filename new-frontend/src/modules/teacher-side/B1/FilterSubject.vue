<script setup>
/**
 * FilterSubject - B1-5a subject filter card (two-column checkbox grid)
 * -------------------------------------------------------
 * - Renders SUBJECTS (region.js, backend English ids + Chinese labels) as a
 *   2-column grid of toggle chips. C2-F1: previously used the Chinese-label
 *   SUBJECT_OPTIONS array — the emitted value (the Chinese label) never matched
 *   the backend English subject id on demand cards (item.subject is an English
 *   id), so any subject filter returned zero results (PA-2-F4 fixed the same bug
 *   on teacher-square; this propagates it to teacher-side B1).
 * - v-model: modelValue = string[] of selected subject VALUE ids (English).
 * - Clicking toggles membership; the new array is emitted as a fresh copy.
 */
import { TEACHER_COPY } from '@/constants/ui.js'
import { SUBJECTS } from '@/modules/my-demands/region.js'

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
      <button
        v-for="s in options"
        :key="s.value"
        type="button"
        class="filter-subject__item"
        :class="{ 'is-checked': isChecked(s.value) }"
        :aria-pressed="isChecked(s.value)"
        @click="toggle(s.value)"
      >{{ s.label }}</button>
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
