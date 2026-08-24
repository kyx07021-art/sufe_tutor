<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { UiButton, UiIcon } from '@/components/ui/index.js'
import { useAnchoredPanel } from '@/composables/useAnchoredPanel'
import { NOTIF_COPY } from '@/constants/m-notifications'

/**
 * MoreMenu - C4 more dropdown A (M5-06 final)
 * -------------------------------------------------------
 * - Anchored dropdown summoned from the user area (M2-04 hover) via openC4(triggerEl).
 *   Reuses M0 useAnchoredPanel + UiButton B; no new scaffolding.
 * - Three options, each a left-aligned UiButton B with a small site-style line SVG:
 *   settings / about / feedback. Each emits its own event; M5Host wires them to the
 *   corresponding settings / about / feedback windows.
 * - Retention zone: while open, the panel must not close while the pointer is inside
 *   the union of (a) the panel, (b) the trigger element, and (c) the rectangle that
 *   spans horizontally over the trigger and vertically from the trigger's bottom edge
 *   down to the panel's top edge (the gap). A document-level pointermove (capture)
 *   tracks the pointer and closes only on an inside -> outside transition; outside
 *   pointerdown still closes (dismissal), and the panel never closes on the initial open.
 * - Reduced-motion: transitions only (opacity + translateY), disabled under prefers-reduced-motion.
 */
const props = defineProps({
  open: { type: Boolean, default: false },
  trigger: { type: Object, default: null },
})
const emit = defineEmits(['close', 'open-settings', 'open-about', 'open-feedback', 'open-logout'])

const panelRef = ref(null)
const triggerRef = computed(() => props.trigger)
const { style, placeNextTick, bind, unbind } = useAnchoredPanel(panelRef, triggerRef, {
  align: 'down',
  alignX: 'right',
  matchWidth: false,
})

/* ---- retention-zone pointer tracking ---- */
let pointerInside = false
let lastPointerX = -Infinity
let lastPointerY = -Infinity
let boundTriggerEl = null

function pointInUnion(x, y) {
  const p = panelRef.value
  if (!p) return false
  const pr = p.getBoundingClientRect()
  // Panel not yet placed (off-screen anchor) -> keep open conservatively.
  if (pr.left < -1000 || pr.top < -1000) return true
  // (a) the panel itself
  if (x >= pr.left && x <= pr.right && y >= pr.top && y <= pr.bottom) return true
  const t = props.trigger
  if (t) {
    const tr = t.getBoundingClientRect()
    // (b) the trigger element
    if (x >= tr.left && x <= tr.right && y >= tr.top && y <= tr.bottom) return true
    // (c) retention zone: over the trigger, from trigger bottom down to panel top
    if (tr.bottom < pr.top && x >= tr.left && x <= tr.right && y >= tr.bottom && y <= pr.top) return true
  }
  return false
}

function closeIfLeftUnion() {
  if (!props.open) return
  if (!Number.isFinite(lastPointerX)) return
  if (pointInUnion(lastPointerX, lastPointerY)) return
  if (pointerInside) {
    pointerInside = false
    emit('close')
  }
}

function onDocPointerMove(e) {
  if (!props.open) return
  lastPointerX = e.clientX
  lastPointerY = e.clientY
  if (pointInUnion(lastPointerX, lastPointerY)) {
    pointerInside = true
  } else if (pointerInside) {
    pointerInside = false
    emit('close')
  }
}

function onPanelEnter() {
  pointerInside = true
}
function onPanelLeave() {
  closeIfLeftUnion()
}
function onTriggerEnter() {
  pointerInside = true
}
function onTriggerLeave() {
  closeIfLeftUnion()
}

function onDocPointerDown(e) {
  if (!props.open) return
  const p = panelRef.value
  const t = props.trigger
  if (p && p.contains(e.target)) return
  if (t && t.contains(e.target)) return
  emit('close')
}

function bindTriggerListeners() {
  const t = props.trigger
  if (!t || t === boundTriggerEl) return
  unbindTriggerListeners()
  t.addEventListener('pointerenter', onTriggerEnter)
  t.addEventListener('pointerleave', onTriggerLeave)
  boundTriggerEl = t
}
function unbindTriggerListeners() {
  if (boundTriggerEl) {
    boundTriggerEl.removeEventListener('pointerenter', onTriggerEnter)
    boundTriggerEl.removeEventListener('pointerleave', onTriggerLeave)
    boundTriggerEl = null
  }
}

