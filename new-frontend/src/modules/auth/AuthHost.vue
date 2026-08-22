<script setup>
/**
 * AuthHost - M6-11 global identity-auth host (mounted once at the app root)
 * -------------------------------------------------------
 * - Renders AuthModal bound to the reactive authOverlay state. Owns the external
 *   lifecycle (CONTRACT.md §7): mount/unmount, the three-exit cleanup (verified /
 *   cancel / forced close) and F3 dedupe — the shell (M6-2) only self-closes.
 */
import AuthModal from './AuthModal.vue'
import { authOverlay, resolveAuthExit, AUTH_EXITS } from './authState.js'

function onVerified() {
  resolveAuthExit(AUTH_EXITS.VERIFIED)
}

function onClose() {
  resolveAuthExit(AUTH_EXITS.CANCEL)
}

function onUpdateOpen(v) {
  authOverlay.open = v
  if (!v) resolveAuthExit(AUTH_EXITS.FORCE_CLOSE)
}
</script>

<template>
  <AuthModal
    :open="authOverlay.open"
    :scene="authOverlay.scene"
    :contact-masks="authOverlay.contactMasks"
    :on-verified="onVerified"
    @close="onClose"
    @update:open="onUpdateOpen"
  />
</template>
