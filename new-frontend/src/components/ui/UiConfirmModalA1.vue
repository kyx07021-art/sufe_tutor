<script setup>
import { computed, ref, watch } from 'vue'
import UiModal from './UiModal.vue'
import UiButton from './UiButton.vue'
import { useCountdown } from '@/composables/useCountdown'
import { useScrollFade } from '@/composables/useScrollFade'
import { UI_CONSTANTS, UI_COPY } from '@/constants/ui.js'

/**
 * UiConfirmModalA1 - Confirm modal A1 (plan "modal styles - confirm modal A1")
 * -------------------------------------------------------
 * - Otherwise same as modal A1, but no exit button in the top bar's right.
 * - Bottom two wide buttons: left white button A "exit" (close), right brand-purple button A "confirm".
 * - The confirm button is grayed on entry, its inner text = countdown "x seconds until confirm" (start x given by prop/constant).
 * - If and only if content is scrollable + not scrolled to bottom + countdown finished: stays grayed, text "please read and scroll to the bottom";
 *   once scrolled to the bottom (even if scrolled back up), it stays lit for this opening.
 */
const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '' },
  /** countdown start (seconds) */
  countdown: { type: Number, default: UI_CONSTANTS.CONFIRM_COUNTDOWN_DEFAULT_SEC },
  confirmText: { type: String, default: '' },
  cancelText: { type: String, default: '' },
  closeOnOutside: { type: Boolean, default: false },
  width: { type: String, default: '' },
})

const emit = defineEmits(['confirm', 'cancel', 'close', 'update:open'])

const bodyRef = ref(null)
const countdown = useCountdown()
const fade = useScrollFade(bodyRef)
const everScrolled = ref(false)

const confirmDisabled = computed(() => {
  if (countdown.active.value) return true
  if (fade.scrollable.value && !everScrolled.value) return true
  return false
})

const confirmLabel = computed(() => {
  if (countdown.active.value) return UI_COPY.CONFIRM_WAIT(countdown.remaining.value)
  if (fade.scrollable.value && !everScrolled.value) return UI_COPY.READ_TO_BOTTOM
  return props.confirmText || UI_COPY.CONFIRM_OK
})

watch(() => props.open, (val) => {
  if (val) {
    everScrolled.value = false
    countdown.start(props.countdown)
  } else {
    countdown.stop()
  }
})

watch(fade.atBottom, (v) => {
  if (v) everScrolled.value = true
})

function onCancel() {
  emit('cancel')
  emit('close')
  emit('update:open', false)
}
function onConfirm() {
  if (confirmDisabled.value) return
  emit('confirm')
  emit('close')
  emit('update:open', false)
}
</script>

<template>
  <UiModal
    :open="open"
    :label="title"
    :width="width"
    :close-on-outside="closeOnOutside"
    :close-on-esc="false"
    @close="onCancel"
    @update:open="(v) => emit('update:open', v)"
  >
    <div class="ui-confirm-a1">
      <header class="ui-confirm-a1__bar">
        <h2 class="ui-confirm-a1__title">{{ title }}</h2>
      </header>

      <div class="ui-confirm-a1__body-wrap">
        <div ref="bodyRef" class="ui-confirm-a1__body">
          <slot />
        </div>
        <div v-if="fade.scrollable.value && !fade.atTop.value" class="ui-confirm-a1__mask ui-confirm-a1__mask--top" aria-hidden="true"></div>
        <div v-if="fade.scrollable.value && !fade.atBottom.value" class="ui-confirm-a1__mask ui-confirm-a1__mask--bottom" aria-hidden="true"></div>
      </div>

      <footer class="ui-confirm-a1__footer">
        <UiButton variant="A" class="ui-confirm-a1__btn" @click="onCancel">
          {{ cancelText || UI_COPY.CONFIRM_CANCEL }}
        </UiButton>
        <UiButton variant="A" fill="brand" class="ui-confirm-a1__btn" :disabled="confirmDisabled" @click="onConfirm">
          {{ confirmLabel }}
        </UiButton>
      </footer>
    </div>
  </UiModal>
</template>

<style scoped>
.ui-confirm-a1 {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  max-height: 82vh;
}

.ui-confirm-a1__bar {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  height: var(--modala1-bar-h, 52px);
  box-sizing: border-box;
  padding: 0 var(--space-5);
  background: var(--paper-raised);
}
.ui-confirm-a1__title {
  font-size: var(--fs-lg);
  font-weight: 600;
  color: var(--ink);
}

.ui-confirm-a1__body-wrap {
  position: relative;
  z-index: 1;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.ui-confirm-a1__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: var(--space-3) var(--space-5) var(--space-5);
}

.ui-confirm-a1__mask {
  position: absolute;
  left: 0;
  right: 0;
  height: var(--modal-mask-h);
  pointer-events: none;
}
.ui-confirm-a1__mask--top { top: 0; background: linear-gradient(to bottom, var(--paper-raised), transparent); }
.ui-confirm-a1__mask--bottom { bottom: 0; background: linear-gradient(to top, var(--paper-raised), transparent); }

.ui-confirm-a1__footer {
  display: flex;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-5) var(--space-5);
  background: var(--paper-raised);
}
.ui-confirm-a1__btn { flex: 1; }
</style>
