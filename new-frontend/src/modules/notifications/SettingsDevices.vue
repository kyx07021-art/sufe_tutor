<script setup>
/**
 * SettingsDevices - M5-11 device management (I-13)
 * -------------------------------------------------------
 * - Settings section content for the device-management section. Reads the devices
 *   list from the shared settings state (settings-data.js); props/emits are none
 *   by design.
 * - Each row = device identity + created time + a bare B variant revoke button.
 * - Non-current devices: clicking the revoke button calls POST /api/auth/sessions/revoke
 *   with { sessionId }, then removes the row from settingsState.devices locally
 *   (F7 sync) and toasts the saved confirmation.
 * - The current device is never revoked here: the "logout self" flow belongs to the
 *   auth module, so the row's button shows the generic cap toast instead.
 * - Rows are flat (no dividers between them) per the settings design language.
 */
import { computed, ref } from 'vue'
import { UiButton } from '@/components/ui/index.js'
import { showToast } from '@/composables/useToast'
import { NOTIF_COPY } from '@/constants/m-notifications'
import { api } from '@/core/api.js'
import { settingsState } from './settings-data.js'
import { formatNotificationTime } from './data.js'

const devices = computed(() => settingsState.devices)

/** session_id currently being revoked (F6 in-flight guard: no double submit). */
const revokingId = ref(null)

function isRevoking(device) {
  return revokingId.value === String(device.session_id)
}

async function onRevoke(device) {
  if (!device) return
  if (device.current) {
    // The "logout self" flow belongs to the auth module; never revoke here.
    showToast(NOTIF_COPY.CAP_TOAST)
    return
  }
  const id = String(device.session_id)
  if (revokingId.value === id) return
  revokingId.value = id
  try {
    await api('/auth/sessions/revoke', { method: 'POST', body: { sessionId: device.session_id } })
    const i = settingsState.devices.findIndex((d) => String(d.session_id) === id)
    if (i >= 0) settingsState.devices.splice(i, 1) // F7: reflect the write locally
    showToast(NOTIF_COPY.SETTINGS_SAVED)
  } catch (e) {
    showToast((e && e.message) || NOTIF_COPY.CAP_TOAST)
  } finally {
    revokingId.value = null
  }
}
</script>

<template>
  <div class="sd-devices">
    <p class="sd-devices__desc">{{ NOTIF_COPY.SETTINGS_DEVICES_DESC }}</p>

    <p v-if="devices.length === 0" class="sd-devices__empty">{{ NOTIF_COPY.SETTINGS_DEVICE_EMPTY }}</p>

    <ul v-else class="sd-devices__list">
      <li v-for="device in devices" :key="String(device.session_id)" class="sd-row">
        <div class="sd-row__info">
          <span v-if="device.current" class="sd-row__tag">{{ NOTIF_COPY.SETTINGS_DEVICE_CURRENT }}</span>
          <span v-else class="sd-row__name">{{ device.label }}</span>
          <span class="sd-row__time">{{ formatNotificationTime(device.created_at) }}</span>
        </div>
        <UiButton
          variant="B"
          class="sd-row__revoke"
          :disabled="isRevoking(device)"
          @click="onRevoke(device)"
        >
          {{ NOTIF_COPY.SETTINGS_DEVICE_REVOKE }}
        </UiButton>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.sd-devices {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  box-sizing: border-box;
}
.sd-devices__title {
  font-size: var(--fs-lg);
  font-weight: 600;
  color: var(--ink);
}
.sd-devices__desc {
  color: var(--gray-50);
  font-size: var(--fs-sm);
  line-height: var(--lh-body);
}
.sd-devices__empty {
  color: var(--gray-50);
  font-size: var(--fs-sm);
}
/* rows stack with spacing only - no dividers between them (flat settings design) */
.sd-devices__list {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  list-style: none;
  margin: 0;
  padding: 0;
}
.sd-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
}
.sd-row__info {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}
.sd-row__name {
  font-size: var(--fs-base);
  color: var(--ink);
}
.sd-row__tag {
  align-self: flex-start;
  font-size: var(--fs-xs);
  color: var(--gray-60);
  background: var(--gray-10);
  border-radius: var(--radius-pill);
  padding: 2px var(--space-2);
}
.sd-row__time {
  font-size: var(--fs-xs);
  color: var(--gray-50);
}
.sd-row__revoke {
  flex: none;
  --btn-w: 96px;
  --btn-h: 34px;
  --btn-fs: var(--fs-sm);
}
</style>
