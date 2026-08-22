<script setup>
/**
 * ChatTopBar — C2 in-conversation top bar (M4-22) + more dropdown render (M4-23)
 * -----------------------------------------------------------------
 * - M4-22: 60px paper-fill top bar (no border line, per skeleton), peer name
 *   (--fs-lg / --ink, ellipsis on overflow), a "more" button on the right, and an
 *   optional mobile back button whose visibility is decided by the parent.
 * - M4-23: clicking "more" toggles a dropdown panel with ONE entry (End Session).
 *   When canEnd === false the entry is disabled/grayed with the END_HAS_CONTRACT
 *   hint — this is the M4-25 gray-out gate's UI surface. The component ONLY
 *   renders the disabled state; it never computes canEnd itself (that judgment
 *   lives in logic/endSession.js, M4-25, and is passed in by the parent).
 * - Ended conversations hide the more button entirely (already-ended cannot be
 *   ended again).
 * - Dropdown is a minimal custom panel reusing the M0 composables
 *   (useAnchoredPanel positioning + useFocusTrap Tab trapping) so the anchoring
 *   math and focus behavior come from the shared layer, not re-implemented here.
 * - Contract 6: zero Chinese in template / scoped CSS / comments; zero inline
 *   event/style HTML attrs; JS only toggles classes.
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { CHAT_COPY } from '@/constants/ui.js'
import { useAnchoredPanel } from '@/composables/useAnchoredPanel'
import { useFocusTrap } from '@/composables/useFocusTrap'
import UiButton from '@/components/ui/UiButton.vue'
import UiIcon from '@/components/ui/UiIcon.vue'

const props = defineProps({
  /** peer (other-side) user name, ellipsized on overflow */
  peerName: { type: String, default: '' },
  /** conversation already ended -> hide the more button (cannot end twice) */
  isEnded: { type: Boolean, default: false },
  /** M4-25 judgment injected by the parent; true = End Session entry enabled */
  canEnd: { type: Boolean, default: true },
  /** mobile: render the back-to-list button (visibility decided by the parent) */
  showBack: { type: Boolean, default: false },
})

const emit = defineEmits(['back', 'end-session'])

/* ---- more dropdown (M4-23) ---- */
const open = ref(false)
const btnRef = ref(null)
const panelRef = ref(null)
const triggerEl = computed(() => btnRef.value)
const { style: panelStyle, placeNextTick, bind, unbind } = useAnchoredPanel(panelRef, triggerEl, {
  align: 'down',
  alignX: 'right',
  matchWidth: false,
  minWidth: false,
})

useFocusTrap(panelRef, { active: computed(() => open.value) })

function toggle() {
  if (props.isEnded) return
  open.value = !open.value
}

function onEndSession() {
  if (!props.canEnd) return
  emit('end-session')
  open.value = false
}

function onDocPointerDown(e) {
  if (!open.value) return
  const p = panelRef.value
  const t = btnRef.value
  if (p && p.contains(e.target)) return
  if (t && t.contains(e.target)) return
  open.value = false
}

watch(
  () => open.value,
  (val) => {
    if (val) {
      placeNextTick()
      bind()
      document.addEventListener('pointerdown', onDocPointerDown, true)
    } else {
      unbind()
      document.removeEventListener('pointerdown', onDocPointerDown, true)
    }
  },
)

onBeforeUnmount(() => {
  unbind()
  document.removeEventListener('pointerdown', onDocPointerDown, true)
})
</script>

<template>
  <header class="chat-topbar">
    <UiButton
      v-if="showBack"
      variant="B1"
      circle
      class="chat-topbar__back"
      :aria-label="CHAT_COPY.BACK_TO_LIST"
      @click="emit('back')"
    >
      <UiIcon name="arrow-left" :size="20" />
    </UiButton>

    <span class="chat-topbar__peer">{{ peerName }}</span>

    <button
      v-if="!isEnded"
      ref="btnRef"
      type="button"
      class="chat-topbar__more"
      :class="{ 'is-open': open }"
      :aria-label="CHAT_COPY.TOP_MORE_ARIA"
      aria-haspopup="listbox"
      :aria-expanded="open"
      @click="toggle"
    >
      <span class="chat-topbar__dots" aria-hidden="true">···</span>
    </button>
  </header>

  <Teleport to="body">
    <Transition name="chat-more">
      <div
        v-if="open"
        ref="panelRef"
        class="chat-more-panel"
        :style="panelStyle"
        role="listbox"
        :aria-label="CHAT_COPY.TOP_MORE_ARIA"
      >
        <button
          type="button"
          class="chat-more-panel__item"
          :class="{ 'is-disabled': !canEnd }"
          :disabled="!canEnd"
          :title="canEnd ? undefined : CHAT_COPY.END_HAS_CONTRACT"
          role="option"
          :aria-disabled="!canEnd"
          @click="onEndSession"
        >
          {{ CHAT_COPY.DROP_END_SESSION }}
        </button>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* ---- M4-22: 60px paper top bar, no border line (per skeleton) ---- */
.chat-topbar {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: 60px;
  padding: 0 var(--space-4);
  background: var(--paper);
}

.chat-topbar__back { flex: none; }

.chat-topbar__peer {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-lg);
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ---- more button (M4-23 trigger): clean minimal 3-dot ---- */
.chat-topbar__more {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background var(--dur-sm) var(--ease-out);
}
.chat-topbar__more:hover,
.chat-topbar__more:focus-visible,
.chat-topbar__more.is-open {
  background: var(--gray-10);
}
.chat-topbar__dots {
  font-size: var(--fs-lg);
  line-height: 1;
  letter-spacing: 0.08em;
}

/* ---- dropdown panel (M4-23), panel-B look ---- */
.chat-more-panel {
  position: fixed;
  z-index: 1200;
  box-sizing: border-box;
  padding: var(--space-2);
  border-radius: var(--radius-md);
  background: var(--paper-raised);
  border: var(--border-w) solid var(--line);
  box-shadow: var(--shadow-float-sm);
}
.chat-more-panel__item {
  display: block;
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
.chat-more-panel__item:hover,
.chat-more-panel__item:focus-visible {
  outline: none;
  background: var(--gray-10);
}
/* M4-25 gray-out gate UI surface: disabled entry is grayed and inert */
.chat-more-panel__item.is-disabled {
  color: var(--gray-50);
  cursor: default;
}
.chat-more-panel__item.is-disabled:hover,
.chat-more-panel__item.is-disabled:focus-visible {
  background: transparent;
}

/* ---- summon float-in + fade (down direction) ---- */
.chat-more-enter-active,
.chat-more-leave-active {
  transition: opacity var(--dur-sm) var(--ease-out), transform var(--dur-sm) var(--ease-out);
}
.chat-more-enter-from,
.chat-more-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

@media (prefers-reduced-motion: reduce) {
  .chat-more-panel { transition: none; }
}
</style>
