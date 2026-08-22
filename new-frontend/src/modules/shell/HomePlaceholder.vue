<script setup>
/**
 * HomePlaceholder - client-shell fallback page
 * -------------------------------------------------------
 * - Role default destination while real module pages land.
 * - Interface cap: marked data-cap; copy from SHELL_COPY.
 */
import { SHELL_COPY } from '@/constants/m-shell.js'
</script>

<template>
  <section class="shell-home" data-cap="shell.home">
    <p class="shell-home__text">{{ SHELL_COPY.HOME_PLACEHOLDER }}</p>
  </section>
</template>

<style scoped>
.shell-home {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-6);
  text-align: center;
  color: var(--gray-75);
  font-size: var(--fs-base);
}
</style>