watch(
  () => props.open,
  (val) => {
    if (val) {
      pointerInside = true
      lastPointerX = -Infinity
      lastPointerY = -Infinity
      placeNextTick()
      bind()
      document.addEventListener('pointerdown', onDocPointerDown, true)
      document.addEventListener('pointermove', onDocPointerMove, true)
      bindTriggerListeners()
    } else {
      unbind()
      document.removeEventListener('pointerdown', onDocPointerDown, true)
      document.removeEventListener('pointermove', onDocPointerMove, true)
      unbindTriggerListeners()
      pointerInside = false
    }
  },
)

watch(
  () => props.trigger,
  () => {
    if (props.open) bindTriggerListeners()
  },
)

onBeforeUnmount(() => {
  unbind()
  document.removeEventListener('pointerdown', onDocPointerDown, true)
  document.removeEventListener('pointermove', onDocPointerMove, true)
  unbindTriggerListeners()
})

function pickSettings() {
  emit('open-settings')
}
function pickAbout() {
  emit('open-about')
}
function pickFeedback() {
  emit('open-feedback')
}
function pickLogout() {
  emit('open-logout')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="m5-more">
      <div
        v-if="open"
        ref="panelRef"
        class="m5-more"
        :style="style"
        role="menu"
        :aria-label="NOTIF_COPY.MORE_LABEL"
        @pointerenter="onPanelEnter"
        @pointerleave="onPanelLeave"
      >
        <div class="m5-more__item" data-cap="m5-06-settings">
          <UiButton variant="B" class="m5-more__btn" @click="pickSettings">
            <span class="m5-more__opt">
              <UiIcon name="user" :size="18" class="m5-more__opt-icon" />
              <span class="m5-more__opt-text">{{ NOTIF_COPY.MORE_SETTINGS }}</span>
            </span>
          </UiButton>
        </div>
        <div class="m5-more__item" data-cap="m5-13-about">
          <UiButton variant="B" class="m5-more__btn" @click="pickAbout">
            <span class="m5-more__opt">
              <UiIcon name="logo" :size="18" class="m5-more__opt-icon" />
              <span class="m5-more__opt-text">{{ NOTIF_COPY.MORE_ABOUT }}</span>
            </span>
          </UiButton>
        </div>
        <div class="m5-more__item" data-cap="m5-14-feedback">
          <UiButton variant="B" class="m5-more__btn" @click="pickFeedback">
            <span class="m5-more__opt">
              <UiIcon name="mail" :size="18" class="m5-more__opt-icon" />
              <span class="m5-more__opt-text">{{ NOTIF_COPY.MORE_FEEDBACK }}</span>
            </span>
          </UiButton>
        </div>
        <div class="m5-more__item" data-cap="m5-15-logout">
          <UiButton variant="B" class="m5-more__btn" @click="pickLogout">
            <span class="m5-more__opt">
              <UiIcon name="arrow-left" :size="18" class="m5-more__opt-icon" />
              <span class="m5-more__opt-text">{{ NOTIF_COPY.MORE_LOGOUT }}</span>
            </span>
          </UiButton>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.m5-more {
  position: fixed;
  z-index: 1200;
  min-width: 160px;
  box-sizing: border-box;
  padding: var(--space-2);
  border-radius: var(--radius-md);
  background: var(--paper-raised);
  box-shadow: var(--shadow-float);
}
.m5-more__item {
  padding: var(--space-1) 0;
}
.m5-more .m5-more__btn {
  width: 100%;
  --btn-w: 100%;
  justify-content: flex-start;
}
.m5-more__opt {
  display: inline-flex;
  align-items: center;
  gap: var(--space-4);
}
.m5-more__opt-icon {
  flex: none;
}
.m5-more__opt-text {
  font-size: var(--fs-base);
  line-height: 1;
}
.m5-more-enter-active,
.m5-more-leave-active {
  transition: opacity var(--dur-sm) var(--ease-out), transform var(--dur-sm) var(--ease-out);
}
.m5-more-enter-from,
.m5-more-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
@media (prefers-reduced-motion: reduce) {
  .m5-more-enter-active,
  .m5-more-leave-active {
    transition: none;
  }
}
</style>
