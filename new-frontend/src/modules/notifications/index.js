/**
 * index.js - M5 notifications module public entry (M5-00)
 * -------------------------------------------------------
 * - Public surface consumed by M2 shell and the preview harness:
 *   openC3 / openC4 / openSettings / openAbout / openFeedback + M5Host.
 * - M5Host renders the whole overlay tree once (Teleported modals + dropdown);
 *   M2 mounts <M5Host /> inside the shell.
 */
export {
  overlay,
  openC3,
  closeC3,
  openC4,
  closeC4,
  openSettings,
  closeSettings,
  openAbout,
  closeAbout,
  openFeedback,
  closeFeedback,
} from './overlay.js'

export {
  notifyState,
  unreadCountRef,
  loadNotifications,
  markNotificationRead,
  markAllRead,
  startNotifyPolling,
  stopNotifyPolling,
} from './data.js'

export { default as M5Host } from './M5Host.vue'
