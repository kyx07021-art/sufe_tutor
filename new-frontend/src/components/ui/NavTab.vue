<script setup>
import UiButton from './UiButton.vue'

/**
 * NavTab - vertical navigation tab list (shared single source)
 * ------------------------------------------------------------
 * - The left-column section/tab switcher shared by SettingsPanel (settings
 *   sections) and FeedbackModal (report / tickets). Both previously hand-wrote
 *   an identical `<button v-for>` plus a byte-copied private CSS block
 *   (`.st-nav__item` / `.fb-nav__item`). This component is the single source
 *   (W17: one component owns the nav-tab responsibility; ADR 0004 §1 native
 *   element migration).
 * - Inherits the core button: every tab item IS a UiButton variant B (the
 *   existing "bare black text" button core), NOT a hand-rolled native button.
 *   UiButton contributes the hit/focus/ripple semantics; NavTab only re-skims
 *   the row geometry + selection fill (see the SPECIAL CASE comment in <style>).
 *   This keeps the dependency tree single-source: one button core, no second
 *   button implementation (coordinator discipline).
 * - props:
 *   - items: [{ id, label, disabled? }] — label is module copy (NOTIF_COPY),
 *     never a raw CJK literal (contract 6).
 *   - modelValue: active index (Number). The component emits update:modelValue
 *     and select; v-model or :model-value + @select both work.
 *   - ariaLabel: nav landmark label (a11y).
 *   - width: nav column width CSS value (default 160px).
 * - The active item keeps aria-current="true"; disabled items inherit UiButton's
 *   grayed disabled state (semantics preserved from the originals).
 * - Contract 6: zero raw CJK, zero inline style attributes (the width override
 *   rides the --nav-tab-w CSS variable data channel), zero v-html, zero runtime
 *   <style> injection; scoped CSS + design tokens only.
 */
const props = defineProps({
  items: { type: Array, required: true },
  modelValue: { type: Number, default: 0 },
  ariaLabel: { type: String, default: '' },
  width: { type: String, default: '160px' },
})
const emit = defineEmits(['update:modelValue', 'select'])

function onSelect(i) {
  if (props.items[i]?.disabled) return
  emit('update:modelValue', i)
  emit('select', i)
}
</script>

<template>
  <nav class="nav-tab" :aria-label="ariaLabel" :style="{ '--nav-tab-w': width }">
    <UiButton
      v-for="(item, i) in items"
      :key="item.id"
      variant="B"
      class="nav-tab__item"
      :class="{ 'is-active': modelValue === i }"
      :disabled="item.disabled"
      :aria-current="modelValue === i ? 'true' : undefined"
      @click="onSelect(i)"
    >
      {{ item.label }}
    </UiButton>
  </nav>
</template>

<style scoped>
/* Left nav column: padded, flex column, paper-raised surface (was .st-nav/.fb-nav). */
.nav-tab {
  flex: none;
  width: var(--nav-tab-w, 160px);
  box-sizing: border-box;
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  background: var(--paper-raised);
}

/* SPECIAL CASE (coordinator discipline): a nav row is UiButton variant B (the
   existing "bare black text" core) re-skinned as a compact left-aligned text row.
   WHY it deviates from UiButton defaults: the settings/feedback left nav is a
   list of small rounded rows (padding space-2 space-3, ~40px), NOT the 52px
   centered capsule UiButton B renders by default, and its hover/selection fill
   is the flat gray-10 the original .st-nav__item/.fb-nav__item used (UiButton
   B's default hover is a gray-15 ripple). BOUNDARY: every override is scoped to
   .nav-tab__item — no other UiButton consumer is affected; the item still
   inherits UiButton's hit area, focus ring, ripple timing and disabled state. */
.nav-tab__item {
  width: 100%;
  --btn-w: 100%;
  --btn-h: 40px;              /* compact nav row (UiButton B default 52px) */
  --btn-pad: var(--space-3);  /* left/right padding = space-3 (was .st-nav__item padding) */
  --btn-hover-bg: var(--gray-10); /* flat full-row hover fill (was .st-nav__item:hover) */
  justify-content: flex-start;
}
.nav-tab__item.is-active {
  background: var(--gray-10);
  font-weight: 500;
}
@media (prefers-reduced-motion: reduce) {
  .nav-tab__item {
    transition: none;
  }
}
</style>
