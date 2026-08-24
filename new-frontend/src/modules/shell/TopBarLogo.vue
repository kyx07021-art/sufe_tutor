<script setup>
import { useRouter } from 'vue-router'
import { UiButton } from '@/components/ui/index.js'
import LogoSvg from '@/assets/svg/logo.svg'
import { SHELL_COPY } from '@/constants/m-shell.js'

/**
 * TopBarLogo - Top bar brand/logo button (M2-02)
 * ----------------------------------------------
 * - UiButton variant "B" (bare: no fill, no border, black text) with the LOGO as its inner content.
 * - Click navigates back to the landing page via router.push('/').
 * - aria-label sourced from SHELL_COPY.LOGO_LABEL (single source, no raw copy in component).
 * - Zero inline style/event attributes; comments English (contract 6).
 */

const router = useRouter()

function goHome() {
  router.push('/')
}
</script>

<template>
  <UiButton
    variant="B"
    :aria-label="SHELL_COPY.LOGO_LABEL"
    class="topbar-logo"
    @click="goHome"
  >
    <LogoSvg class="topbar-logo__svg" />
  </UiButton>
</template>

<style scoped>
/* Override UiButton capsule fixed width: logo hugs its own intrinsic size. */
.topbar-logo {
  width: auto;
  padding: 0 var(--space-2);
}

/* LOGO glyph size, capped under --space-7 (28px). */
.topbar-logo__svg {
  width: 28px;
  height: 28px;
  display: block;
}
</style>
