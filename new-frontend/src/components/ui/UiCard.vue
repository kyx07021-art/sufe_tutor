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
  /* ripple mask duration (single source for createRipple rAF + CSS fade) */
  --btn-dur-click: var(--dur-sm);
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

/* ripple (single-path dynamics; the ripple IS the mask - TASK A) */
.ui-card::before,
.ui-card::after {
  content: "";
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
  opacity: 0;
}
.ui-card::before {
  left: 50%;
  top: 50%;
  width: var(--btn-d, 900px);
  height: var(--btn-d, 900px);
  margin-left: calc(var(--btn-d, 900px) / -2);
  margin-top: calc(var(--btn-d, 900px) / -2);
  background: var(--gray-10);
  transform: scale(1);
  transition: opacity var(--dur-md) var(--ease-out);
}
@media (hover: hover) and (pointer: fine) {
  .ui-card--interactive:hover::before {
    opacity: 1;
    animation: ui-fill-in var(--dur-xs) var(--ease-out) forwards;
  }
}
.ui-card::after {
  left: var(--mx, 50%);
  top: var(--my, 50%);
  width: var(--ripple-unit, 2px);
  height: var(--ripple-unit, 2px);
  margin-left: 0;
  margin-top: 0;
  background: var(--gray-20);
  transform: translate(-50%, -50%) scale(0);
}
.ui-card.is-rippling::after {
  transform: translate(-50%, -50%) scale(var(--r));
  animation: ui-ripple var(--btn-dur-click) var(--ease-out) forwards;
}
.ui-card.is-rippling::before {
  opacity: 0;
  transition: none;
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
  .ui-card,
  .ui-card::before,
  .ui-card::after,
  .ui-card.is-rippling::after { animation: none; transition: none; transform: none; }
  .ui-card--interactive:hover::before { opacity: 1; transform: scale(1); }
  .ui-card.is-rippling::after {
    transform: translate(-50%, -50%) scale(var(--r));
    opacity: 1;
  }
  .ui-card.is-rippling::before { opacity: 0; }
}
</style>
