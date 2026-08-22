<script setup>
/**
 * LandingSlogan - M1 text zone (M1-04)
 * -------------------------------------------------------------
 * - 40px below the corridor; centered big black SLOGAN.
 * - 40px below the SLOGAN: a small gray body block whose left/right edges sit
 *   ~16% off the center line (block width ~1/3 of the page). The block is
 *   centered, the text left-aligned within it. Narrow screens clamp the block
 *   (min-width) so the paragraph stays readable and never overflows.
 */
import { LANDING_COPY } from '@/constants/ui.js'
</script>

<template>
  <section class="landing-slogan" data-reveal>
    <h2 class="landing-slogan__title">{{ LANDING_COPY.SLOGAN }}</h2>
    <p class="landing-slogan__text">{{ LANDING_COPY.BODY }}</p>
  </section>
</template>

<style scoped>
.landing-slogan {
  margin-top: var(--space-6); /* corridor -> SLOGAN: 40px */
  text-align: center;
}

.landing-slogan__title {
  font-size: var(--fs-slogan);
  font-weight: 700;
  letter-spacing: 0.08em;
  line-height: 1.3;
  color: var(--ink);
}

.landing-slogan__text {
  width: var(--slogan-block-w); /* edges ~16% off center => block ~1/3 page width */
  max-width: 100%;              /* never exceed the container (narrow-screen clamp) */
  min-width: 260px;             /* keep readable on small phones */
  margin: var(--space-6) auto 0;
  text-align: left;             /* block centered, text left-aligned ("one-end centered" semantics) */
  font-size: var(--fs-sm);
  line-height: 1.9;
  letter-spacing: 0.02em;
  color: var(--gray-50);
}
</style>
