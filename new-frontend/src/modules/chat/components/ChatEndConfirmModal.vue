<script setup>
/**
 * ChatEndConfirmModal - M4-24 end-session confirm modal (capToken)
 * -----------------------------------------------------------------
 * - Danger confirm modal opened from the chat topbar "more" dropdown.
 *   Pure visual confirm: emits 'confirm' / 'cancel'; the module lead wires
 *   the I-16 POST /api/conversations/:id/close request (capToken produced by
 *   the M6 identity-auth re-auth flow) in assembly. This component does NOT
 *   call the network.
 * - While `busy` (close request in flight): both buttons are disabled (F6 -
 *   repeated confirm clicks are no-ops), the confirm button shows the busy
 *   copy, and close-on-outside / close-on-esc are off so the modal cannot be
 *   dismissed mid-flight.
 * - Copy comes from CHAT_COPY / UI_COPY (contract 6): template, scoped CSS
 *   and comments hold zero Chinese.
 */
import UiModal from '@/components/ui/UiModal.vue'
import UiButton from '@/components/ui/UiButton.vue'
import { CHAT_COPY, UI_COPY } from '@/constants/ui.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  /** close request in flight: disables actions + locks dismissal */
  busy: { type: Boolean, default: false },
})

const emit = defineEmits(['confirm', 'cancel'])

/** F6: busy re-entry guard - repeated confirm clicks are no-ops. */
function onConfirm() {
  if (props.busy) return
  emit('confirm')
}

function onCancel() {
    if (props.busy) return
  emit('cancel')
}
</script>

<template>
  <UiModal
    :open="open"
    :label="CHAT_COPY.END_TITLE"
    width="400px"
    :close-on-outside="!busy"
    :close-on-esc="!busy"
    @close="onCancel"
  >
    <div class="chat-end">
      <h3 class="chat-end__title">{{ CHAT_COPY.END_TITLE }}</h3>
      <p class="chat-end__body">{{ CHAT_COPY.END_BODY }}</p>
      <p v-if="CHAT_COPY.END_REAUTH_HINT" class="chat-end__hint">
        {{ CHAT_COPY.END_REAUTH_HINT }}
      </p>
      <div class="chat-end__actions">
        <UiButton variant="B" class="chat-end__btn" :disabled="busy" @click="onCancel">
          {{ UI_COPY.ALERT_CANCEL }}
        </UiButton>
        <UiButton variant="A" fill="danger" class="chat-end__btn" :disabled="busy" @click="onConfirm">
          {{ busy ? CHAT_COPY.END_BUSY : CHAT_COPY.END_OK }}
        </UiButton>
      </div>
    </div>
  </UiModal>
</template>

<style scoped>
.chat-end {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-5);
}

.chat-end__title {
  margin: 0;
  font-size: var(--fs-lg);
  font-weight: 600;
  color: var(--ink);
}

.chat-end__body {
  margin: 0;
  font-size: var(--fs-base);
  line-height: var(--lh-body);
  color: var(--ink);
  white-space: pre-wrap; /* keep the multi-line body's line breaks */
  overflow-wrap: break-word;
}

.chat-end__hint {
  margin: 0;
  font-size: var(--fs-sm);
  color: var(--gray-50);
  line-height: var(--lh-body);
}

.chat-end__actions {
  display: flex;
  gap: var(--space-4);
  margin-top: var(--space-2);
}
.chat-end__btn {
  flex: 1;
  min-width: 0;
}
</style>
