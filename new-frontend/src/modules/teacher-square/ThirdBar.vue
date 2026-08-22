<script setup>
/**
 * ThirdBar - M7-07 third top bar container + filter project cards
 * -----------------------------------------------------------------
 * - Presentational layout only: lays out the page-provided filter cards
 *   (default slot) as one horizontal row that fills the full width.
 * - Left/right inset 5% (matches the page edge blank); cards share the width
 *   equally with a --space-3 gap; wraps 2x2 on narrow (<=720px) screens with
 *   no horizontal overflow at 375px.
 * - Owns zero filter state; the page passes the four filter cards through the
 *   default slot.
 */
defineProps({
  /** Optional accessible label for the third-bar region. */
  label: { type: String, default: '' },
})
</script>

<template>
  <div class="tsq__third-bar" role="group" :aria-label="label || undefined">
    <slot />
  </div>
</template>

<style scoped>
.tsq__third-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
  gap: var(--space-3);
  padding-inline: 5%; /* page edge blank, matches .tsq page inset */
}

/* Slot cards: equal flex share, fill the full container width. */
.tsq__third-bar > :deep(*) {
  flex: 1 1 0;
  min-width: 0;
}

/* Narrow screens: wrap 2x2 instead of one 4-wide row. */
@media (max-width: 720px) {
  .tsq__third-bar > :deep(*) {
    flex: 1 1 40%;
  }
}
</style>
