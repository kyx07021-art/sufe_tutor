<script setup>
/**
 * AuthShell - M6-2 C5 identity-auth floating window shell (modal A)
 * -------------------------------------------------------
 * - Owns the frame only: UiModal (modal A, 440px PC / 80% mobile) + big black
 *   title + cancel button. Form rows / method switch / puzzle / confirm button
 *   are later primitives (M6-4..10) injected via slots.
 * - Self-close boundary (CONTRACT.md §7): this shell manages its own close
 *   (cancel button / backdrop click / Esc -> emit close). The external
 *   lifecycle (openIdentityAuth mount/unmount + three-exit cleanup + F3 dedupe)
 *   is M6-11's job. No double cleanup.
 * - UiModal already handles body-scroll-lock release + Teleport teardown, so a
 *   closed shell leaves no residue.
 */
import { computed } from 'vue'
import { UiModal, UiButton } from '@/components/ui/index.js'
import { AUTH_COPY } from '@/constants/m-auth.js'
import { UI_COPY } from '@/constants/ui.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  /** scene id selects the welcoming header title (AK-A13: TITLE_BY_SCENE) */
  scene: { type: String, default: 'login' },
  /** contactMasks passed through (not consumed here) */
  contactMasks: { type: Object, default: () => ({}) },
  closeOnOutside: { type: Boolean, default: true },
  /** AK-A14: show the flip-to-login underlined link under the title. Only the
      login/register scenes offer it — verify is an authenticated re-auth flow
      and must never invite a "go login" escape. */
  showSwitchLogin: { type: Boolean, default: false },
})

/** Scene-welcoming title (single source = AUTH_COPY.TITLE_BY_SCENE, keys =
 *  AUTH_SCENES values). Fall back to the login title for unknown scenes so a
 *  future scene id never renders an empty header. */
const title = computed(() => AUTH_COPY.TITLE_BY_SCENE[props.scene] || AUTH_COPY.TITLE_BY_SCENE.login)

const emit = defineEmits(['close', 'update:open', 'switch-login'])

function close() {
  emit('close')
  emit('update:open', false)
}
</script>

<template>
  <UiModal
    :open="open"
    :label="title"
    width="440px"
    :close-on-outside="closeOnOutside"
    @close="close"
  >
    <div class="auth-shell">
      <h2 class="auth-shell__title">{{ title }}</h2>
      <!-- AK-A14: flip-to-login underlined link, centered directly under the
           title (login/register only; the shell's showSwitchLogin prop is set
           by AuthModal from the scene). S1 = underline text link (same visual
           as the AK-A9 register channel switch). -->
      <UiButton
        v-if="showSwitchLogin"
        variant="S1"
        class="auth-shell__switch-login"
        @click="emit('switch-login')"
      >{{ AUTH_COPY.HAVE_ACCOUNT }}</UiButton>
      <div class="auth-shell__body">
        <slot />
      </div>
      <footer class="auth-shell__footer">
        <slot name="footer-left">
          <UiButton variant="A" @click="close">{{ UI_COPY.ALERT_CANCEL }}</UiButton>
        </slot>
        <slot name="footer-right" />
      </footer>
    </div>
  </UiModal>
</template>

<style scoped>
.auth-shell {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  /* AK-A12: 24 -> 16 (compact rhythm). AK-N-A1: 16 -> 12 — the register form now
     owns a three-tier rhythm inside the body, so the shell's own inter-region gap
     (title / body / footer) can stay tighter; verify/login are short flows and
     read the same way. Impact boundary: all auth scenes, only the shell frame. */
  gap: var(--space-3);
  width: 100%;
  min-width: 0;
  max-width: 100%;
  /* AK-A12: structural pin - the shell caps itself to the viewport budget and
     never scrolls as a unit (overflow:hidden); the BODY scrolls internally so
     the title + footer stay on-screen and the confirm button never requires
     scrolling to reach (principle 5: squish heights, never font sizes). The
     explicit max-height mirrors the panel's cap: percentage height would
     resolve against the panel's auto height and fail to pin. PA-2-F2's panel
     max-height stays as the outer guard. */
  max-height: calc(100dvh - var(--modal-vpad, 32px));
  overflow: hidden;
  padding: var(--space-5) var(--space-5) var(--space-4); /* AK-A12: 40/24/24 -> 24/24/16 */
  /* AK-A12: captcha container + its send button resolve border-radius from this
     root token (22px default); re-point them at the compact 32px-input capsule. */
  --input-radius: 16px;
}

