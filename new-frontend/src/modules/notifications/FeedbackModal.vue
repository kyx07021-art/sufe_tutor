<script setup>
import { ref, watch } from 'vue'
import { UiModalA1 } from '@/components/ui/index.js'
import { NOTIF_COPY } from '@/constants/m-notifications'
import FeedbackForm from './FeedbackForm.vue'
import FeedbackTickets from './FeedbackTickets.vue'

/**
 * FeedbackModal - M5-14 feedback window skeleton
 * -------------------------------------------------------
 * - Modal A1 titled with the FEEDBACK_TITLE copy, opened by the C4 more dropdown
 *   feedback option.
 * - Two-column layout reusing the M5-07 left-column switch base pattern
 *   (review note 4: same base, no second implementation):
 *   left vertical nav (report / tickets tabs) + 1px center divider + right scroll area.
 * - The right area renders the real M5-15 FeedbackForm / M5-16 FeedbackTickets,
 *   switched by the active left-nav tab.
 * - A small gray note below the right area documents the anonymous-submission model.
 * - Zero inline style / v-html / runtime <style> injection; all copy via NOTIF_COPY.
 */
const props = defineProps({
  open: { type: Boolean, default: false },
})
const emit = defineEmits(['close'])

const tabs = [
  { id: 'report', label: NOTIF_COPY.FEEDBACK_TAB_REPORT },
  { id: 'tickets', label: NOTIF_COPY.FEEDBACK_TAB_TICKETS },
]

const active = ref(0)

// reset to the first tab every time the modal reopens (stale-tab guard)
watch(
  () => props.open,
  (val) => {
    if (val) active.value = 0
  },
)
</script>

<template>
  <UiModalA1
    :open="open"
    :title="NOTIF_COPY.FEEDBACK_TITLE"
    width="720px"
    :close-on-outside="true"
    :close-on-esc="true"
    @close="emit('close')"
  >
    <div class="fb-feedback">
      <nav class="fb-nav" aria-label="feedback">
        <button
          v-for="(t, i) in tabs"
          :key="t.id"
          type="button"
          class="fb-nav__item"
          :class="{ 'is-active': active === i }"
          :aria-current="active === i ? 'true' : undefined"
          @click="active = i"
        >
          {{ t.label }}
        </button>
      </nav>
      <div class="fb-divider" aria-hidden="true"></div>
      <div class="fb-main">
        <div class="fb-scroll">
          <FeedbackForm v-if="active === 0" />
          <FeedbackTickets v-else />
        </div>
        <p class="fb-note">{{ NOTIF_COPY.FEEDBACK_ANON_NOTE }}</p>
      </div>
    </div>
  </UiModalA1>
</template>

<style scoped>
.fb-feedback {
  display: flex;
  height: min(460px, 62vh);
  box-sizing: border-box;
}
/* left column: tab switcher (same visual language as the settings nav) */
.fb-nav {
  flex: none;
  width: 140px;
  box-sizing: border-box;
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  background: var(--paper-raised);
}
/* small rounded button B: resting transparent, active gray-10 fill; no dividers between items */
.fb-nav__item {
  display: block;
  width: 100%;
  box-sizing: border-box;
  text-align: left;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink);
  font-size: var(--fs-base);
  line-height: 1.3;
  cursor: pointer;
  transition: background var(--dur-sm) var(--ease-out);
}
.fb-nav__item:hover,
.fb-nav__item.is-active {
  background: var(--gray-10);
}
.fb-nav__item.is-active {
  font-weight: 500;
}
/* center 1px vertical divider between the two columns */
.fb-divider {
  flex: none;
  width: 1px;
  background: var(--line);
}
/* right column: scrollable body + anonymous note pinned below */
.fb-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}
.fb-scroll {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: var(--space-5);
}
.fb-note {
  flex: none;
  box-sizing: border-box;
  padding: var(--space-3) var(--space-5);
  color: var(--gray-50);
  font-size: var(--fs-sm);
  line-height: 1.4;
}
</style>
