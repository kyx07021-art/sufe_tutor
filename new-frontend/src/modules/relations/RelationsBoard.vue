<script setup>
/**
 * RelationsBoard — M3-02 board surface + dot grid array
 * -----------------------------------------------------
 * - Provides the blank layered canvas for the C1 relations map: a faint
 *   small-black-dot grid array (like a canvas app) with absolutely-positioned
 *   dashed-line / avatar / card layers floating above it.
 * - The center (self) avatar is NOT this component's job (M3-05 / page handles
 *   it); this board only supplies the layered surface and the module z-order
 *   single source (--rz-*) so every layer reads its rank from one place.
 * - Board size is applied through the Vue :style data channel (CSSOM), which is
 *   allowed under CSP style-src-attr 'none' (no literal style= in the template).
 * - English only: zero raw Chinese in markup / script / comments (contract 6).
 */
import { computed } from 'vue'
import { RELATIONS_COPY } from '@/constants/m-relations.js'

const props = defineProps({
  /** Concentric circle center, absolute within the board (px). Consumed by M3-03 / M3-10. */
  center: { type: Object, default: () => ({ x: 0, y: 0 }) },
  /** Concentric circle radius (px). Consumed by M3-03 / M3-10. */
  radius: { type: Number, default: 0 },
  /** Board logical size (px); the board element gets width/height from here. */
  size: { type: Object, default: () => ({ w: 800, h: 600 }) },
})

/** Board dimensions via CSSOM data channel (safe under style-src-attr 'none'). */
const boardStyle = computed(() => ({
  width: `${props.size.w}px`,
  height: `${props.size.h}px`,
}))
</script>

<template>
  <div
    class="relations-board"
    :style="boardStyle"
    role="group"
    :aria-label="RELATIONS_COPY.BOARD_DESC"
  >
    <div class="relations-board__layer relations-board__layer--lines"><slot name="lines" /></div>
    <div class="relations-board__layer relations-board__layer--avatars"><slot name="avatars" /></div>
    <div class="relations-board__layer relations-board__layer--cards"><slot name="cards" /></div>
  </div>
</template>

<style scoped>
/* -- z-order single source (module-wide): layers consume these names, never raw
     z-index numbers. --rz-dots is the board's own background (the dot grid). -- */
.relations-board {
  --rz-dots: 0;
  --rz-line: 1;
  --rz-avatar: 2;
  --rz-card: 3;

  position: relative;
  overflow: hidden;
  background-color: var(--paper);
  /* Dot-grid array: same faint dot grid as the page background. The --dot-*
     tokens are the single source, defined on .relations-page and inherited here
     (fallbacks keep the board self-contained when mounted without the page). */
  background-image: radial-gradient(
    var(--dot-color, color-mix(in srgb, var(--gray-20) 45%, transparent))
      calc(var(--dot-d, 2px) / 2),
    transparent calc(var(--dot-d, 2px) / 2 + 0.6px)
  );
  background-size: var(--dot-size, 28px) var(--dot-size, 28px);
}

/* -- Layers: absolutely positioned full-board surfaces anchored to the board. -- */
.relations-board__layer {
  position: absolute;
  inset: 0;
}

.relations-board__layer--lines {
  z-index: var(--rz-line);
  pointer-events: none; /* decorative dashed lines must never intercept clicks */
}

.relations-board__layer--avatars {
  z-index: var(--rz-avatar);
}

.relations-board__layer--cards {
  z-index: var(--rz-card);
  /* The cards layer is a full-board surface; only the cards themselves are
     interactive. pointer-events:none on the layer lets the avatars below it
     (z-index --rz-avatar) receive their clicks — without it the layer swallows
     every avatar click (F4 dead UI, PA-1h2-M1). The cards re-enable events. */
  pointer-events: none;
}
</style>
