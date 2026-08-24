<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import UiDropdownPanel from '@/components/ui/UiDropdownPanel.vue'
import ArrowDown from '@/assets/svg/arrow-down.svg'

/**
 * FilterTrigger - shared filter-trigger dropdown field control (AK-N-㉛)
 * ------------------------------------------------------------------------------
 * - Wraps the core anchored-panel shell (UiDropdownPanel) behind a uniform field-
 *   control trigger: optional title (label, .ui-title-sm) + a 44px rounded-rectangle
 *   button (--input-h / --radius-md / 1px --line / --fs-sm) with left-aligned text +
 *   chevron. Resting text = placeholder (gray-50); a non-empty valueText renders ink.
 * - The panel is UiDropdownPanel variant B with a default slot (consumer option rows);
 *   it closes on outside pointerdown (UiDropdownPanel @close) or Escape (which returns
 *   focus to the trigger). The anchor/positioning/focus-trap all live in UiDropdownPanel
 *   — FilterTrigger only owns the open state + the field-control trigger.
 * - SPECIAL CASE (why not UiButton/UiDropdown): the trigger is a *field control* (a
 *   select-like silhouette), not an action button — 44px / radius-md / --line / fs-sm
 *   is the filter-bar field silhouette the user demanded unified (AK-N-㉛). No UiButton
 *   variant matches it, so the trigger is a small primitive here; every value comes from
 *   tokens (--input-h/--radius-md/--line/--fs-sm), so a core-token change propagates.
 *   Impact scope: the shared trigger only; the three filter cards + price inputs consume
 *   it unchanged.
 * - Exposes close() so a single-select consumer can close on pick.
 * - Contract 6: zero inline event/style attrs, zero raw CJK in template/comments; tokens only.
 */
const props = defineProps({
  /** title above the trigger (rendered with the global .ui-title-sm) */
  label: { type: String, default: '' },
  /** resting text shown when valueText is empty (gray-50) */
  placeholder: { type: String, default: '' },
  /** current selection display ('' = none -> placeholder). Consumers map ids to labels. */
  valueText: { type: String, default: '' },
  /** explicit accessible name for the trigger (falls back to label) */
  ariaLabel: { type: String, default: '' },
  /** panel width = trigger width (common for single-column lists) */
  matchWidth: { type: Boolean, default: false },
  /** explicit panel width (CSS length). Overrides matchWidth; viewport-clamped by the anchor. */
  panelWidth: { type: String, default: '' },
})

const open = ref(false)
const triggerRef = ref(null)

const hasValue = computed(() => props.valueText !== '')

function toggle() {
  open.value = !open.value
}

/** Programmatic close (single-select pick / Escape): returns focus to the trigger. */
function close() {
  if (!open.value) return
  open.value = false
  triggerRef.value?.focus()
}

function onDocKeydown(e) {
  if (open.value && e.key === 'Escape') close()
}

watch(open, (val) => {
  if (val) document.addEventListener('keydown', onDocKeydown, true)
  else document.removeEventListener('keydown', onDocKeydown, true)
})

onBeforeUnmount(() => document.removeEventListener('keydown', onDocKeydown, true))

defineExpose({ close, open })
</script>

<template>
  <div class="filter-trigger">
    <div v-if="label" class="filter-trigger__label ui-title-sm">{{ label }}</div>
    <button
      ref="triggerRef"
      type="button"
      class="filter-trigger__btn"
      :class="{ 'is-open': open, 'is-empty': !hasValue }"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :aria-label="ariaLabel || label || undefined"
      @click="toggle"
    >
      <span class="filter-trigger__text">{{ hasValue ? valueText : placeholder }}</span>
      <ArrowDown class="filter-trigger__chevron" aria-hidden="true" />
    </button>

    <UiDropdownPanel
      :open="open"
      :trigger="triggerRef"
      align="down"
      align-x="left"
      :match-width="matchWidth"
      :width="panelWidth"
      role="group"
      :aria-label="label || undefined"
      @close="open = false"
    >
      <slot />
    </UiDropdownPanel>
  </div>
</template>

<style scoped>
.filter-trigger {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: var(--space-2);
  width: 100%;
  max-width: 100%;
  min-width: 0;
}

/* field-control trigger: 44px rounded rectangle, --line border, fs-sm, left-aligned + chevron.
   Consumes tokens only (see header SPECIAL CASE for why this is not a UiButton variant). */
.filter-trigger__btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  box-sizing: border-box;
  width: 100%;
  height: var(--input-h);
  padding: 0 var(--space-3);
  border: var(--border-w) solid var(--line);
  border-radius: var(--radius-md);
  background: var(--paper);
  color: var(--ink);
  font-size: var(--fs-sm);
  line-height: 1;
  cursor: pointer;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  transition:
    border-color var(--dur-sm) var(--ease-out),
    box-shadow var(--dur-sm) var(--ease-out);
}
.filter-trigger__btn:hover,
.filter-trigger__btn:focus-visible {
  border-color: var(--gray-60);
}
.filter-trigger__btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--brand);
}

.filter-trigger__text {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
}
.filter-trigger__btn.is-empty .filter-trigger__text {
  color: var(--gray-50);
}
.filter-trigger__chevron {
  flex: none;
  width: 1em;
  height: 1em;
  color: var(--gray-50);
  transition: transform var(--dur-sm) var(--ease-out);
}
.filter-trigger__btn.is-open .filter-trigger__chevron {
  transform: rotate(180deg);
}

@media (prefers-reduced-motion: reduce) {
  .filter-trigger__btn,
  .filter-trigger__chevron {
    transition: none;
  }
  .filter-trigger__btn.is-open .filter-trigger__chevron {
    transform: none;
  }
}
</style>
