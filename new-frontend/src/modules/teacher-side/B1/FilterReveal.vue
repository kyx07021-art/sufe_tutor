<script setup>
/**
 * FilterReveal - B1-4 filter reveal trigger + panel fade
 * -------------------------------------------------------
 * - Text button (UiButton variant S: no fill, no border, black text) with a
 *   down-chevron; clicking toggles the panel open/closed.
 * - The panel fades in with a slight downward shift (--dur-base / --ease-out).
 * - NOTE: shifting the card grid down while open is owned by the page layer
 *   (TeacherDemandPlaza) toggling a class on the grid container; this component
 *   only owns the button + panel fade.
 */
import UiButton from '@/components/ui/UiButton.vue'
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
    <UiButton
      variant="S"
      class="filter-reveal__btn"
      :class="{ 'is-open': open }"
      :aria-expanded="open"
      @click="onToggle"
    >
      <span class="filter-reveal__label">{{ btnLabel }}</span>
      <ArrowDown class="filter-reveal__arrow" aria-hidden="true" />
    </UiButton>
    <Transition name="filter-reveal">
      <div v-if="open" class="filter-reveal__panel">
        <slot />
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* UiButton S owns color/hover/focus. The two overrides are special cases:
   - padding restores the original text-button hit area (UiButton S is "hit area =
     text rectangle"; the reveal button wants a slightly larger tap target).
   - the slot label is laid out inline-flex so the chevron sits at a --space-2 gap
     (UiButton's default label is inline, no gap between slot children).
   Impact scope: this reveal button only. */
.filter-reveal__btn {
  padding: var(--space-1) var(--space-2);
}
.filter-reveal__btn :deep(.ui-btn__label) {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
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
  .filter-reveal__arrow,
  .filter-reveal-enter-active,
  .filter-reveal-leave-active {
    transition: none;
  }
  .filter-reveal__btn.is-open .filter-reveal__arrow {
    transform: none;
  }
}
</style>
