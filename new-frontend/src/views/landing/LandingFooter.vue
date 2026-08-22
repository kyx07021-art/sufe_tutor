<script setup>
/**
 * LandingFooter - M1 footer zone (M1-05)
 * -------------------------------------------------------------
 * - 100px blank above (margin-top), then a thin divider line (--line = gray-50),
 *   then 300px of blank footer body.
 * - Deliberately NOT marked data-reveal: the footer does not participate in the
 *   landing scroll-reveal animation (M1-11).
 */
</script>

<template>
  <footer class="landing-footer"></footer>
</template>

<style scoped>
.landing-footer {
  margin-top: var(--space-8); /* 100px blank above the line */
  border-top: var(--border-w) solid var(--line);
  height: var(--footer-h);
  box-sizing: border-box;
}
</style>
