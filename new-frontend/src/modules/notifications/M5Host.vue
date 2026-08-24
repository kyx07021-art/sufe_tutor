<script setup>
import {
  overlay,
  closeC3,
  closeC4,
  closeSettings,
  closeAbout,
  closeFeedback,
  openSettings,
  openAbout,
  openFeedback,
} from './overlay.js'
import NotificationsModal from './NotificationsModal.vue'
import MoreMenu from './MoreMenu.vue'
import SettingsPanel from './SettingsPanel.vue'
import AboutModal from './AboutModal.vue'
import FeedbackModal from './FeedbackModal.vue'
import { logout } from '@/modules/shell/auth-actions.js'
import { useRouter } from 'vue-router'

// AK-L-F2: the M5 preview harness mounts M5Host standalone (no router), where
// useRouter() resolves undefined — navigate only when a router is present.
const router = useRouter()

/** AK-L-F2: C4 logout — close the dropdown, clear the session, land back on the
    landing page. auth-actions.logout() is the single exit (auth + storage +
    datahub cache + shell cleanup callbacks). */
function onLogout() {
  closeC4()
  logout()
  if (router) router.push('/')
}

/**
 * M5Host - M5 overlay tree assembly
 * -------------------------------------------------------
 * - Mounted once by the M2 shell (or the M5 preview harness). Teleports the C3
 *   notification modal, C4 more dropdown, settings window (M5-07), about window
 *   (M5-13) and feedback window (M5-14..16) off the overlay state.
 */
</script>

<template>
  <NotificationsModal :open="overlay.c3" @close="closeC3" />
  <MoreMenu
    :open="overlay.c4"
    :trigger="overlay.c4Trigger"
    @close="closeC4"
    @open-settings="openSettings"
    @open-about="openAbout"
    @open-feedback="openFeedback"
    @open-logout="onLogout"
  />
  <SettingsPanel :open="overlay.settings" @close="closeSettings" />
  <AboutModal :open="overlay.about" @close="closeAbout" />
  <FeedbackModal :open="overlay.feedback" @close="closeFeedback" />
</template>
