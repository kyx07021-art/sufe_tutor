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
 * - Both the more trigger and the End Session entry are standard UiButtons
 *   (ADR 0004 single implementation + variant props). The dropdown entry follows
 *   the MoreMenu precedent: a left-aligned UiButton B.
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
/* The more trigger is a UiButton; its root button element is exposed via el. */
const triggerEl = computed(() => btnRef.value && btnRef.value.el)
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
  const t = btnRef.value && btnRef.value.el
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

    <UiButton
      v-if="!isEnded"
      ref="btnRef"
      variant="B"
      circle
      class="chat-topbar__more"
      :class="{ 'is-open': open }"
      :aria-label="CHAT_COPY.TOP_MORE_ARIA"
      aria-haspopup="listbox"
      :aria-expanded="open"
      @click="toggle"
    >
      <span class="chat-topbar__dots" aria-hidden="true">···</span>
    </UiButton>
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
        <UiButton
          variant="B"
          class="chat-more-panel__item"
          :class="{ 'is-disabled': !canEnd }"
          :disabled="!canEnd"
          :title="canEnd ? undefined : CHAT_COPY.END_HAS_CONTRACT"
          role="option"
          :aria-disabled="!canEnd"
          @click="onEndSession"
        >
          {{ CHAT_COPY.DROP_END_SESSION }}
        </UiButton>
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

/* ---- more button (M4-23 trigger): standard UiButton circle B; the "···"
     glyph keeps the existing 3-dot look, hover/focus ripple is UiButton's.
     Compact 32px circle (token override, beats the 52px UiButton default). ---- */
.chat-topbar .chat-topbar__more {
  --btn-h: 32px;
  --btn-w: 32px;
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
/* End Session entry: a left-aligned UiButton B filling the panel (MoreMenu
   precedent). Disabled (M4-25 gray-out) is UiButton's is-disabled. */
.chat-more-panel .chat-more-panel__item {
  width: 100%;
  --btn-w: 100%;
  justify-content: flex-start;
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
