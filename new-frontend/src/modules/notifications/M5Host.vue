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
  />
  <SettingsPanel :open="overlay.settings" @close="closeSettings" />
  <AboutModal :open="overlay.about" @close="closeAbout" />
  <FeedbackModal :open="overlay.feedback" @close="closeFeedback" />
</template>
