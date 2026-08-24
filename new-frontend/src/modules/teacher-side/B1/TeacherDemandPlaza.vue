<script setup>
/**
 * TeacherDemandPlaza - B1 demand plaza page
 * ------------------------------------------
 * Assembles every B1 base unit:
 * - 2a load+mapping (demands-service / demands-model) with loading/error/empty states
 * - 3a sort tabs (shared SortBar) + preference persistence (sort-state)
 * - 3b order toggle (OrderToggle) -> server reload
 * - 4 filter reveal (FilterReveal) + body shift
 * - 5a/5b/5c subject/gender/price filter cards
 * - 5d1 dimension-table-driven match grouping (shared useMatchGroup)
 * - 5d2 immediate apply + entrance replay (animateKey remount)
 * - 5d3 filter reset
 * - 1b grid layout (TeacherDemandGrid) + 6 cards (M8 shared DemandCard mode='teacher')
 * - 7 card click -> conversation intent + cap toast
 * - 2b entry animation (cell stagger in grid CSS, replayed via animateKey)
 */
import { computed, onMounted, ref, watch } from 'vue'
import { TEACHER_COPY } from '@/constants/ui.js'
import { showToast } from '@/composables/useToast.js'
import {
  matchGroup,
  computeMatchCount,
  activeDimCount,
} from '@/components/shared/useMatchGroup.js'
import SortBar from '@/components/shared/SortBar.vue'
import UiButton from '@/components/ui/UiButton.vue'
import { loadDemands } from './demands-service.js'
import { compareBySort } from './demands-model.js'
import { loadSortState, saveSortState, resetFilters } from './sort-state.js'
import { useEntryReveal } from './entry-reveal.js'
import { openConversationFromDemand } from './card-action.js'
import TeacherDemandGrid from './TeacherDemandGrid.vue'
import DemandCard from '@/modules/my-demands/DemandCard.vue'
import OrderToggle from '@/components/shared/OrderToggle.vue'
import FilterReveal from './FilterReveal.vue'
import FilterSubject from './FilterSubject.vue'
import FilterGender from './FilterGender.vue'
import FilterPrice from './FilterPrice.vue'

/* ---- sort / filter state ---- */
const sort = ref('match')
const order = ref('desc')
const filters = ref(resetFilters())
const filterOpen = ref(false)

/* ---- data state ---- */
const items = ref([])
const loading = ref(true)
const error = ref('')

const { animateKey, replay } = useEntryReveal()

const sortOptions = [
  { key: 'match', label: TEACHER_COPY.B1_SORT_MATCH },
  { key: 'price', label: TEACHER_COPY.B1_SORT_PRICE },
]

/* ---- demand dimensions (B1 three dims) for shared useMatchGroup ---- */
const demandDimensions = [
  {
    key: 'subject',
    active: (f) => Array.isArray(f.subjects) && f.subjects.length > 0,
    matches: (item, f) => f.subjects.includes(item.subject),
  },
  {
    key: 'gender',
    active: (f) => !!f.gender,
    matches: (item, f) => item.preferredGender === f.gender,
  },
  {
    key: 'price',
    active: (f) => f.priceMin != null || f.priceMax != null,
    matches: (item, f) => {
      if (item.budgetMin == null && item.budgetMax == null) return true
      const lo = item.budgetMin != null ? item.budgetMin : item.budgetMax
      const hi = item.budgetMax != null ? item.budgetMax : item.budgetMin
      const fLo = f.priceMin != null ? f.priceMin : -Infinity
      const fHi = f.priceMax != null ? f.priceMax : Infinity
      return lo <= fHi && hi >= fLo
    },
  },
]

/* ---- derived display list: filter -> group by matchCount -> sort within group ---- */
const groups = computed(() =>
  matchGroup(items.value, filters.value, demandDimensions, compareBySort(sort.value, order.value)),
)
const visibleCount = computed(() => groups.value.reduce((n, g) => n + g.items.length, 0))

/* Match-count badge consistency (medium-5): when filters are active the card badge
   shows the CLIENT-computed active-dim hits (same number as the group header), not the
   server matchCount; with no active filters the "hit N" badge is hidden entirely. */
const hasActiveFilters = computed(() => activeDimCount(filters.value, demandDimensions) > 0)

const priceFilter = computed({
  get: () => ({ priceMin: filters.value.priceMin, priceMax: filters.value.priceMax }),
  set: (v) => {
    filters.value.priceMin = v.priceMin
    filters.value.priceMax = v.priceMax
  },
})

/* ---- lifecycle / data ---- */
onMounted(async () => {
  const saved = loadSortState()
  sort.value = saved.sort
  order.value = saved.order
  await reload()
})

async function reload() {
  loading.value = true
  error.value = ''
  try {
    const data = await loadDemands({ sort: sort.value, order: order.value })
    items.value = data.items
    replay()
  } catch (e) {
    error.value = TEACHER_COPY.B1_ERROR
  } finally {
    loading.value = false
  }
}

/* ---- sort / order ---- */
function onSortSelect(key) {
  if (key === sort.value) return
  sort.value = key
  saveSortState({ sort: sort.value, order: order.value })
  reload()
}

function onToggleOrder() {
  order.value = order.value === 'desc' ? 'asc' : 'desc'
  saveSortState({ sort: sort.value, order: order.value })
  reload()
}

