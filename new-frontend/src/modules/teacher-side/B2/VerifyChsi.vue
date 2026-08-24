<script setup>
/**
 * VerifyChsi - B2-2a CHSI verification code submit channel (I-41)
 * ---------------------------------------------------------------
 * - Text input (label + placeholder from TEACHER_COPY) with a submit button
 *   (UiButton variant A).
 * - Pre-check: /^[A-Za-z0-9]{12,16}$/ before sending; a mismatch shows
 *   B2_CHSI_FORMAT_ERR and sends no request.
 * - Busy lock (F6 in-flight guard): repeated clicks while a request is in flight
 *   are ignored.
 * - On success emits `submitted` (the gate reloads its state); on failure shows
 *   the server message or a generic error.
 * - Zero inline style/event attributes; copy from TEACHER_COPY single source.
 */
import { ref } from 'vue'
import { TEACHER_COPY } from '@/constants/ui.js'
import { UiButton, UiInput } from '@/components/ui/index.js'
import { submitChsi } from './verify-service.js'

const emit = defineEmits(['submitted'])

const code = ref('')
const busy = ref(false)
const error = ref('')

const CODE_RE = /^[A-Za-z0-9]{12,16}$/

async function onSubmit() {
  if (busy.value) return
  const value = code.value.trim()
  if (!CODE_RE.test(value)) {
    error.value = TEACHER_COPY.B2_CHSI_FORMAT_ERR
    return
  }
  busy.value = true
  error.value = ''
  try {
    await submitChsi(value)
    emit('submitted')
  } catch (e) {
    error.value = (e && e.message) || TEACHER_COPY.B1_ERROR
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="verify-chsi">
    <label class="verify-chsi__label">
      <span class="verify-chsi__label-text ui-title-sm">{{ TEACHER_COPY.B2_CHSI_LABEL }}</span>
      <UiInput
        v-model="code"
        :placeholder="TEACHER_COPY.B2_CHSI_PLACEHOLDER"
        filter="alnum"
        :max-length="16"
        :disabled="busy"
        @send="onSubmit"
      />
    </label>
    <UiButton
      variant="A"
      :disabled="busy"
      class="verify-chsi__submit"
      @click="onSubmit"
    >
      {{ TEACHER_COPY.B2_CHSI_SUBMIT }}
    </UiButton>
    <p v-if="error" class="verify-chsi__error">{{ error }}</p>
  </div>
</template>

<style scoped>
.verify-chsi {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
}
.verify-chsi__label {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  width: 100%;
  min-width: 0;
}
.verify-chsi__submit {
  margin-top: var(--space-1);
}
.verify-chsi__error {
  font-size: var(--fs-sm);
  color: var(--danger);
  line-height: var(--lh-body);
}
</style>
