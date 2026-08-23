<script setup>
/**
 * NotifyButton.vue - M2-05 top bar notification (C3) trigger
 * ----------------------------------------------------------
 * - UiButton variant "B" short capsule carrying an envelope glyph + unread dot.
 * - Click opens the M5 C3 notifications overlay through the ifaces cap
 *   (`getIface('openC3')`), keeping this button decoupled from M5's UI tree.
 * - Unread red dot reads `getIface('unreadCount')` (a reactive computed ref
 *   registered by main.js; absent until M5 registers -> dot hidden).
 * - Badge poll lifecycle: mounted => start the slow I-26 poll (only the shell
 *   renders this button, so a mounted button means a logged-in session and the
 *   poll is auth-gated by construction); unmount (logout/401) stops it. F3:
 *   start/stop are idempotent, one timer only.
 * - aria-label sourced from SHELL_COPY.NOTIFY_LABEL (single source, no raw
 *   copy in component).
 * - Zero inline style/event attributes; comments English (contract 6).
 */
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { UiButton } from '@/components/ui/index.js'
import { getIface } from './ifaces.js'
import { startNotifyPolling, stopNotifyPolling } from '@/modules/notifications/index.js'
import { SHELL_COPY } from '@/constants/m-shell.js'
import EnvelopeSvg from '@/assets/svg/mail.svg'

function onOpen() {
  const openC3 = getIface('openC3')
  if (openC3) openC3()
}

const unreadCountRef = getIface('unreadCount')
const unread = computed(() => (unreadCountRef ? unreadCountRef.value : 0))

onMounted(() => startNotifyPolling())
onBeforeUnmount(() => stopNotifyPolling())
</script>

<template>
  <UiButton
    variant="B"
    class="notify-btn"
    :aria-label="SHELL_COPY.NOTIFY_LABEL"
    @click="onOpen"
  >
    <span class="notify-btn__icon">
      <EnvelopeSvg class="notify-btn__svg" aria-hidden="true" />
      <span v-if="unread > 0" class="notify-btn__dot" aria-hidden="true"></span>
    </span>
  </UiButton>
</template>

<style scoped>
/* Short capsule: override M0 button size tokens (scoped selector beats .ui-btn). */
.notify-btn {
  --btn-w: 40px;
  --btn-h: 40px;
}

/* Icon wrapper anchors the absolute-positioned unread dot at the top-right. */
.notify-btn__icon {
  position: relative;
  display: block;
}

/* Envelope glyph size; block keeps it baseline-aligned within the label. */
.notify-btn__svg {
  width: 20px;
  height: 20px;
  display: block;
}

/* Unread red dot: 8px circle pinned at the icon's top-right corner. */
.notify-btn__dot {
  position: absolute;
  top: -2px;
  right: -2px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--danger);
}
</style>
