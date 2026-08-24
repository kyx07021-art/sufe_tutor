<script setup>
/**
 * OrderToggle - sort order toggle round button (M0 shared; M7-05 / M9-B1-3b single source)
 * -----------------------------------------------------------------------------------------
 * - Circular icon button (~40px, thin border). Shows the current sort direction:
 *   desc -> sort-desc arrow, asc -> sort-asc arrow.
 * - Click flips the order and emits BOTH 'toggle' (with the next value) and
 *   'update:order' (with the next value) so any consumer can bind either
 *   (M7 binds update:order; M9 binds toggle).
 * - Zero inline styles: JS only toggles classes; visuals live in scoped CSS.
 */
import SortAsc from '@/assets/svg/sort-asc.svg'
import SortDesc from '@/assets/svg/sort-desc.svg'

const props = defineProps({
  order: { type: String, default: 'desc' },
  ariaLabel: { type: String, default: '' },
  /** root loading state -> leaf stops: suppress interaction + hover/active fill */
  disabled: { type: Boolean, default: false },
})

const emit = defineEmits(['toggle', 'update:order'])

function onToggle() {
  if (props.disabled) return
  const next = props.order === 'desc' ? 'asc' : 'desc'
  emit('toggle', next)
  emit('update:order', next)
}
</script>

<template>
  <button
    type="button"
    class="order-toggle"
    :class="{ 'is-asc': order === 'asc', 'is-disabled': disabled }"
    :aria-label="ariaLabel || undefined"
    :aria-pressed="order === 'asc'"
    :disabled="disabled"
    @click="onToggle"
  >
    <SortDesc v-if="order === 'desc'" class="order-toggle__icon" aria-hidden="true" />
    <SortAsc v-else class="order-toggle__icon" aria-hidden="true" />
  </button>
</template>

<style scoped>
.order-toggle {
  --ot-size: 40px;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: var(--ot-size);
  height: var(--ot-size);
  padding: 0;
  border: var(--border-w) solid var(--line);
  border-radius: var(--radius-circle);
  background: transparent;
  color: var(--ink);
  cursor: pointer;
  transition: background var(--dur-sm) var(--ease-out);
}
.order-toggle:hover,
.order-toggle:focus-visible {
  background: var(--gray-15);
}
.order-toggle:active {
  background: var(--gray-30);
}
.order-toggle:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--brand);
}
.order-toggle__icon {
  flex: none;
  width: 20px;
  height: 20px;
  color: currentColor;
}
/* disabled (root loading -> leaf stop): no hover/active fill, icon gray-50
   (via color: currentColor), no focus ring, no transition. */
.order-toggle.is-disabled {
  cursor: default;
  color: var(--gray-50);
  transition: none;
}
.order-toggle.is-disabled:hover,
.order-toggle.is-disabled:focus-visible {
  background: transparent;
}
.order-toggle.is-disabled:active {
  background: transparent;
}
.order-toggle.is-disabled:focus-visible {
  box-shadow: none;
}
@media (prefers-reduced-motion: reduce) {
  .order-toggle { transition: none; }
}
</style>
