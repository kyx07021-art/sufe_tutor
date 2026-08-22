/**
 * useFilterApply.js - M7-13 filter-change immediate apply + entrance-animation replay
 * -------------------------------------------------------------------------------------
 * Pure-reactive wrapper over the shared dimension-table-driven matchGroup engine.
 * - "filter change => apply now": every filter toggle/keystroke immediately re-derives
 *   the grouped and flattened teacher list locally (no server round-trip).
 * - "animation replay": `nonce` is a Ref<number> bumped on every deep filters change,
 *   so the page can key a transition or re-run the entrance effect
 *   (e.g. <CardGrid :key="nonce"> or a watcher on nonce).
 *
 * Returns:
 *   groups  - reactive array [{ count, items }] from the shared matchGroup
 *   items   - reactive flattened teacher array (all groups concatenated, group order kept)
 *   nonce   - Ref<number>; +1 each time filters deep-changes (JSON snapshot compare)
 *   replay  - () => void manual nonce bump (data refresh re-triggers animation)
 */

import { computed, ref, watch, unref } from 'vue'
import { matchGroup } from '../../components/shared/useMatchGroup.js'

export function useFilterApply({ items, dimensions, filters, sortBy }) {
  // Grouped view: re-derived reactively whenever the item source, the reactive
  // filter state, or the sort comparator changes.
  const groups = computed(() =>
    matchGroup(unref(items), unref(filters), dimensions, unref(sortBy))
  )

  // Flattened list: concat of all groups in matchCount-descending order.
  const flatItems = computed(() =>
    groups.value.reduce((acc, g) => acc.concat(g.items), [])
  )

  // Animation replay key. Compare a JSON snapshot of the (small) filter object so
  // the bump fires exactly once per real filter change (deep watch, JSON dedupe).
  const nonce = ref(0)
  let prevFiltersKey = JSON.stringify(unref(filters))

  watch(
    () => unref(filters),
    (val) => {
      const key = JSON.stringify(val)
      if (key !== prevFiltersKey) {
        prevFiltersKey = key
        nonce.value += 1
      }
    },
    { deep: true }
  )

  // Manual replay trigger (e.g. data refresh while filters stay identical).
  const replay = () => {
    nonce.value += 1
  }

  return { groups, items: flatItems, nonce, replay }
}
