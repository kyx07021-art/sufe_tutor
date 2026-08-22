<script setup>
/**
 * FilterReveal - M7-06 filter button + third top bar expand animation
 * -------------------------------------------------------
 * - Wrapper that reveals the third top bar (passed as the default slot,
 *   typically <ThirdBar>) with a fade + slide-down from the second top
 *   bar's bottom edge whenever `open` is true.
 * - Lives in normal flow before the card list, so opening pushes the list
 *   down instead of overlaying it (no absolute positioning over content).
 * - A pseudo-element fade mask (transparent -> var(--paper)) hangs at the
 *   bar's bottom edge so the boundary into the page body below is softened.
 * - Vue <Transition> drives enter/leave; JS only reflects the `open` prop.
 *   prefers-reduced-motion squeezes the animation to near-zero.
 * - Zero inline event/style attrs, zero v-html, zero raw CJK (contract 6).
 */
const props = defineProps({
  /** whether the third top bar is revealed */
  open: { type: Boolean, default: false },
})

const emit = defineEmits(['update:open', 'toggle'])

/**
 * Programmatic flip hook (v-model:open compatible). Consumers wire their own
 * trigger (e.g. SecondBar filter-click) to this, or to update:open directly.
 */
function toggle() {
  emit('toggle')
  emit('update:open', !props.open)
}

defineExpose({ toggle })
</script>

<template>
  <Transition name="fr">
    <div v-if="open" class="filter-reveal">
      <slot />
    </div>
  </Transition>
</template>

<style scoped>
.filter-reveal {
  position: relative;
}

/* Fade mask at the bar's bottom edge: the page-body boundary below is
   softened by a gradient that resolves to the paper surface. */
.filter-reveal::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: var(--modal-mask-h);
  background: linear-gradient(to bottom, transparent, var(--paper));
  pointer-events: none;
}

/* Enter / leave: fade in + slide down from the second bar's bottom edge. */
.fr-enter-active,
.fr-leave-active {
  transition:
    opacity var(--dur-md) var(--ease-out),
    transform var(--dur-md) var(--ease-out);
}

.fr-enter-from,
.fr-leave-to {
  opacity: 0;
  transform: translateY(calc(-1 * var(--space-3)));
}

.fr-enter-to,
.fr-leave-from {
  opacity: 1;
  transform: translateY(0);
}

/* prefers-reduced-motion: squeeze to near-zero (no slide, instant fade). */
@media (prefers-reduced-motion: reduce) {
  .fr-enter-active,
  .fr-leave-active {
    transition: none;
  }

  .fr-enter-from,
  .fr-leave-to {
    transform: none;
  }
}
</style>
