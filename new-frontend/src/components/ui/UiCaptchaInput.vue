<script setup>
import { computed, ref } from 'vue'
import UiInput from './UiInput.vue'
import { useRipple } from '@/composables/useRipple'
import { useCountdown } from '@/composables/useCountdown'
import { showToast } from '@/composables/useToast'
import { UI_CONSTANTS, UI_COPY } from '@/constants/ui.js'

/**
 * UiCaptchaInput - Captcha input A (plan "input component styles - captcha input A")
 * -------------------------------------------------------
 * - Essentially input A + a right 30% button B "send code" (right/top/bottom edges aligned with the input).
 * - The input's underline right bound is shifted to "30% from the right, then a bit further left".
 * - Button B is statically fill-less (passes through the input's effects); the effect mask stays; the button zone does not trigger the input.
 * - Click send -> emit('send'); while counting down the button shows gray text "x seconds until resend".
 * - Success toast is shown by the module on the send callback (UI_COPY.OTP_SENT); the module calls startCountdown() to arm cooldown.
 * - autoCountdown=true (preview/optimistic scenarios) starts cooldown + toast on click.
 */
const props = defineProps({
  modelValue: { type: [String, Number], default: '' },
  placeholder: { type: String, default: '' },
  maxLength: { type: Number, default: 6 },
  filter: { type: String, default: 'digits' },
  countdown: { type: Number, default: UI_CONSTANTS.OTP_COOLDOWN_SEC },
  disabled: { type: Boolean, default: false },
  autoCountdown: { type: Boolean, default: false },
})

const emit = defineEmits(['update:modelValue', 'send'])

const sendRef = ref(null)
const counting = useCountdown()
useRipple(sendRef, { disabled: computed(() => props.disabled || counting.active.value) })

const sendText = computed(() => {
  if (counting.active.value) return UI_COPY.OTP_RESEND(counting.remaining.value)
  return UI_COPY.SEND_CODE
})

function onSend() {
  if (props.disabled || counting.active.value) return
  emit('send')
  if (props.autoCountdown) {
    counting.start(props.countdown)
    showToast(UI_COPY.OTP_SENT)
  }
}

function startCountdown(sec) {
  counting.start(sec || props.countdown)
}

defineExpose({ startCountdown, isCounting: counting.active })
</script>

<template>
  <div class="ui-captcha" :class="{ 'is-counting': counting.active.value }">
    <div class="ui-captcha__input">
      <UiInput
        :model-value="modelValue"
        :placeholder="placeholder"
        :filter="filter"
        :max-length="maxLength"
        fill="bare"
        :disabled="disabled"
        width="100%"
        underline-inset-right="calc(30% + 8px)"
        @update:model-value="(v) => emit('update:modelValue', v)"
        @send="emit('send')"
      />
    </div>
    <button
      ref="sendRef"
      type="button"
      class="ui-captcha__send"
      :disabled="disabled || counting.active.value"
      :class="{ 'is-counting': counting.active.value }"
      @click="onSend"
    >
      <span class="ui-captcha__send-text">{{ sendText }}</span>
    </button>
  </div>
</template>

<style scoped>
.ui-captcha {
  position: relative;
  display: flex;
  box-sizing: border-box;
  width: 100%;
  background: var(--paper);
  border-radius: var(--input-radius);
  overflow: hidden;
  transition: background var(--dur-sm) var(--ease-out);
}
/* input focus -> whole box (incl. button zone) fades to gray-10, passing through the input effect */
.ui-captcha:focus-within { background: var(--gray-10); }

.ui-captcha__input {
  flex: 0 0 70%;
  min-width: 0;
}

.ui-captcha__send {
  position: relative;
  flex: 0 0 30%;
  box-sizing: border-box;
  border: none;
  background: transparent;
  color: var(--ink);
  cursor: pointer;
  font-size: var(--fs-base);
  line-height: 1;
  overflow: hidden;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}
.ui-captcha__send:focus-visible { outline: none; box-shadow: inset 0 0 0 2px var(--brand); }

/* ripple (same as button B, passing through the mask) */
.ui-captcha__send::before,
.ui-captcha__send::after {
  content: "";
  position: absolute;
  left: var(--mx, 50%);
  top: var(--my, 50%);
  width: var(--btn-d, 300px);
  height: var(--btn-d, 300px);
  margin-left: calc(var(--btn-d, 300px) / -2);
  margin-top: calc(var(--btn-d, 300px) / -2);
  border-radius: 50%;
  transform: scale(0);
  opacity: 0;
  pointer-events: none;
}
.ui-captcha__send::before {
  background: var(--gray-15);
  transform: scale(1);
  opacity: 0;
  transition: opacity var(--dur-md) var(--ease-out);
}
@media (hover: hover) and (pointer: fine) {
  .ui-captcha__send:hover::before,
  .ui-captcha__send:focus-visible::before {
    opacity: 1;
    animation: ui-captcha-hover-in var(--dur-xs) var(--ease-out) forwards;
  }
}
@keyframes ui-captcha-hover-in {
  from { transform: scale(0); }
  to { transform: scale(1); }
}
.ui-captcha__send::after { background: var(--gray-30); }
.ui-captcha__send.is-rippling::after {
  animation: ui-ripple var(--dur-xl) var(--ease-out) forwards;
}

.ui-captcha__send-text {
  position: relative;
  z-index: 1;
  transition: color var(--dur-sm) var(--ease-out);
}
.ui-captcha__send.is-counting .ui-captcha__send-text,
.ui-captcha__send:disabled .ui-captcha__send-text { color: var(--gray-50); }
.ui-captcha__send:disabled { cursor: default; }

@media (prefers-reduced-motion: reduce) {
  .ui-captcha__send::before,
  .ui-captcha__send::after,
  .ui-captcha__send.is-rippling::after { animation: none; transition: none; }
}
</style>
