/**
 * settings-data.js - M5-08 settings data layer
 * -------------------------------------------------------
 * - I-08 GET /api/settings ->
 *     { user:{id,username,avatar,role,contactMasks},
 *       usernameStatus:{canChange,cooldownMs},
 *       blockSystemNotifications, notifyBroadcastMuted,
 *       devices:[{session_id,label,created_at,expires_at,current}] }
 * - I-09 PUT /api/settings partial update by field branch ->
 *     { ok, username?, phone?, email? (masked) }
 * - Module singleton reactive state: single source for the settings window
 *   (M5-07 assembly + M5-09a..12 rows).
 * - F7 contract: after a successful write the local state (and any UI reading it)
 *   reflects the new value immediately.
 */
import { reactive, watch } from 'vue'
import { api } from '@/core/api.js'
import { notifyState, setBlockSystem } from './data.js'

export const settingsState = reactive({
  user: { id: null, username: '', avatar: '', role: '', contactMasks: { phone: '', email: '' } },
  usernameStatus: { canChange: false, cooldownMs: 0 },
  blockSystemNotifications: false,
  notifyBroadcastMuted: false,
  devices: [],
  loading: false,
  error: '',
  saved: false,
})

// Mirror the C3 notification preference (M5-03 toggle -> notifyState.blockSystem)
// into the settings row (settingsState.blockSystemNotifications) both ways.
// flush:'sync' guarantees immediate reflection for the F7 state-sync contract.
watch(
  () => notifyState.blockSystem,
  (v) => {
    settingsState.blockSystemNotifications = !!v
  },
  { flush: 'sync' }
)

let savedTimer = null

function setSaved() {
  settingsState.saved = true
  clearTimeout(savedTimer)
  savedTimer = setTimeout(() => {
    settingsState.saved = false
  }, 2000)
}

/** Reflect notifyBroadcastMuted into the settings row (single source). */
export function setNotifyBroadcastMuted(v) {
  settingsState.notifyBroadcastMuted = !!v
}

export function getSettings() {
  return settingsState
}

/** Merge an I-09 PUT response (masked fields) into the local state (F7). */
function mergeSettingsResponse(data) {
  if (!data || typeof data !== 'object') return
  if (data.user && typeof data.user === 'object') {
    settingsState.user = {
      ...(settingsState.user || {}),
      ...data.user,
      contactMasks: {
        ...(settingsState.user ? settingsState.user.contactMasks : {}),
        ...(data.user.contactMasks || {}),
      },
    }
    return
  }
  const u = settingsState.user
  if (!u) return
  if (data.username !== undefined) u.username = data.username
  if (data.avatar !== undefined) u.avatar = data.avatar
  if (data.phone !== undefined) u.contactMasks = { ...(u.contactMasks || {}), phone: data.phone }
  if (data.email !== undefined) u.contactMasks = { ...(u.contactMasks || {}), email: data.email }
}

/** I-08 GET /api/settings - populate the settings window state. */
export async function loadSettings() {
  settingsState.loading = true
  settingsState.error = ''
  try {
    const data = await api('/settings')
    if (data && typeof data === 'object') {
      if (data.user && typeof data.user === 'object') {
        settingsState.user = {
          ...(settingsState.user || {}),
          ...data.user,
          contactMasks: {
            ...(settingsState.user ? settingsState.user.contactMasks : {}),
            ...(data.user.contactMasks || {}),
          },
        }
      }
      if (data.usernameStatus && typeof data.usernameStatus === 'object') {
        settingsState.usernameStatus = {
          canChange: !!data.usernameStatus.canChange,
          cooldownMs: Number(data.usernameStatus.cooldownMs) || 0,
        }
      }
      settingsState.devices = Array.isArray(data.devices) ? data.devices : []
      if (data.blockSystemNotifications !== undefined) {
        settingsState.blockSystemNotifications = !!data.blockSystemNotifications
        setBlockSystem(data.blockSystemNotifications)
      }
      if (data.notifyBroadcastMuted !== undefined) {
        setNotifyBroadcastMuted(data.notifyBroadcastMuted)
      }
    }
  } catch (e) {
    settingsState.error = (e && e.message) || ''
  } finally {
    settingsState.loading = false
  }
  return settingsState
}

/** I-09 PUT /api/settings partial update. Returns the response data. */
export async function updateSettings(patch) {
  settingsState.error = ''
  try {
    const data = await api('/settings', { method: 'PUT', body: { ...patch } })
    mergeSettingsResponse(data)
    if (patch && patch.blockSystemNotifications !== undefined) {
      setBlockSystem(patch.blockSystemNotifications)
    }
    if (patch && patch.notifyBroadcastMuted !== undefined) {
      setNotifyBroadcastMuted(patch.notifyBroadcastMuted)
    }
    setSaved()
    return data
  } catch (e) {
    settingsState.error = (e && e.message) || ''
    throw e
  }
}
