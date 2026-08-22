<script setup>
import { UiModalA1, UiText } from '@/components/ui/index.js'
import { NOTIF_COPY } from '@/constants/m-notifications'

/**
 * AboutModal - M5-13 about platform modal
 * -------------------------------------------------------
 * - Modal A1 titled NOTIF_COPY.ABOUT_TITLE, opened by the C4 "about platform"
 *   option in the MoreMenu.
 * - Body shows the platform display name, a version line and the copyright
 *   line. Content is left-aligned and vertically centered with generous
 *   spacing (--space-5 / --space-6).
 * - The version number is injected at build/transform time by Vite define
 *   (__APP_VERSION__), sourced verbatim from src/shared/config.js APP_VERSION
 *   (S0-01 single source, PA-1i-F2). No hardcoded version literal lives here.
 * - Zero inline style attributes / v-html / runtime <style> injection.
 */
defineProps({
  open: { type: Boolean, default: false },
})
const emit = defineEmits(['close'])

const versionLine = `${NOTIF_COPY.ABOUT_VERSION} ${__APP_VERSION__}`
</script>

<template>
  <UiModalA1
    :open="open"
    :title="NOTIF_COPY.ABOUT_TITLE"
    :close-on-outside="true"
    :close-on-esc="true"
    @close="emit('close')"
  >
    <div class="ab-about">
      <h3 class="ab-about__name">{{ NOTIF_COPY.PLATFORM_NAME }}</h3>
      <UiText :text="versionLine" size="var(--fs-base)" color="var(--gray-60)" />
      <UiText :text="NOTIF_COPY.ABOUT_COPYRIGHT" size="var(--fs-sm)" color="var(--gray-50)" />
    </div>
  </UiModalA1>
</template>

<style scoped>
.ab-about {
  box-sizing: border-box;
  min-height: min(320px, 60vh);
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: var(--space-5);
  padding: var(--space-6);
}
.ab-about__name {
  margin: 0;
  font-size: var(--fs-xl);
  font-weight: 600;
  color: var(--ink);
  overflow-wrap: break-word;
}
</style>
