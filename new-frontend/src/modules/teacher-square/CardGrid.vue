<script setup>
import TeacherCard from './TeacherCard.vue'

/**
 * CardGrid - M7-15 teacher-card grid (4 columns desktop / 2 columns mobile)
 * -------------------------------------------------------------------------
 * - Renders one TeacherCard per mapped teacher item. The card click is
 *   forwarded up as `open(teacher)` so the page can open the detail modal.
 * - Edge insets are owned by the page (.tsq 5% padding); this grid only
 *   handles the column tracks and the gaps between cards.
 * - Empty state is owned by the page; this component renders nothing when
 *   `items` is empty.
 */
defineProps({
  items: { type: Array, default: () => [] },
})

const emit = defineEmits(['open'])
</script>

<template>
  <div v-if="items.length" class="card-grid">
    <TeacherCard
      v-for="t in items"
      :key="t.teacherId"
      :teacher="t"
      class="card-grid__cell"
      @click="emit('open', t)"
    />
  </div>
</template>

<style scoped>
.card-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: min(2.5%, var(--space-4));
  align-items: start;
}
.card-grid__cell {
  min-width: 0;
}
@media (max-width: 720px) {
  .card-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
