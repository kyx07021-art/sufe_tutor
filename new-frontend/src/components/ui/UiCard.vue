<script setup>
import { computed, ref } from 'vue'
import { useRipple } from '@/composables/useRipple'

/**
 * UiCard - Card (plan "card styles")
 * -------------------------------------------------------
 * - A  : white background + thin border + rounded rectangle; independent animation interface (parent wraps in <Transition> to move/fade the whole card)
 * - A1 : like A, interactive (giant button A: hover gray-15 ripple / click gray-30, spreading from the pointer)
 * - B  : like A, no thin border (wraps page components to unify animation)
 * - B1 : like A1, no border
 * - Interaction = role="button" + tabindex, Enter/Space triggers; disabled grays out and cannot be clicked.
 */
const props = defineProps({
  variant: { type: String, default: 'A', validator: (v) => ['A', 'A1', 'B', 'B1'].includes(v) },
  disabled: { type: Boolean, default: false },
  /** force interactive (A/B variants can also be clicked) */
  clickable: { type: Boolean, default: false },
})

const emit = defineEmits(['click'])
const el = ref(null)

const interactive = computed(
  () => props.variant === 'A1' || props.variant === 'B1' || props.clickable,
)

useRipple(el, { disabled: computed(() => props.disabled) })

function onClick(e) {
  if (props.disabled || !interactive.value) return
  emit('click', e)
}

function onKeydown(e) {
  if (!interactive.value || props.disabled) return
  if (e.key !== 'Enter' && e.key !== ' ') return
  e.preventDefault()
  emit('click', e)
}
</script>

<template>
  <div
    ref="el"
    class="ui-card"
    :class="[
      `ui-card--${variant.toLowerCase()}`,
      { 'ui-card--interactive': interactive, 'is-disabled': disabled },
    ]"
    :role="interactive ? 'button' : undefined"
    :tabindex="interactive && !disabled ? 0 : undefined"
    @click="onClick"
    @keydown="onKeydown"
  >
    <slot />
  </div>
</template>

<style scoped>
.ui-card {
  position: relative;
  box-sizing: border-box;
  border-radius: var(--radius-md);
  background: var(--paper);
  border: var(--border-w) solid var(--line);
  overflow: hidden; /* clip ripple circle inside the card */
}
.ui-card--b,
.ui-card--b1 {
  border-color: transparent;
}
.ui-card--interactive {
  cursor: pointer;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}
.ui-card--interactive:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--brand);
}

/* ripple dual circle layers (same as button) */
.ui-card::before,
.ui-card::after {
  content: "";
  position: absolute;
  left: var(--mx, 50%);
  top: var(--my, 50%);
  width: var(--btn-d, 900px);
  height: var(--btn-d, 900px);
  margin-left: calc(var(--btn-d, 900px) / -2);
  margin-top: calc(var(--btn-d, 900px) / -2);
  border-radius: 50%;
  transform: scale(0);
  opacity: 0;
  pointer-events: none;
}
.ui-card::before {
  background: var(--gray-15);
  transform: scale(1);
  opacity: 0;
  transition: opacity var(--dur-md) var(--ease-out);
}
@media (hover: hover) and (pointer: fine) {
  .ui-card--interactive:hover::before,
  .ui-card--interactive:focus-visible::before {
    opacity: 1;
    animation: ui-card-hover-in var(--dur-xs) var(--ease-out) forwards;
  }
}
@keyframes ui-card-hover-in {
  from { transform: scale(0); }
  to { transform: scale(1); }
}

.ui-card::after { background: var(--gray-30); }
.ui-card.is-rippling::after {
  animation: ui-ripple var(--dur-xl) var(--ease-out) forwards;
}

/* content layer above ripple */
.ui-card > * {
  position: relative;
  z-index: 1;
}

.ui-card.is-disabled {
  cursor: default;
  opacity: 0.6;
}
.ui-card.is-disabled::before,
.ui-card.is-disabled::after { display: none; }

@media (prefers-reduced-motion: reduce) {
  .ui-card::before,
  .ui-card::after,
  .ui-card.is-rippling::after { animation: none; transition: none; }
  .ui-card:hover::before,
  .ui-card:focus-visible::before { opacity: 1; transform: scale(1); }
  .ui-card::after { opacity: 0; }
}
</style>
