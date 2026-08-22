<script setup>
/**
 * MethodSwitch - M6-7 pick-any-two auth-method switch (button S1, plan C5)
 * -------------------------------------------------------
 * - Shows exactly the two methods NOT currently taken (parent passes the
 *   `others` list from useAuthMethod). Buttons are S1 (underlined gray-60 text,
 *   focus turns black), centered symmetrically with a large middle gap and
 *   inset from the info-area edges.
 * - Clicking emits `select(method)`; the parent's useAuthMethod.switchMethod
 *   performs the switch and resets the credential buffer.
 */
import { UiButton } from '@/components/ui/index.js'
import { AUTH_COPY } from '@/constants/m-auth.js'

defineProps({
  /** the two alternative methods to display (otherMethods result) */
  methods: { type: Array, default: () => [] },
})

const emit = defineEmits(['select'])
</script>

<template>
  <div class="method-switch">
    <UiButton
      v-for="m in methods"
      :key="m"
      variant="S1"
      @click="emit('select', m)"
    >
      {{ AUTH_COPY.METHOD_SWITCH_LABEL[m] }}
    </UiButton>
  </div>
</template>

<style scoped>
.method-switch {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-6);
  width: 100%;
  min-width: 0;
}
</style>
