/**
 * overlay.js - M5-00 module entry state + actions
 * -------------------------------------------------------
 * - Module-singleton reactive overlay state. M2 shell (envelope click -> openC3,
 *   user-area hover -> openC4) and the M5Host component both consume this module.
 * - Child tree cascades consume M0 shared base (modals/dropdown/card); no new
 *   overlay scaffolding is built here.
 * - Blocked path: openC3 / openSettings require auth; the auth gate stub fires a
 *   login-required toast when not authed (negative-path testable).
 */
import { reactive } from 'vue'
import { loadNotifications } from './data.js'
import { requireAuth } from './auth.js'

export const overlay = reactive({
  c3: false,
  c4: false,
  c4Trigger: null,
  settings: false,
  about: false,
  feedback: false,
})

/** C3 notification modal (M2-05 envelope click). Blocked when not authed. */
export function openC3() {
  if (!requireAuth()) return
  overlay.c3 = true
  loadNotifications()
}

export function closeC3() {
  overlay.c3 = false
}

/** C4 more dropdown (M2-04 user-area hover). triggerEl = the anchoring element. */
export function openC4(triggerEl) {
  overlay.c4Trigger = triggerEl || null
  overlay.c4 = true
}

export function closeC4() {
  overlay.c4 = false
}

/** Settings window (C4 option -> settings). Blocked when not authed. */
export function openSettings() {
  if (!requireAuth()) return
  overlay.c4 = false
  overlay.settings = true
}

export function closeSettings() {
  overlay.settings = false
}

/** About platform window (C4 option; M5-13 fills the content). */
export function openAbout() {
  overlay.c4 = false
  overlay.about = true
}

export function closeAbout() {
  overlay.about = false
}

/** Feedback window (C4 option; M5-14..16 fill the content). */
export function openFeedback() {
  overlay.c4 = false
  overlay.feedback = true
}

export function closeFeedback() {
  overlay.feedback = false
}
