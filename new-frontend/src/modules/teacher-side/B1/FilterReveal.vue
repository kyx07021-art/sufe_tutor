<script setup>
/**
 * FilterReveal - B1-4 filter reveal trigger + panel fade
 * -------------------------------------------------------
 * - Text button (UiButton variant S style: no fill, no border, black text) with a
 *   down-chevron; clicking toggles the panel open/closed.
 * - The panel fades in with a slight downward shift (--dur-base / --ease-out).
 * - NOTE: shifting the card grid down while open is owned by the page layer
 *   (TeacherDemandPlaza) toggling a class on the grid container; this component
 *   only owns the button + panel fade.
 */
import { TEACHER_COPY } from '@/constants/ui.js'
import ArrowDown from '@/assets/svg/arrow-down.svg'

defineProps({
  open: { type: Boolean, default: false },
  btnLabel: { type: String, default: TEACHER_COPY.B1_FILTER_BTN },
})

const emit = defineEmits(['toggle'])

function onToggle() {
  emit('toggle')
}
</script>

<template>
  <div class="filter-reveal">
    <button
      type="button"
      class="filter-reveal__btn"
      :class="{ 'is-open': open }"
      :aria-expanded="open"
      @click="onToggle"
    >
      <span class="filter-reveal__label">{{ btnLabel }}</span>
      <ArrowDown class="filter-reveal__arrow" aria-hidden="true" />
    </button>
    <Transition name="filter-reveal">
      <div v-if="open" class="filter-reveal__panel">
        <slot />
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.filter-reveal__btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  border: none;
  background: transparent;
  color: var(--ink);
  font-size: var(--fs-base);
  line-height: 1;
  cursor: pointer;
  transition: color var(--dur-sm) var(--ease-out);
}
.filter-reveal__btn:hover,
.filter-reveal__btn:focus-visible {
  color: var(--gray-60);
}
.filter-reveal__btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--brand);
}
.filter-reveal__arrow {
  flex: none;
  width: 1em;
  height: 1em;
  color: currentColor;
  transition: transform var(--dur-base) var(--ease-out);
}
.filter-reveal__btn.is-open .filter-reveal__arrow {
  transform: rotate(180deg);
}

.filter-reveal__panel {
  margin-top: var(--space-3);
}

.filter-reveal-enter-active,
.filter-reveal-leave-active {
  transition:
    opacity var(--dur-base) var(--ease-out),
    transform var(--dur-base) var(--ease-out);
}
.filter-reveal-enter-from,
.filter-reveal-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

@media (prefers-reduced-motion: reduce) {
  .filter-reveal__btn,
  .filter-reveal__arrow,
  .filter-reveal-enter-active,
  .filter-reveal-leave-active {
    transition: none;
  }
}
</style>
