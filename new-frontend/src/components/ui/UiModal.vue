<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useFocusTrap } from '@/composables/useFocusTrap'
import { lockBody, unlockBody } from '@/composables/useBodyScrollLock'

/**
 * UiModal - Modal A (plan "modal styles - modal A")
 * -------------------------------------------------------
 * - Wide gradient shadow on the outside (signals layering); PC centered at 30% width, mobile 80%.
 * - Configurable close-on-outside-click (closeOnOutside, default true; form-filling modals set false).
 *   A press that starts inside the modal and ends outside does NOT close (same-frame pointerdown/up check).
 * - On open locks body scroll; Esc closes (closeOnEsc); focus is trapped inside the modal.
 * - Backdrop is very pale (keeps minimalism; layering is carried by the modal shadow).
 */
const props = defineProps({
  open: { type: Boolean, default: false },
  /** accessibility label */
  label: { type: String, default: '' },
  /** PC width (default 30%) */
  width: { type: String, default: '' },
  closeOnOutside: { type: Boolean, default: true },
  closeOnEsc: { type: Boolean, default: true },
  zIndex: { type: Number, default: 1000 },
})

const emit = defineEmits(['close', 'update:open'])

const rootRef = ref(null)
const panelRef = ref(null)
let startedInside = false

useFocusTrap(rootRef, { active: computed(() => props.open) })

function close() {
  emit('close')
  emit('update:open', false)
}

function onDown(e) {
  startedInside = panelRef.value ? panelRef.value.contains(e.target) : false
}
function onUp(e) {
  if (!props.closeOnOutside) return
  if (startedInside) return
  if (panelRef.value && panelRef.value.contains(e.target)) return
  close()
}
function onKeydown(e) {
  if (e.key === 'Escape' && props.closeOnEsc && props.open) close()
}

watch(
  () => props.open,
  async (val) => {
    if (val) {
      lockBody()
      await nextTick()
      const first = rootRef.value?.querySelector(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      if (first) first.focus()
    } else {
      unlockBody()
    }
  },
)

onBeforeUnmount(() => {
  if (props.open) unlockBody()
})

defineExpose({ close })
</script>

<template>
  <Teleport to="body">
    <Transition name="ui-modal">
      <div
        v-if="open"
        ref="rootRef"
        class="ui-modal"
        :style="{ zIndex }"
        role="dialog"
        aria-modal="true"
        :aria-label="label"
        @pointerdown="onDown"
        @pointerup="onUp"
        @keydown="onKeydown"
      >
        <div class="ui-modal__backdrop"></div>
        <div class="ui-modal__panel" :style="width ? { '--modal-w': width } : null">
          <slot />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.ui-modal {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ui-modal__backdrop {
  position: absolute;
  inset: 0;
  background: var(--overlay); /* very pale overlay: layering is carried mainly by the modal shadow */
}

.ui-modal__panel {
  position: relative;
  box-sizing: border-box;
  width: var(--modal-w, 30%);
  max-width: 100%;
  background: var(--paper-raised);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-float);
  overflow: hidden;
}

/* enter/leave */
.ui-modal-enter-active,
.ui-modal-leave-active {
  transition: opacity var(--dur-base) var(--ease-out);
}
.ui-modal-enter-active .ui-modal__panel {
  transition: opacity var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-out);
}
.ui-modal-leave-active .ui-modal__panel {
  transition: opacity var(--dur-sm) var(--ease-out), transform var(--dur-sm) var(--ease-out);
}
.ui-modal-enter-from,
.ui-modal-leave-to { opacity: 0; }
.ui-modal-enter-from .ui-modal__panel,
.ui-modal-leave-to .ui-modal__panel {
  opacity: 0;
  transform: translateY(10px) scale(0.97);
}

@media (max-width: 600px) {
  .ui-modal__panel { width: var(--modal-w-mobile, 80%); }
}

@media (prefers-reduced-motion: reduce) {
  .ui-modal,
  .ui-modal__panel { transition: none; }
}
</style>
