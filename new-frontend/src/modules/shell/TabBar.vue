<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { UiButton } from '@/components/ui/index.js'
import { pagesByRole } from './page-registry.js'
import { authStore } from './auth-store.js'
import { SHELL_COPY } from '@/constants/m-shell.js'

/**
 * TabBar - centered module tabs driven by the role page registry (M2-07)
 * -------------------------------------------------------
 * - Data: pagesByRole(authStore.user.role) filtered to tab pages
 *   (meta.tab !== false). Each tab is a UiButton variant B (bare black text),
 *   wide; the selected tab gets a gray-10 fill (`is-selected`).
 * - Click navigates to the page path. Current route drives the highlight.
 * - Label = meta.title (module copy, resolved at integration close) or the page
 *   name as fallback; no raw copy in this component.
 * - Narrow screens: the tab strip scrolls horizontally (scrollbar hidden) so the
 *   top bar never overflows at 375px.
 * - Zero inline style/event attributes; comments English (contract 6).
 */

const route = useRoute()
const router = useRouter()

const tabs = computed(() =>
  pagesByRole(authStore.user?.role)
    .filter((p) => p.meta?.tab !== false)
    // AK-N-B1: sort by meta.tabOrder (plaza 10 -> own items 20 -> chat 30 -> relations 40),
    // pages without a tabOrder keep their registry order at the tail.
    .sort((a, b) => (a.meta?.tabOrder ?? 100) - (b.meta?.tabOrder ?? 100)),
)

const currentPath = computed(() => route.path)

function label(p) {
  return p.meta?.title || p.name
}
</script>

<template>
  <nav class="tabbar" :aria-label="SHELL_COPY.TABBAR_LABEL">
    <template v-if="tabs.length">
      <UiButton
        v-for="tab in tabs"
        :key="tab.path"
        variant="B"
        class="tabbar__tab"
        :class="{ 'is-selected': currentPath === tab.path }"
        @click="router.push(tab.path)"
      >
        {{ label(tab) }}
      </UiButton>
    </template>
  </nav>
</template>

<style scoped>
.tabbar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none; /* Firefox */
}
.tabbar::-webkit-scrollbar {
  display: none; /* Chromium / Safari */
}

/* Tab = UiButton variant B, wider hit, fixed width; flex:none so the strip
   scrolls instead of squeezing the labels. */
.tabbar__tab {
  --btn-w: 120px;
  --btn-h: 40px;
  flex: 0 0 auto;
}

/* Selected tab: gray-10 fill (button B has no resting fill/border). The tab root
   is a UiButton (child component), so the scoped selector must pierce via :deep. */
:deep(.tabbar__tab.is-selected) {
  background: var(--gray-10);
}
</style>
