<script setup>
/**
 * LandingPage - M1 landing page container (M1-01 + assembly M1-12)
 * ----------------------------------------------------------------------------
 * - Six-section vertical skeleton with no separators (Gestalt whitespace):
 *   hero -> image corridor -> SLOGAN -> mirror A -> mirror B -> footer.
 * - 5% side empty zone: every component stays inside `--landing-inset`
 *   (may touch the inner edge, never exceed it).
 * - Pure white background; section gaps are tokenized (--space-8 / --space-6).
 * - M1-10: the two mirror sections are LandingMirror instances (variants a/b).
 * - M1-11: useScrollReveal drives the scroll in/out animation for every
 *   [data-reveal] element (hero/corridor/SLOGAN/mirrors); footer is excluded.
 */
import { onMounted } from 'vue'
import LandingHero from './LandingHero.vue'
import LandingGallery from './LandingGallery.vue'
import LandingSlogan from './LandingSlogan.vue'
import LandingMirror from './LandingMirror.vue'
import LandingFooter from './LandingFooter.vue'
import { useScrollReveal } from './useScrollReveal'
import './landing-reveal.css'

onMounted(() => {
  useScrollReveal(document)
})
</script>

<template>
  <main class="landing">
    <LandingHero />
    <LandingGallery />
    <LandingSlogan />
    <LandingMirror variant="a" />
    <LandingMirror variant="b" />
    <LandingFooter />
  </main>
</template>

<style scoped>
.landing {
  padding: 0 var(--landing-inset);
  background: var(--paper);
  color: var(--ink);
  min-height: 100vh;
}
</style>
