<script setup>
import { computed } from 'vue'
import UiButton from '@/components/ui/UiButton.vue'
import SortBar from '@/components/shared/SortBar.vue'
import OrderToggle from '@/components/shared/OrderToggle.vue'
import { TEACHER_SQUARE_TEXT as T } from '@/constants/m-teacher-square.js'

/**
 * SecondBar - M7-04 second top bar (sort tabs + order toggle + filter button)
 * -------------------------------------------------------
 * - Left: shared OrderToggle (M7-05, single source in components/shared).
 * - Middle: shared SortBar tabs (mutually exclusive, active = gray-10); only the
 *   v-model-compatible `update:modelValue` event is consumed (no double-bind).
 * - Right: filter button (A1); the third-top-bar expand wiring is M7-06.
 */
const props = defineProps({
  sortKey: { type: String, default: 'match' },
  order: { type: String, default: 'desc' },
  showFilter: { type: Boolean, default: true },
})

const emit = defineEmits(['update:sortKey', 'update:order', 'filter-click'])

const TABS = computed(() => [
  { key: 'match', label: T.SORT_MATCH },
  { key: 'rating', label: T.SORT_RATING },
  { key: 'exp', label: T.SORT_EXP },
  { key: 'price', label: T.SORT_PRICE },
])
</script>

<template>
  <div class="second-bar">
    <OrderToggle
      :order="order"
      :aria-label="order === 'desc' ? T.SORT_DESC : T.SORT_ASC"
      @update:order="emit('update:order', $event)"
    />
    <SortBar
      :options="TABS"
      :model-value="sortKey"
      :aria-label="T.SORT_ARIA"
      class="second-bar__tabs"
      @update:model-value="emit('update:sortKey', $event)"
    />
    <UiButton v-if="showFilter" variant="A1" class="second-bar__filter" :lift="false" @click="emit('filter-click')">
      {{ T.FILTER }}
    </UiButton>
  </div>
</template>

<style scoped>
.second-bar {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.second-bar__tabs {
  flex: 1 1 auto;
  min-width: 0;
}
.second-bar__tabs :deep(.sort-bar) {
  display: flex;
  width: 100%;
}
.second-bar__tabs :deep(.sort-bar__tab) {
  flex: 1 1 0;
  white-space: nowrap;
}
.second-bar__filter {
  margin-left: auto;
}
@media (max-width: 520px) {
  .second-bar {
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .second-bar__filter {
    margin-left: 0;
  }
  .second-bar__tabs {
    flex: 1 1 100%;
    order: 2;
  }
  .second-bar__filter {
    order: 3;
    width: 100%;
  }
}
</style>
