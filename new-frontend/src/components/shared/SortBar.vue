<script setup>
/**
 * SortBar - sort tab bar (M0 shared; M7 four-key / M9 two-key via props)
 * --------------------------------------------------------------
 * - Mutually exclusive tabs; selected tab shows gray-10 fill, resting is text-only.
 * - Emits update:modelValue(key); the order (asc/desc) toggle lives in the separate
 *   OrderToggle base unit (M7-05 / M9-B1-3b) so the two stay independently rollbackable.
 * - Zero inline style/event attributes (contract 6); states are class-driven.
 */
const props = defineProps({
  /** [{ key, label }] */
  options: { type: Array, required: true },
  /** active key */
  modelValue: { type: String, default: '' },
  ariaLabel: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue'])
</script>

<template>
  <div class="sort-bar" role="tablist" :aria-label="ariaLabel">
    <button
      v-for="opt in options"
      :key="opt.key"
      class="sort-bar__tab"
      :class="{ 'is-active': opt.key === modelValue }"
      type="button"
      role="tab"
      :aria-selected="opt.key === modelValue"
      @click="emit('update:modelValue', opt.key)"
    >
      <span class="sort-bar__label">{{ opt.label }}</span>
    </button>
  </div>
</template>

<style scoped>
.sort-bar {
  display: inline-flex;
  gap: var(--space-2);
}
.sort-bar__tab {
  position: relative;
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-pill);
  color: var(--ink);
  font-size: var(--fs-base);
  line-height: 1;
  transition: color var(--dur-sm) var(--ease-out), background-color var(--dur-sm) var(--ease-out);
}
/* AK-C2-F3 (#2 black-is-black): hover/focus no longer grays the tab text —
   focus is a "can click" cue, not a "goes gray" state. The active tab is the
   only one with a fill (gray-10); the resting tab stays ink on hover (cursor
   pointer communicates affordance). */
.sort-bar__tab.is-active {
  background: var(--gray-10);
  color: var(--ink);
}
@media (prefers-reduced-motion: reduce) {
  .sort-bar__tab {
    transition: none;
  }
}
</style>