.auth-shell__title {
  flex: none;
  /* AK-A13: 28px -> 20px (compact float context; user asked for a smaller
     header). 20px = --fs-lg; never a raw px. */
  font-size: var(--fs-lg);
  font-weight: 700;
  color: var(--ink);
  line-height: var(--lh-tight);
  text-align: center;   /* AK-A13: top title horizontally centered */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* AK-A14: flip-to-login link centered under the title. S1 variant is a
   text-only underlined link (height:auto), so only centering + no-shrink
   matter here — no box sizing involved. */
.auth-shell__switch-login {
  flex: none;
  align-self: center;
}

.auth-shell__body {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);                          /* AK-A12: 16 -> 12 */
  min-width: 0;
  width: 100%;
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  /* AK-A2: horizontal centering anchor. Every auth field fills the column
     (--input-w:100% below) so this is a no-op today; it pins the centered
     contract for any future non-full-width child (e.g. narrower groups). */
  align-items: center;
}
/* AK-A2: unify every identity-auth field to the full content-column width.
   UiInput's intrinsic default --input-w:280px would leave plain inputs 280px
   left-aligned while the captcha row (100%) and the puzzle mismatch. Overriding
   --input-w to 100% here fills the column; the centered modal column yields
   symmetric whitespace automatically. Scoped to .auth-shell__body descendants. */
.auth-shell__body :deep(.ui-input) {
  --input-w: 100%;
  /* AK-A12: 44 -> 40 -> 36; AK-N-A1: 36 -> 32. Squish heights, never font sizes
     (principle 5 / user #12) — the 16px text + 20px line-height keep their size,
     only the vertical padding shrinks (6px top/bottom). Necessity: the register
     form carries a three-tier rhythm (AK-N-A1) that would otherwise push the
     375x667 modal past its viewport cap; the 4px-per-input reclaim funds it. */
  --input-h: 32px;
  --input-pad-y: 6px;   /* (32 - 20 lh) / 2, single-line vertical center */
}
/* captcha row must see the same --input-h so its send button resolves the
   compact capsule radius from --input-radius (inherited from .auth-shell) */
.auth-shell__body :deep(.ui-captcha) {
  --input-h: 32px;
}
/* buttons 52 -> 44 -> 40 -> 36 (>= 32px floor, readable 16px text); S/S1 text
   variants are height:auto, unaffected. AK-N-A1: 40 -> 36 to fund the rhythm. */
.auth-shell :deep(.ui-btn) {
  --btn-h: 36px;
}
/* AK-N-A1: the register-pane gap override was REMOVED — the register form now
   owns its three-tier rhythm (inline / group / section) in RegisterPane.vue. Keeping a
   flat shell-level gap here would fight that rhythm (specificity tie, source
   order fragile). Verify/login flows are unaffected: their OtpRow/PasswordRow
   keep the compact override below. */
.auth-shell__body :deep(.otp-row),
.auth-shell__body :deep(.password-row) { gap: var(--space-1); }    /* AK-A12: 12 -> 8; AK-L-F3: 8 -> 4 */
.auth-shell__body :deep(.captcha-puzzle__track) { margin-top: var(--space-1); } /* AK-A12: 12 -> 8; AK-L-F3: 8 -> 4 (verify/login only; register re-overrides in RegisterPane) */
.auth-shell__body :deep(.ui-checkbox) { --cb-h: 22px; }            /* AK-L-F3: 30 -> 24; AK-N-A1: 24 -> 22 (fund the rhythm; font stays --fs-sm 14px) */

.auth-shell__footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-3);
  min-width: 0;
  flex: none;           /* AK-A12: footer pinned, never scrolls away */
}
/* C5 "two wide buttons": cancel (footer-left) + confirm (footer-right) share the footer width equally */
.auth-shell__footer :deep(.ui-btn) {
  flex: 1 1 0;
  min-width: 0;
}
</style>
