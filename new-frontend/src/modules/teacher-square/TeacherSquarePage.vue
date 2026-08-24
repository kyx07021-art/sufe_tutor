<script setup>
import { computed, onMounted, ref } from 'vue'
import UiButton from '@/components/ui/UiButton.vue'
import PageEnter from './PageEnter.vue'
import SecondBar from './SecondBar.vue'
import FilterReveal from './FilterReveal.vue'
import ThirdBar from './ThirdBar.vue'
import SubjectFilter from './SubjectFilter.vue'
import GenderFilter from './GenderFilter.vue'
import PersonalityFilter from './PersonalityFilter.vue'
import PriceFilter from './PriceFilter.vue'
import CardGrid from './CardGrid.vue'
import TeacherDetailModal from './TeacherDetailModal.vue'
import { fetchTeachers, mapTeacherResponseList } from './teachers-api.js'
import { makeTeacherSorter } from './sort.js'
import { useFilterApply } from './useFilterApply.js'
import { TEACHER_MATCH_DIMENSIONS } from './match-dimensions.js'
import { loadSortPref, saveSortPref, emptyFilters } from './prefs.js'
import { navigateToConversation } from './actions.js'
import { startTempConversation } from '@/modules/chat/index.js'
import { TEACHER_SQUARE_TEXT as T } from '@/constants/m-teacher-square.js'

/**
 * TeacherSquarePage - M7 A1 teacher-square page orchestrator (all batches)
 * -------------------------------------------------------
 * - M7-01: loads I-29 (live) or the raw mock dataset (mock), maps, renders
 *   loading / empty / error / ready states.
 * - M7-02: sort preference persists (localStorage); filters always reset.
 * - M7-03: local sort via makeTeacherSorter.
 * - M7-04/05: SecondBar (SortBar + OrderToggle + filter trigger).
 * - M7-06/07/08..11: FilterReveal + ThirdBar + four filter cards bound to the
 *   page-owned `filters` object.
 * - M7-12/13: shared match-group engine + useFilterApply immediate apply and
 *   animation replay (nonce re-mounts PageEnter/CardGrid on filter change).
 * - M7-14..17: PageEnter wrapper + CardGrid/TeacherCard.
 * - M7-18..22: TeacherDetailModal (left/middle/right + RatingStars + actions).
 */
const props = defineProps({
  /** 'live' = real I-29 fetch (fetcher injectable); 'mock' = raw mock dataset */
  source: { type: String, default: 'live', validator: (v) => ['live', 'mock'].includes(v) },
  fetcher: { type: Function, default: null },
})

const status = ref('loading') // loading | ready | empty | error
const allItems = ref([])
const sortKey = ref('match')
const order = ref('desc')
const filters = ref(emptyFilters())
const filtersOpen = ref(false)
const selectedTeacher = ref(null)

// M7-02: restore persisted sort preference; filter state always resets.
const pref = loadSortPref()
if (pref) {
  sortKey.value = pref.key
  order.value = pref.order
}

const sortBy = computed(() => makeTeacherSorter(sortKey.value, order.value))
const { groups, items: visibleItems, nonce } = useFilterApply({
  items: allItems,
  dimensions: TEACHER_MATCH_DIMENSIONS,
  filters: filters,
  sortBy,
})

async function load() {
  status.value = 'loading'
  let res
  if (props.source === 'mock') {
    const { MOCK_TEACHER_ITEMS } = await import('./mock-data.js')
    res = { ok: true, items: mapTeacherResponseList(MOCK_TEACHER_ITEMS) }
  } else {
    res = await fetchTeachers({
      sort: sortKey.value,
      order: order.value,
      filters: filters.value,
      fetcher: props.fetcher,
    })
  }
  if (res.ok) {
    allItems.value = res.items
    status.value = res.items.length ? 'ready' : 'empty'
  } else {
    status.value = 'error'
  }
}

function onSortKeyChange(key) {
  sortKey.value = key
  saveSortPref({ key, order: order.value })
  // local immediate re-sort (M7-13); server-side reload lands with M9-B1-3a
}

function onOrderChange(o) {
  order.value = o
  saveSortPref({ key: sortKey.value, order: o })
}

function toggleFilters() {
  filtersOpen.value = !filtersOpen.value
}

function onPriceChange({ min, max }) {
  filters.value.priceMin = min
  filters.value.priceMax = max
}

function openDetail(teacher) {
  selectedTeacher.value = teacher
}

function onModalOpenChange(v) {
  if (!v) selectedTeacher.value = null
}

async function onSendMessage(teacher) {
  // Route through the chat module boundary action (M4-26): it POSTs I-23, upserts
  // the row into the chat store (F7) and opens it, so navigating to /chat lands on
  // the created conversation. Returns null on failure (toast shown) — the modal
  // stays open so the user can retry.
  const conv = await startTempConversation(teacher.teacherId, T.FIRST_MESSAGE)
  if (!conv) return
  selectedTeacher.value = null
  try {
    await navigateToConversation(conv.conversationId)
  } catch (err) {
    // navigation failure after creation: the conversation exists, reachable
    // via the chat list; no user-visible error needed.
  }
}

function retry() {
  load()
}

onMounted(load)
</script>

<template>
  <section class="tsq" :aria-label="T.PAGE_TITLE">
    <SecondBar
      :sort-key="sortKey"
      :order="order"
      :disabled="status === 'loading'"
      @update:sort-key="onSortKeyChange"
      @update:order="onOrderChange"
      @filter-click="toggleFilters"
    />

    <FilterReveal :open="filtersOpen">
      <ThirdBar :label="T.FILTER_ARIA">
        <SubjectFilter v-model="filters.subjects" />
        <GenderFilter v-model="filters.gender" />
        <PersonalityFilter v-model="filters.personalities" />
        <PriceFilter
          :model-value="{ min: filters.priceMin, max: filters.priceMax }"
          @update:model-value="onPriceChange"
        />
      </ThirdBar>
    </FilterReveal>

    <div class="tsq__body">
      <p v-if="status === 'loading'" class="tsq__status" data-state="loading">{{ T.LOADING }}</p>
      <div v-else-if="status === 'error'" class="tsq__status tsq__status--error" data-state="error">
        <span>{{ T.LOAD_FAIL }}</span>
        <UiButton variant="B1" size="sm" class="tsq__retry" @click="retry">{{ T.RETRY }}</UiButton>
      </div>
      <p v-else-if="status === 'empty'" class="tsq__status" data-state="empty">{{ T.EMPTY }}</p>
      <PageEnter v-else :key="nonce" class="tsq__enter">
        <CardGrid :items="visibleItems" @open="openDetail" />
      </PageEnter>
    </div>

    <TeacherDetailModal
      :open="!!selectedTeacher"
      :teacher="selectedTeacher"
      @update:open="onModalOpenChange"
      @send-message="onSendMessage"
    />
  </section>
</template>

<style scoped>
.tsq {
  padding: var(--space-4) 5% var(--space-8);
}
.tsq__body {
  margin-top: var(--space-4);
}
.tsq__status {
  color: var(--gray-60);
  text-align: center;
  padding: var(--space-6) 0;
}
.tsq__status--error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
}
</style>
