<script setup>
/**
 * PasswordRow - M6-6 password input mode (plan C5 "info input area: password")
 * -------------------------------------------------------
 * - Renders the password method title plus the password input.
 * - Collects the password into `value`; the parent clears it when the auth method
 *   is switched away (switchMethod resets the credential buffer).
 * - Optional identifier field (login scene, password login): shown only when the
 *   parent supplies an identifierPlaceholder.
 * - The password is collected via UiInput type="password" (masked native input,
 *   no shoulder-surfing exposure). RegisterPane applies the same mask.
 */
import { UiInput } from '@/components/ui/index.js'
import { AUTH_COPY } from '@/constants/m-auth.js'

defineProps({
  value: { type: String, default: '' },
  identifier: { type: String, default: '' },
  identifierPlaceholder: { type: String, default: '' },
  identifierFilter: { type: String, default: 'none' },
})

const emit = defineEmits(['update:value', 'update:identifier'])
</script>

<template>
  <div class="password-row">
    <p class="password-row__title ui-title-sm">{{ AUTH_COPY.METHOD_TITLE.password }}</p>
    <UiInput
      v-if="identifierPlaceholder"
      :model-value="identifier"
      :placeholder="identifierPlaceholder"
      :filter="identifierFilter"
      class="password-row__identifier"
      @update:model-value="(v) => emit('update:identifier', v)"
    />
    <UiInput
      :model-value="value"
      :placeholder="AUTH_COPY.PASSWORD_PLACEHOLDER"
      filter="none"
      type="password"
      class="password-row__password"
      @update:model-value="(v) => emit('update:value', v)"
    />
  </div>
</template>

<style scoped>
.password-row {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  width: 100%;
  min-width: 0;
}

.password-row__identifier {
  width: 100%;
}

.password-row__password {
  width: 100%;
}
</style>
