<script setup>
/**
 * DemandGrid - A2 three-column demand card grid (M8-01)
 * -------------------------------------------------------
 * - Three columns (single column on mobile); slot width = page width 28.33%, left/right
 *   gutters 5%, inter-card gap 2.5% (plan A2 dynamic rule, expressed precisely as an
 *   explicit 7-column percentage grid). Fixed row height (--demand-card-h); cards fill
 *   the full slot.
 * - Pure layout component: children are the cards (DemandCard) and the plus slot
 *   (DemandPlusSlot, M8-03). The plus slot is always the last child -> nth-child
 *   auto-locates it to the next free slot (row-major fill, then wrap).
 * - Mobile (<=640px) single column: 5% + 90% + 5%.
 * - G5: no horizontal overflow at 375px (column percentages always sum to 100%).
 */
</script>

<template>
  <div class="demand-grid">
    <slot />
  </div>
</template>

<style scoped>
.demand-grid {
  --demand-card-h: 240px;
  --demand-card-row-gap: var(--space-5);

  display: grid;
  grid-template-columns: 5% 28.33% 2.5% 28.33% 2.5% 28.33% 5%;
  grid-auto-rows: var(--demand-card-h);
  row-gap: var(--demand-card-row-gap);
  width: 100%;
  box-sizing: border-box;
}

/* Row-major fill: the three card slots per row (cols 2/4/6) */
.demand-grid > :nth-child(3n + 1) { grid-column: 2; }
.demand-grid > :nth-child(3n + 2) { grid-column: 4; }
.demand-grid > :nth-child(3n + 3) { grid-column: 6; }

/* Mobile: single column (same-specificity overrides desktop nth-child placement; later source order wins) */
@media (max-width: 640px) {
  .demand-grid {
    grid-template-columns: 5% 90% 5%;
  }
  .demand-grid > :nth-child(3n + 1),
  .demand-grid > :nth-child(3n + 2),
  .demand-grid > :nth-child(3n + 3) {
    grid-column: 2;
  }
}
</style>
