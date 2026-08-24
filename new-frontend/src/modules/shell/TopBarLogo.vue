<script setup>
import { useRouter } from 'vue-router'
import { UiButton } from '@/components/ui/index.js'
import LogoSvg from '@/assets/svg/logo.svg'
import { SHELL_COPY } from '@/constants/m-shell.js'

/**
 * TopBarLogo - Top bar brand/logo button (M2-02, AK-N-B4)
 * ----------------------------------------------
 * - UiButton variant "B" (bare: no fill, no border, black text) carrying the LOGO
 *   (28px) + the full platform name (SHELL_COPY.LOGO_NAME) on the right.
 * - 40px-tall button; the logo-to-name gap is --space-4 (16px, "bigger than imagined"
 *   per user ⑦); the name is black nowrap text that ellipsizes on very narrow
 *   screens so the top bar never overflows at 375px.
 * - Click navigates back to the landing page via router.push('/').
 * - Copy/aria sourced from SHELL_COPY (LOGO_LABEL + LOGO_NAME single source, no raw
 *   copy in component).
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
/* Override UiButton capsule fixed width: hug intrinsic width, pin height to 40px
   (AK-N-B4 "40px B button"). --logo-size is the component token for the glyph and
   the name line box so the two share one horizontal baseline. */
.topbar-logo {
  width: auto;
  --btn-h: 40px;
  --logo-size: 28px;
  padding: 0 var(--space-3);
  max-width: 100%;
}

/* LOGO glyph size, never shrinks. */
.topbar-logo__svg {
  width: var(--logo-size);
  height: var(--logo-size);
  display: block;
  flex: none;
}

/* The layout row: UiButton wraps its slot in a plain block .ui-btn__label, so this
   override is what places LOGO + name side by side. A flex gap on .topbar-logo
   itself would be inert — the label wraps both children (audit-verified FAIL). */
.topbar-logo :deep(.ui-btn__label) {
  display: inline-flex;
  align-items: center;
  gap: var(--space-4);
  min-width: 0;
}

/* Platform name: black nowrap text that ellipsizes when the button shrinks on
   narrow screens (min-width:0 + overflow hidden lets the flex item truncate).
   line-height = --logo-size so the text line box matches the glyph height and the
   two tops align exactly under the label's align-items:center (AK-N-B4 baseline). */
.topbar-logo__name {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: var(--fs-base);
  font-weight: var(--fw-bold);
  line-height: var(--logo-size);
  color: var(--ink);
}
</style>
