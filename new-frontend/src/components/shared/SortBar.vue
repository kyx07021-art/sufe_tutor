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
.sort-bar__tab:hover,
.sort-bar__tab:focus-visible {
  color: var(--gray-60);
}
.sort-bar__tab.is-active {
  background: var(--gray-10);
  color: var(--ink);
}
.sort-bar__tab.is-active:hover,
.sort-bar__tab.is-active:focus-visible {
  color: var(--ink);
}
@media (prefers-reduced-motion: reduce) {
  .sort-bar__tab {
    transition: none;
  }
}
</style>
