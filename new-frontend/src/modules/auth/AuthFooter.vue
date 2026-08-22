<script setup>
/**
 * AuthFooter - M6-9 bottom confirm button + gray-state gate (plan C5)
 * -------------------------------------------------------
 * - Renders the brand-purple confirm button (button A). It stays disabled until
 *   BOTH the credential is complete AND the slider puzzle has passed (plan C5:
 *   the confirm stays gray until the OTP code and the puzzle both pass).
 * - The cancel button lives in AuthShell (M6-2 footer-left); this component is
 *   placed in the footer-right slot so the two wide buttons sit side by side.
 * - Busy disables the button during the in-flight submit (F6).
 */
import { UiButton } from '@/components/ui/index.js'
import { UI_COPY } from '@/constants/ui.js'

defineProps({
  canConfirm: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
})

const emit = defineEmits(['confirm'])
</script>

<template>
  <UiButton
    variant="A"
    fill="brand"
    :disabled="!canConfirm || busy"
    :aria-busy="busy || undefined"
    @click="emit('confirm')"
  >{{ UI_COPY.ALERT_CONFIRM }}</UiButton>
</template>
