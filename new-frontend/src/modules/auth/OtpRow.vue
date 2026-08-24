<script setup>
/**
 * OtpRow - M6-4 captcha-code input row (plan C5 "info input area: phone/email code")
 * -------------------------------------------------------
 * - Renders the method title (maps current method -> phone-code / email-code label)
 *   plus the captcha input A (M0 UiCaptchaInput: digits-only 6-char code + right
 *   30% send button B that does not fall onto the input).
 * - Optional identifier field (login/register scenes): shown only when the parent
 *   supplies an identifierPlaceholder (bound-contact verify needs no identifier).
 * - Optional `title-suffix` slot: rendered in a flex row right of the method
 *   title (AK-A9 register scene uses it for the channel-switch link; login/verify
 *   pass no slot -> the row holds only the title, zero visual change).
 * - Emits `send` on the send-button click; the parent runs the I-01 chain (M6-5)
 *   and on success calls startCountdown(sec) here to arm the cooldown.
 */
import { ref } from 'vue'
import { UiInput, UiCaptchaInput } from '@/components/ui/index.js'
import { AUTH_COPY } from '@/constants/m-auth.js'

defineProps({
  /** current auth method: 'otp_phone' | 'otp_email' (title maps from AUTH_COPY) */
  method: { type: String, required: true },
  value: { type: String, default: '' },
  countdown: { type: Number, default: 60 },
  sendDisabled: { type: Boolean, default: false },
  /** identifier (target) for login/register; empty hides the field */
  identifier: { type: String, default: '' },
  identifierPlaceholder: { type: String, default: '' },
  identifierFilter: { type: String, default: 'none' },
})

const emit = defineEmits(['update:value', 'update:identifier', 'send'])

const captchaRef = ref(null)

/** Arm the resend cooldown after a successful I-01 send (called by the parent). */
function startCountdown(sec) {
  captchaRef.value?.startCountdown(sec)
}

defineExpose({ startCountdown })
</script>

<template>
  <div class="otp-row">
    <div class="otp-row__title-row">
      <p class="otp-row__title ui-title-sm">{{ AUTH_COPY.METHOD_TITLE[method] }}</p>
      <slot name="title-suffix" />
    </div>
    <UiInput
      v-if="identifierPlaceholder"
      :model-value="identifier"
      :placeholder="identifierPlaceholder"
      :filter="identifierFilter"
      class="otp-row__identifier"
      @update:model-value="(v) => emit('update:identifier', v)"
    />
    <UiCaptchaInput
      ref="captchaRef"
      :model-value="value"
      :placeholder="AUTH_COPY.OTP_CODE_PLACEHOLDER"
      :countdown="countdown"
      :disabled="sendDisabled"
      @update:model-value="(v) => emit('update:value', v)"
      @send="emit('send')"
    />
  </div>
</template>

<style scoped>
.otp-row {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  width: 100%;
  min-width: 0;
}

.otp-row__title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  width: 100%;
  min-width: 0;
}

.otp-row__identifier {
  width: 100%;
}
</style>
