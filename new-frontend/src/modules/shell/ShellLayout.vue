<script setup>
/**
 * ShellLayout - client shell layout (nested router shell, M2-08 final)
 * -------------------------------------------------------
 * - Rendered only for role-gated pages (children of the empty-path shell route).
 * - Top bar (M2-01..07) is fixed; the routed page renders inside a <Transition>
 *   (M2-13) keyed by route path so page switches fade + float.
 * - M5Host mounts the C3/C4 overlay tree (notifications / more / settings);
 *   it is imported from the M5 module entry (module boundary, no deep import).
 */
import { RouterView } from 'vue-router'
import TopBar from './TopBar.vue'
import PageTransition from './PageTransition.vue'
import { M5Host } from '@/modules/notifications/index.js'
</script>

<template>
  <div class="shell-layout">
    <TopBar class="shell-layout__topbar" />
    <main class="shell-layout__body">
      <RouterView v-slot="{ Component, route }">
        <PageTransition>
          <component :is="Component" :key="route.path" />
        </PageTransition>
      </RouterView>
    </main>
    <M5Host />
  </div>
</template>

<style scoped>
.shell-layout {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--paper);
  color: var(--ink);
}

.shell-layout__body {
  flex: 1 1 auto;
  min-width: 0;
}
</style>
