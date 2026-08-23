<script setup>
/**
 * LandingGallery - M1 image corridor (structure M1-06 + drag M1-07a + drift
 * M1-07b + edge mask M1-08 + edge shrink M1-09)
 * ----------------------------------------------------------------------------
 * - 800px rounded images (4:3), three identical copies of the 8-image sequence
 *   in one flex track (a single period = 8 images + 8 gaps, so each copy is an
 *   exact `scrollWidth / 3` period -> scrollLeft modulo wrap is pixel-exact).
 * - scrollLeft is modulo-wrapped into [seqW, 2*seqW) on every scroll (M1-06):
 *   the middle copy is always the visible "real" one; jumping a full period
 *   preserves the on-screen picture (infinite loop). Initial = middle copy.
 * - M1-07a drag: pointer-drag sets scrollLeft (the wrap handles the loop).
 * - M1-07b drift: idle auto-scroll, pauses on hover/drag/offscreen/reduced.
 * - M1-08 edge mask: static horizontal fade mask (plain CSS import below).
 * - M1-09 edge shrink: per-image `--g-scale` via CSSOM; CSS transform below.
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { LANDING_COPY } from '@/constants/m-landing.js'
import { useGalleryDrag } from './useGalleryDrag'
import { useGalleryDrift } from './useGalleryDrift'
import { useGalleryShrink } from './useGalleryShrink'
import { useGalleryWheel } from './useGalleryWheel'
import './landing-gallery-mask.css'
import gallery1 from '@/assets/img/gallery-1.png'
import gallery2 from '@/assets/img/gallery-2.png'
import gallery3 from '@/assets/img/gallery-3.png'
import gallery4 from '@/assets/img/gallery-4.png'
import gallery5 from '@/assets/img/gallery-5.png'
import gallery6 from '@/assets/img/gallery-6.png'
import gallery7 from '@/assets/img/gallery-7.png'
import gallery8 from '@/assets/img/gallery-8.png'

const GALLERY_IMAGES = [gallery1, gallery2, gallery3, gallery4, gallery5, gallery6, gallery7, gallery8]

const viewport = ref(null)
let seqW = 0
let raf = 0

// M1-07a / M1-07b / M1-09 (+ wheel): bind to the same viewport element
const { isDragging } = useGalleryDrag(viewport)
useGalleryDrift(viewport, { speed: 40 })
useGalleryShrink(viewport)
useGalleryWheel(viewport)

function measureSeqW() {
  const el = viewport.value
  if (!el) return 0
  return el.scrollWidth / 3 // three identical copies
}

/** Clamp scrollLeft into [seqW, 2*seqW); jump by exactly one period (visual position preserved). */
function clampScroll() {
  const el = viewport.value
  if (!el || !seqW) return
  const { scrollLeft } = el
  if (scrollLeft < seqW) {
    el.scrollLeft = scrollLeft + seqW
  } else if (scrollLeft >= seqW * 2) {
    el.scrollLeft = scrollLeft - seqW
  }
}

function onScroll() {
  // batch into one rAF so a drag/momentum stream does at most one jump per frame
  if (raf) return
  raf = requestAnimationFrame(() => {
    raf = 0
    clampScroll()
  })
}

function onResize() {
  seqW = measureSeqW()
  clampScroll()
}

onMounted(() => {
  seqW = measureSeqW()
  clampScroll() // after nextTick the fixed-width track is laid out; land on the middle copy
  viewport.value.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', onResize)
})

onBeforeUnmount(() => {
  if (viewport.value) viewport.value.removeEventListener('scroll', onScroll)
  window.removeEventListener('resize', onResize)
  if (raf) cancelAnimationFrame(raf)
})
</script>

<template>
  <section class="landing-gallery" data-reveal :aria-label="LANDING_COPY.GALLERY_LABEL">
    <div
      ref="viewport"
      class="landing-gallery__viewport"
      :class="{ 'is-dragging': isDragging }"
    >
      <div class="landing-gallery__track">
        <template v-for="copy in 3" :key="copy">
          <img
            v-for="(src, i) in GALLERY_IMAGES"
            :key="copy + '-' + i"
            :src="src"
            :alt="''"
            draggable="false"
          />
        </template>
      </div>
    </div>
  </section>
</template>

<style scoped>
.landing-gallery {
  margin-top: var(--space-8); /* hero -> corridor: 100px */
}

.landing-gallery__viewport {
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none; /* clean corridor */
  -ms-overflow-style: none;
  cursor: grab;
  touch-action: pan-y; /* vertical page scroll stays native; horizontal goes to pointer drag */
}
.landing-gallery__viewport::-webkit-scrollbar {
  display: none;
}
.landing-gallery__viewport.is-dragging {
  cursor: grabbing;
}

.landing-gallery__track {
  display: flex;
  width: max-content;
}

/* Fixed 800px images, each with a trailing gap => every copy is an exact period
   (8 x 800 + 8 x gap = scrollWidth / 3). base.css `img { max-width:100% }` would
   crush them on narrow screens, so it is explicitly disabled here.
   --g-scale is set per image by useGalleryShrink (M1-09); transform only (the
   mask owns the fade, opacity is never animated per-image). */
.landing-gallery__track img {
  width: var(--gallery-img-w);
  flex: none;
  max-width: none;
  margin-right: var(--gallery-gap);
  aspect-ratio: 4 / 3;
  object-fit: cover;
  border-radius: var(--radius-img);
  user-select: none;
  will-change: transform;
  transform: scale(var(--g-scale, 1));
}
</style>
