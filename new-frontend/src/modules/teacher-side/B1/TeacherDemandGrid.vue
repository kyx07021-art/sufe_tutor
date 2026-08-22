<script setup>
/**
 * TeacherDemandGrid - B1-1b demand grid layout
 * ---------------------------------------------
 * - 4 columns desktop / 2 columns mobile (<=480px), minmax(0,1fr) so cells never
 *   overflow (G5 geometry: no horizontal overflow at 375).
 * - Presentational: renders the slotted `#card` per item; the B1 page supplies
 *   the card content (M9-B1-6 consumes M8 shared DemandCard with mode='teacher').
 */
defineProps({
  items: { type: Array, default: () => [] },
})
</script>

<template>
  <ul class="td-grid" role="list">
    <li v-for="item in items" :key="item.id" class="td-grid__cell" role="listitem">
      <slot name="card" :item="item" />
    </li>
  </ul>
</template>

<style scoped>
.td-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--space-4);
  margin: 0;
  padding: 0;
  list-style: none;
  width: 100%;
}
@media (max-width: 480px) {
  .td-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
  }
}

/* B1-2b entry animation: cells stagger in on grid mount (replayed by the page via :key remount) */
.td-grid__cell {
  animation: cell-enter var(--dur-base) var(--ease-out) backwards;
}
.td-grid__cell:nth-child(2) { animation-delay: 40ms; }
.td-grid__cell:nth-child(3) { animation-delay: 80ms; }
.td-grid__cell:nth-child(4) { animation-delay: 120ms; }
.td-grid__cell:nth-child(5) { animation-delay: 160ms; }
.td-grid__cell:nth-child(6) { animation-delay: 200ms; }
.td-grid__cell:nth-child(7) { animation-delay: 240ms; }
.td-grid__cell:nth-child(8) { animation-delay: 280ms; }
@keyframes cell-enter {
  from { opacity: 0; transform: translateY(var(--space-3)); }
  to { opacity: 1; transform: none; }
}
@media (prefers-reduced-motion: reduce) {
  .td-grid__cell { animation: none; }
}
</style>
