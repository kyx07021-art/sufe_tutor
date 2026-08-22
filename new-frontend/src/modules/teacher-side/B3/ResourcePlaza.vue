<script setup>
/**
 * ResourcePlaza - B3 resource plaza placeholder (M9-B3-1)
 * --------------------------------------------------------
 * - Simple gray-text placeholder page; full content lands in a later batch.
 */
import { TEACHER_COPY } from '@/constants/ui.js'
</script>

<template>
  <section class="b3">
    <h2 class="b3__title">{{ TEACHER_COPY.B3_TITLE }}</h2>
    <p class="b3__placeholder">{{ TEACHER_COPY.B3_PLACEHOLDER }}</p>
  </section>
</template>

<style scoped>
.b3 {
  padding: var(--space-6) var(--space-6);
  background: var(--paper);
  color: var(--ink);
  min-height: 100vh;
}
.b3__title {
  font-size: var(--fs-xl);
  line-height: var(--lh-tight);
  margin-bottom: var(--space-5);
}
.b3__placeholder {
  color: var(--gray-50);
}
</style>
