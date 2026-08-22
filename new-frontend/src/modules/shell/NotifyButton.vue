<script setup>
/**
 * NotifyButton.vue - M2-05 top bar notification (C3) trigger
 * ----------------------------------------------------------
 * - UiButton variant "B" short capsule carrying an envelope glyph.
 * - Click opens the M5 C3 notifications overlay through the ifaces cap
 *   (`getIface('openC3')`), keeping this button decoupled from M5: when M5
 *   has not registered yet, the call is skipped and the button is inert
 *   (marked `data-cap="M5.c3"` as a placeholder awaiting M5).
 * - aria-label sourced from SHELL_COPY.NOTIFY_LABEL (single source, no raw
 *   copy in component).
 * - Zero inline style/event attributes; comments English (contract 6).
 */
import { UiButton } from '@/components/ui/index.js'
import { getIface } from './ifaces.js'
import { SHELL_COPY } from '@/constants/m-shell.js'
import EnvelopeSvg from '@/assets/svg/mail.svg'

function onOpen() {
  const openC3 = getIface('openC3')
  if (openC3) openC3()
}
</script>

<template>
  <UiButton
    variant="B"
    class="notify-btn"
    data-cap="M5.c3"
    :aria-label="SHELL_COPY.NOTIFY_LABEL"
    @click="onOpen"
  >
    <EnvelopeSvg class="notify-btn__svg" aria-hidden="true" />
  </UiButton>
</template>

<style scoped>
/* Short capsule: override M0 button size tokens (scoped selector beats .ui-btn). */
.notify-btn {
  --btn-w: 40px;
  --btn-h: 40px;
}

/* Envelope glyph size; block keeps it baseline-aligned within the label. */
.notify-btn__svg {
  width: 20px;
  height: 20px;
  display: block;
}
</style>
