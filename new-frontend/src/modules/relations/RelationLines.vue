<script setup>
/**
 * M3-06 Static dashed-line rendering for the C1 relations module.
 *
 * Renders one dashed SVG curve per related-user edge. Each curve is built by
 * the M3-04 bend algorithm from a segment's shared endpoints. The parent board
 * owns z-ordering; this layer is decorative (pointer-events: none).
 *
 * Static by design: the flow animation is NOT applied here. M3-07's flow.css
 * targets `.rel-line__path` under `.relations-board.is-flowing` and animates
 * stroke-dashoffset; the class contract below enables it.
 */
import { computed } from 'vue'
import { buildCurves } from './curve.js'

const props = defineProps({
  // One entry per related user.
  // { from: {x,y}, to: {x,y}, edgeCount } — from = outer avatar center, to = self center.
  segments: { type: Array, default: () => [] },
  // Board size in px; SVG user units map 1:1 to px (no viewBox).
  size: { type: Object, required: true },
})

// Flatten each segment's curves into a single ordered list. Curves are static
// per data load, so the flat index is a stable key (no reordering concerns).
const allCurves = computed(() =>
  props.segments.flatMap((seg) => buildCurves(seg.edgeCount, seg.from, seg.to)),
)
</script>

<template>
  <svg
    class="rel-lines"
    :width="size.w"
    :height="size.h"
    aria-hidden="true"
  >
    <path
      v-for="(curve, idx) in allCurves"
      :key="idx"
      class="rel-line__path"
      :d="curve.path"
    />
  </svg>
</template>

<style scoped>
.rel-lines {
  /* Module tokens single source: stroke color / width / dash pattern. */
  --rel-line-color: var(--gray-70);
  --rel-line-width: 2px;
  --rel-dash: 6 6;

  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.rel-line__path {
  fill: none;
  stroke: var(--rel-line-color);
  stroke-width: var(--rel-line-width);
  stroke-dasharray: var(--rel-dash);
  stroke-linecap: round;
  stroke-linejoin: round;
}
</style>
