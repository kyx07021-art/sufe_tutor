<script setup>
/**
 * App root - M2: routing takes over the shell.
 * - Renders the router outlet (memory history) + the global toast singleton
 *   + the global identity-auth host (M6, mounted once so openIdentityAuth works
 *   from anywhere; importing AuthHost also registers the 'openIdentityAuth'
 *   shell iface for the router guard / dead-token fallback).
 * - The M0 component showcase stays reachable at /preview (dev/QA).
 */
import { RouterView } from 'vue-router'
import UiToast from '@/components/ui/UiToast.vue'
import { AuthHost } from '@/modules/auth/index.js'
</script>

<template>
  <RouterView />
  <UiToast />
  <AuthHost />
</template>
