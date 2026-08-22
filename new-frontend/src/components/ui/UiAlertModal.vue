<script setup>
import UiModal from './UiModal.vue'
import UiButton from './UiButton.vue'
import { UI_COPY } from '@/constants/ui.js'

/**
 * UiAlertModal - Confirm modal A (plan "modal styles - confirm modal A")
 * -------------------------------------------------------
 * - Otherwise same as modal A; split into top 70% / bottom 30%.
 * - Top 70%: a centered single line of text (black, thicker font) = the message.
 * - Bottom 30%: two long buttons A - left "cancel" white fill, right "confirm" red (danger ops) or brand purple (generic confirm).
 */
defineProps({
  open: { type: Boolean, default: false },
  message: { type: String, default: '' },
  /** true -> confirm button red (danger ops such as delete); false -> brand purple */
  danger: { type: Boolean, default: false },
  confirmText: { type: String, default: '' },
  cancelText: { type: String, default: '' },
  closeOnOutside: { type: Boolean, default: false },
  width: { type: String, default: '' },
})

const emit = defineEmits(['confirm', 'cancel', 'close', 'update:open'])

function onCancel() {
  emit('cancel')
  emit('close')
  emit('update:open', false)
}
function onConfirm() {
  emit('confirm')
  emit('close')
  emit('update:open', false)
}
</script>

<template>
  <UiModal
    :open="open"
    :label="message"
    :width="width"
    :close-on-outside="closeOnOutside"
    :close-on-esc="false"
    @close="onCancel"
    @update:open="(v) => emit('update:open', v)"
  >
    <div class="ui-alert">
      <div class="ui-alert__msg">
        <p class="ui-alert__text">{{ message }}</p>
      </div>
      <div class="ui-alert__actions">
        <UiButton variant="A" class="ui-alert__btn" @click="onCancel">
          {{ cancelText || UI_COPY.ALERT_CANCEL }}
        </UiButton>
        <UiButton
          variant="A"
          :fill="danger ? 'danger' : 'brand'"
          class="ui-alert__btn"
          @click="onConfirm"
        >
          {{ confirmText || UI_COPY.ALERT_CONFIRM }}
        </UiButton>
      </div>
    </div>
  </UiModal>
</template>

<style scoped>
.ui-alert {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  min-height: 220px;
}

/* top 70%: centered single line of text */
.ui-alert__msg {
  flex: 7 1 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-6);
  text-align: center;
}
.ui-alert__text {
  font-size: var(--fs-lg);
  font-weight: 600;
  color: var(--ink);
  line-height: var(--lh-tight);
  max-width: 90%;
}

/* bottom 30%: two long buttons */
.ui-alert__actions {
  flex: 3 1 0;
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: 0 var(--space-4) var(--space-4);
}
.ui-alert__btn { flex: 1; }
</style>
