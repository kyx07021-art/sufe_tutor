<script setup>
import { computed } from 'vue'
import UiIcon from '@/components/ui/UiIcon.vue'

/**
 * RatingStars - M7-20a five-star proportional fill
 * -------------------------------------------------------
 * - A row of 5 yellow stars. The filled region is a continuous rectangle whose
 *   right edge sits exactly at (score / 5) of the row width (gap 0 keeps the
 *   geometry exact; the star SVGs carry their own intrinsic margins).
 * - Cell i (0..4) fills clamp(score - i, 0, 1) of its width: stars left of the
 *   boundary are full, the boundary star shows the fractional part, stars right
 *   are outline-only.
 * - CSP-safe: per-cell fill is a CSS custom property written via Vue `:style`
 *   (the CSSOM setProperty channel), never the `style=` literal. No events,
 *   no v-html, no runtime style-element injection. Static — nothing to gate for
 *   reduced-motion.
 */
const props = defineProps({
  /** numeric rating in [0, 5]; clamped */
  score: { type: Number, default: 0 },
  /** star pixel size (width and height) */
  size: { type: [Number, String], default: 20 },
  /** optional explicit accessibility label; falls back to "x out of 5" */
  ariaLabel: { type: String, default: '' },
})

const clampedScore = computed(() => {
  const n = Number(props.score)
  if (Number.isNaN(n)) return 0
  return Math.min(5, Math.max(0, n))
})

const resolvedLabel = computed(() => {
  if (props.ariaLabel) return props.ariaLabel
  const shown = Number(clampedScore.value.toFixed(1))
  return `${shown} out of 5`
})

const starSizeCss = computed(() =>
  typeof props.size === 'string' ? props.size : `${props.size}px`
)

/** fill percentage for star index i (0..4): clamp(score - i, 0, 1) */
function cellFill(i) {
  const frac = Math.min(1, Math.max(0, clampedScore.value - i))
  return `${Math.round(frac * 100)}%`
}
</script>

<template>
  <div
    class="rating-stars"
    role="img"
    :aria-label="resolvedLabel"
    :style="{ '--star-size': starSizeCss }"
  >
    <span
      v-for="i in 5"
      :key="i"
      class="rating-stars__cell"
      :style="{ '--fill': cellFill(i - 1) }"
    >
      <UiIcon class="rating-stars__star" name="star" :size="size" />
      <UiIcon
        class="rating-stars__star rating-stars__star--filled"
        name="star-filled"
        :size="size"
      />
    </span>
  </div>
</template>

<style scoped>
/* Row: inline-flex, fixed geometry (5 cells), never overflows at 375px. */
.rating-stars {
  display: inline-flex;
  align-items: center;
}

/* Each cell stacks the outline star and the filled star in one grid slot. */
.rating-stars__cell {
  position: relative;
  display: grid;
  place-items: center;
  flex: none;
  width: var(--star-size);
  height: var(--star-size);
}

.rating-stars__star {
  grid-area: 1 / 1;
  width: var(--star-size);
  height: var(--star-size);
  color: var(--warn);
}

/* Filled layer is left-anchored and clipped to the per-cell fill fraction. */
.rating-stars__star--filled {
  color: var(--warn);
  clip-path: inset(0 calc(100% - var(--fill)) 0 0);
}
</style>
