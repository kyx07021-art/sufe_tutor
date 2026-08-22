<script setup>
/**
 * TopBar - Fixed top bar container (M2-01)
 * -------------------------------------------------------
 * - Fixed (sticky) top bar: same page background (--paper), no border, layered
 *   above page content (z-index 50); elements do not scroll with the page.
 * - Layout (horizontal flex):
 *   left   = TopBarLogo   (shrinkable, min-width 0)
 *   middle = TabBar       (flex 1, centered, occupies the middle majority)
 *   right  = ChatButton + NotifyButton + UserAreaDropdown (flex:none, right-aligned)
 * - 375 no-overflow: shrinkable items carry min-width:0; right cluster gap and
 *   top bar gap/padding narrow via the media query below.
 * - Copy / aria live in SHELL_COPY and are consumed by the leaf components;
 *   this container owns no copy. Zero inline style / event attributes.
 */
import TopBarLogo from './TopBarLogo.vue'
import TabBar from './TabBar.vue'
import UserAreaDropdown from './UserAreaDropdown.vue'
import NotifyButton from './NotifyButton.vue'
import ChatButton from './ChatButton.vue'
</script>

<template>
  <header class="topbar">
    <TopBarLogo class="topbar__logo" />
    <TabBar class="topbar__tabs" />
    <div class="topbar__right">
      <ChatButton />
      <NotifyButton />
      <UserAreaDropdown />
    </div>
  </header>
</template>

<style scoped>
.topbar {
  position: sticky;
  top: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-2) var(--space-6);
  background: var(--paper);
}

/* LOGO may shrink so the middle tab strip keeps priority on narrow screens.
   The logo/tabs are child-component roots (class forwarded), so scoped selectors
   must pierce via :deep to reach them. */
:deep(.topbar__logo) {
  flex: 0 1 auto;
  min-width: 0;
}

/* TabBar: centered, fills the middle majority, shrinkable without overflow */
:deep(.topbar__tabs) {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  justify-content: center;
}

/* Right action cluster: keeps its intrinsic size (never shrinks), right-aligned */
.topbar__right {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

@media (max-width: 480px) {
  .topbar {
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
  }
  .topbar__right {
    gap: var(--space-2);
  }
}
</style>
