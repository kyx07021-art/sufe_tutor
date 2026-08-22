<script setup>
import { ref } from 'vue'
import UserArea from './UserArea.vue'
import { getIface } from './ifaces.js'
import { SHELL_COPY } from '@/constants/m-shell.js'
import Dot from '@/assets/svg/dot.svg'

/**
 * UserAreaDropdown - C4 "more" dropdown trigger + reserved area (M2-04)
 * ---------------------------------------------------------------------
 * - Wraps UserArea and owns the hover contract for the C4 "more" dropdown.
 * - This component is only the *trigger*: on hover it calls the M5 interface
 *   `openC4(triggerEl)` (registered by M5's MoreMenu, anchored to this wrapper).
 *   M5's MoreMenu renders the real C4 panel and manages its own reserved area
 *   + dismissal, so this component never force-closes it.
 * - While M5 is not wired (`getIface('openC4')` undefined) the component shows
 *   a `data-cap="M5.c4"` placeholder panel with three button-B rows (settings /
 *   about / feedback) so the top bar is fully interactive pre-integration.
 * - Reserved-area semantics (placeholder case): the panel is rendered INSIDE
 *   this wrapper (absolutely positioned at top:100%), so `mouseleave` fires
 *   only when the pointer fully leaves wrapper + panel. Moving from the user
 *   area text down into the panel (or lingering in the seam between them)
 *   keeps the panel open naturally - no gap, no manual hit-region math.
 * - F3 dedup: the hover handlers are Vue template bindings, registered once
 *   per instance on mount and removed on unmount; no window-level listeners
 *   accumulate.
 * - Zero inline style/event attributes (Vue bindings only), zero v-html,
 *   comments English (contract 6).
 */

const zoneEl = ref(null)
const showPlaceholder = ref(false)

/** Hover in: hand the trigger element to M5, or fall back to the placeholder. */
function activate() {
  const openC4 = getIface('openC4')
  if (openC4) {
    openC4(zoneEl.value)
  } else {
    showPlaceholder = true
  }
}

/** Hover out: M5's MoreMenu self-manages its reserved area; otherwise hide placeholder. */
function deactivate() {
  const openC4 = getIface('openC4')
  if (openC4) {
    // M5's MoreMenu owns the keep-open/dismiss logic for its own panel;
    // force-closing here would fight its reserved area. Do nothing.
  } else {
    // Placeholder case: the panel is a DOM descendant of this wrapper, so
    // mouseleave only fires when the pointer fully leaves wrapper + panel,
    // which is exactly the reserved-area contract. Hide the panel on exit.
    showPlaceholder = false
  }
}

/** Placeholder rows (button B). Click resolves the interface cap at call time. */
const menuItems = [
  { cap: 'M5.settings', label: SHELL_COPY.C4_SETTINGS, run: () => getIface('openSettings')?.() },
  { cap: 'M5.about', label: SHELL_COPY.C4_ABOUT, run: () => getIface('openAbout')?.() },
  { cap: 'M5.feedback', label: SHELL_COPY.C4_FEEDBACK, run: () => getIface('openFeedback')?.() },
]
</script>

<template>
  <div
    ref="zoneEl"
    class="user-area-dropdown"
    :aria-label="SHELL_COPY.USER_MENU_LABEL"
    @mouseenter="activate"
    @mouseleave="deactivate"
    @keydown.enter.prevent="activate"
    @keydown.space.prevent="activate"
    @keydown.escape="deactivate"
  >
    <UserArea />

    <div
      v-if="showPlaceholder"
      class="user-area-dropdown__panel"
      data-cap="M5.c4"
      role="menu"
    >
      <button
        v-for="item in menuItems"
        :key="item.cap"
        type="button"
        class="user-area-dropdown__item"
        :data-cap="item.cap"
        role="menuitem"
        @click="item.run"
      >
        <Dot class="user-area-dropdown__item-icon" aria-hidden="true" />
        <span>{{ item.label }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
/* Trigger wrapper: hugs UserArea width, anchors the absolute panel below. */
.user-area-dropdown {
  position: relative;
  display: inline-flex;
}

/* Placeholder panel: flush at top:100% (no gap) so hover continuity between the
   user area and the panel is preserved (mouseleave only on full exit). */
.user-area-dropdown__panel {
  position: absolute;
  top: 100%;
  right: 0;
  z-index: 1200;
  min-width: 180px;
  box-sizing: border-box;
  padding: var(--space-2);
  border-radius: var(--radius-md);
  background: var(--paper-raised);
  box-shadow: var(--shadow-float-sm);
}

/* Item = button B row: bare black text, small rounded hit, gray-10 focus fill. */
.user-area-dropdown__item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  box-sizing: border-box;
  padding: var(--space-2) var(--space-3);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink);
  font-size: var(--fs-base);
  line-height: 1;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
}
.user-area-dropdown__item:hover,
.user-area-dropdown__item:focus-visible {
  outline: none;
  background: var(--gray-10);
}

/* Left small SVG pattern (dot) inside each row. */
.user-area-dropdown__item-icon {
  flex: none;
  width: 16px;
  height: 16px;
}
</style>