/* ---- filter immediate apply (B1-5d2) + reset (B1-5d3) ----
   Any filter mutation re-derives `groups` reactively AND bumps animateKey to
   replay the grid entrance animation (the .b1__groups remount restarts the
   cell-stagger keyframes). resetAllFilters replaces the whole filters object,
   which the deep watch below also catches -> single replay. */
watch(filters, () => replay(), { deep: true })

function resetAllFilters() {
  filters.value = resetFilters()
}

/* ---- card click (B1-7) ---- */
function onCardOpen(demand) {
  openConversationFromDemand(demand)
  showToast(TEACHER_COPY.B1_SESSION_CAP)
}
</script>

<template>
  <section class="b1">
    <h2 class="b1__title">{{ TEACHER_COPY.B1_TITLE }}</h2>

    <div class="b1__bar">
      <SortBar
        :options="sortOptions"
        :model-value="sort"
        :disabled="loading"
        aria-label="sort"
        @update:model-value="onSortSelect"
      />
      <OrderToggle :order="order" :disabled="loading" aria-label="order" @toggle="onToggleOrder" />
      <span class="b1__bar-spacer" />
      <FilterReveal
        :open="filterOpen"
        :btn-label="TEACHER_COPY.B1_FILTER_BTN"
        @toggle="filterOpen = !filterOpen"
      >
        <div class="b1__filters">
          <FilterSubject v-model="filters.subjects" />
          <FilterGender v-model="filters.gender" />
          <FilterPrice v-model="priceFilter" />
          <div class="b1__filters-reset">
            <UiButton variant="S1" class="b1__reset" @click="resetAllFilters">
              {{ TEACHER_COPY.B1_FILTER_RESET }}
            </UiButton>
          </div>
        </div>
      </FilterReveal>
    </div>

    <div class="b1__body">
      <!-- B1-4 mask hangs over the card area; tapping outside the filter panel dismisses it
           (mask covers only the body, never the bar/panel). -->
      <div
        v-if="filterOpen"
        class="b1__body-mask"
        aria-hidden="true"
        @click="filterOpen = false"
      ></div>
      <p v-if="loading" class="b1__state">{{ TEACHER_COPY.B1_LOADING }}</p>
      <p v-else-if="error" class="b1__state b1__state--error">{{ error }}</p>
      <p v-else-if="!visibleCount" class="b1__state">{{ TEACHER_COPY.B1_EMPTY }}</p>
      <div v-else :key="animateKey" class="b1__groups">
        <div
          v-for="group in groups"
          :key="group.count == null ? 'all' : group.count"
          class="b1__group"
        >
          <p v-if="group.count != null" class="b1__group-hint">
            {{ TEACHER_COPY.B1_MATCH_COUNT(group.count) }}
          </p>
          <TeacherDemandGrid :items="group.items">
            <template #card="{ item }">
              <div class="b1-card">
                <DemandCard :demand="item" mode="teacher" @select="onCardOpen(item)" />
                <span class="b1-card__badges" aria-hidden="true">
                  <span class="b1-card__badge b1-card__badge--score">
                    {{ TEACHER_COPY.B1_MATCH_SCORE(item.matchScore) }}
                  </span>
                  <span v-if="hasActiveFilters" class="b1-card__badge b1-card__badge--count">
                    {{ TEACHER_COPY.B1_MATCH_COUNT(computeMatchCount(item, filters, demandDimensions)) }}
                  </span>
                </span>
              </div>
            </template>
          </TeacherDemandGrid>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.b1 {
  padding: var(--space-6) var(--space-6);
  background: var(--paper);
  color: var(--ink);
  min-height: 100vh;
}
.b1__body {
  position: relative;
}
/* B1-4 mask hangs over the card area (below the bar/panel); tap dismisses the filter */
.b1__body-mask {
  position: absolute;
  inset: 0;
  z-index: 5;
}
.b1__title {
  font-size: var(--fs-xl);
  line-height: var(--lh-tight);
  margin-bottom: var(--space-5);
}
.b1__bar {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  flex-wrap: wrap;
  margin-bottom: var(--space-5);
}
.b1__bar-spacer {
  flex: 1;
}
.b1__filters {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--space-5);
  padding: var(--space-4);
  background: var(--paper-raised);
  border-radius: var(--radius-md);
}
.b1__filters-reset {
  display: flex;
  justify-content: flex-end;
  align-items: center;
}
/* reset link styling is UiButton variant S1 (underlined gray-60, focus -> ink) */
.b1__state {
  padding: var(--space-7) 0;
  text-align: center;
  color: var(--gray-50);
}
.b1__state--error {
  color: var(--danger);
}
.b1__groups {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}
.b1__group-hint {
  font-size: var(--fs-sm);
  color: var(--gray-60);
  margin-bottom: var(--space-2);
}
.b1-card {
  position: relative;
  height: 100%;
}
.b1-card__badges {
  position: absolute;
  top: var(--space-2);
  right: var(--space-2);
  z-index: 2;
  display: inline-flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-1);
  max-width: 70%;
}
.b1-card__badge {
  font-size: var(--fs-xs);
  line-height: 1;
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-pill);
  white-space: nowrap;
}
.b1-card__badge--score {
  background: var(--brand-soft);
  color: var(--brand);
}
.b1-card__badge--count {
  background: var(--gray-10);
  color: var(--gray-70);
}
</style>
