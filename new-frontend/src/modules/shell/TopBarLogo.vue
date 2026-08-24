<script setup>
import { useRouter } from 'vue-router'
import { UiButton } from '@/components/ui/index.js'
import LogoSvg from '@/assets/svg/logo.svg'
import { SHELL_COPY } from '@/constants/m-shell.js'

/**
 * TopBarLogo - Top bar brand/logo button (M2-02)
 * ----------------------------------------------
 * - UiButton variant "B" (bare: no fill, no border, black text) carrying the LOGO
 *   (28px) + the platform name (AK-N-B4). The button is ~40px tall; logo-to-name
 *   gap is --space-4 (16px, "bigger than imagined" per user ⑦), and the name is a
 *   black nowrap string that ellipsizes on very narrow screens so the top bar never
 *   overflows at 375px.
 * - Click navigates back to the landing page via router.push('/').
 * - Copy/aria sourced from SHELL_COPY (LOGO_LABEL + LOGO_NAME single source, no
 *   raw copy in component).
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
    <LogoSvg class="topbar-logo__svg" aria-hidden="true" />
    <span class="topbar-logo__name">{{ SHELL_COPY.LOGO_NAME }}</span>
  </UiButton>
</template>

<style scoped>
/* Override UiButton capsule fixed width: logo + name hug their intrinsic size.
   Height is pinned to 40px (AK-N-B4 "~40-44px high"). */
.topbar-logo {
  width: auto;
  --btn-h: 40px;
  padding: 0 var(--space-3);
  gap: var(--space-4);
  max-width: 100%;
}

/* LOGO glyph size, capped under --space-7 (28px), never shrinks. */
.topbar-logo__svg {
  width: 28px;
  height: 28px;
  display: block;
  flex: none;
}

/* Platform name: black nowrap text that ellipsizes when the button shrinks on
   narrow screens (min-width:0 + overflow hidden lets the flex item truncate). */
.topbar-logo__name {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: var(--fs-base);
  font-weight: 700;
  line-height: 1.1;
  color: var(--ink);
}
</style>
