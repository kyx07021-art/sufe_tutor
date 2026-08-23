/**
 * data.js - M5-01 notification data layer
 * -------------------------------------------------------
 * - I-26 GET /api/notifications -> { notifications: [{ id, type, title, content, created_at, is_read, avatar_src }] }
 *   The server already filters by blockSystemNotifications / notifyBroadcastMuted;
 *   the client must NOT re-filter (M5-01 acceptance).
 * - I-27 POST /api/notifications/:id/read + /api/notifications/read-all.
 * - Cache = module reactive state (single source); unread count derives from it.
 * - formatNotificationTime: C2.3 time display format (shared by card and detail; may be
 *   promoted to core/display when M4 conversation cards need it).
 */
import { computed, reactive } from 'vue'
import { api } from '@/core/api.js'
import { NOTIF_COPY, NOTIF_POLL_MS } from '@/constants/m-notifications'
import { createPoller } from '@/modules/chat/index.js'

export const notifyState = reactive({
  items: [],
  loading: false,
  error: '',
  blockSystem: false, // I-28 blockSystemNotifications (server-side filter; single source for M5-03/M5-08)
})

/** Set blockSystemNotifications (M5-03 toggle / M5-08 settings load). Persisted via PUT /api/settings. */
export function setBlockSystem(v) {
  notifyState.blockSystem = !!v
}

export function getNotifications() {
  return notifyState.items
}

/** unread count derives from the cache (single source for the envelope red dot). */
export const unreadCountRef = computed(() => notifyState.items.filter((i) => !i.is_read).length)

export async function loadNotifications() {
  notifyState.loading = true
  notifyState.error = ''
  try {
    const data = await api('/notifications')
    notifyState.items = Array.isArray(data && data.notifications) ? data.notifications : []
  } catch (e) {
    notifyState.error = (e && e.message) || NOTIF_COPY.NOTIF_LOAD_ERROR
  } finally {
    notifyState.loading = false
  }
  return notifyState.items
}

export async function markNotificationRead(id) {
  const item = notifyState.items.find((x) => String(x.id) === String(id))
  try {
    await api('/notifications/' + encodeURIComponent(String(id)) + '/read', { method: 'POST' })
    if (item) item.is_read = true
  } catch (e) {
    notifyState.error = (e && e.message) || NOTIF_COPY.NOTIF_LOAD_ERROR
  }
}

export async function markAllRead() {
  try {
    await api('/notifications/read-all', { method: 'POST' })
    notifyState.items.forEach((x) => {
      x.is_read = true
    })
  } catch (e) {
    notifyState.error = (e && e.message) || NOTIF_COPY.NOTIF_LOAD_ERROR
  }
}

/** Single badge poller (F3: idempotent start/stop; only one timer ever exists). */
let notifyPoller = null

/**
 * Start the slow unread-badge poll (I-26). Driven by the shell envelope button's
 * component lifecycle (mounted => logged-in shell), so the poll is naturally
 * auth-gated: it never runs for guests, and unmount on logout/401 stops it.
 * Reuses the shared createPoller (W6) — no second timer implementation.
 */
export function startNotifyPolling() {
  if (notifyPoller) return notifyPoller
  notifyPoller = createPoller({
    apiFn: api,
    intervalMs: NOTIF_POLL_MS,
    onTick: () => loadNotifications(),
  })
  notifyPoller.start()
  return notifyPoller
}

/** Stop the badge poll (idempotent). */
export function stopNotifyPolling() {
  if (notifyPoller) {
    notifyPoller.stop()
    notifyPoller = null
  }
}

/** C2.3 time display: today "x时x分前" / yesterday "昨天" / same-year "x月x日" / older "x年x月x日". */
export function formatNotificationTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startD = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const dayDiff = Math.round((startToday - startD) / 86400000)

  if (dayDiff <= 0) {
    const diffMs = now.getTime() - d.getTime()
    if (diffMs < 0) return NOTIF_COPY.TIME_JUST_NOW
    const totalMin = Math.floor(diffMs / 60000)
    if (totalMin < 1) return NOTIF_COPY.TIME_JUST_NOW
    if (totalMin < 60) return NOTIF_COPY.TIME_MINUTES_AGO(totalMin)
    return NOTIF_COPY.TIME_HOURS_AGO(Math.floor(totalMin / 60), totalMin % 60)
  }
  if (dayDiff === 1) return NOTIF_COPY.TIME_YESTERDAY
  if (d.getFullYear() === now.getFullYear()) return NOTIF_COPY.TIME_MONTH_DAY(d.getMonth() + 1, d.getDate())
  return NOTIF_COPY.TIME_YEAR_MONTH_DAY(d.getFullYear(), d.getMonth() + 1, d.getDate())
}
