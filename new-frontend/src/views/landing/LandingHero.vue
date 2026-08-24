<script setup>
/**
 * LandingHero - M1 hero zone (M1-03)
 * -------------------------------------------------------------
 * - 75vh zone (--landing-hero-h), content group centered slightly above the
 *   middle (pure padding-bottom, never transform - M1-11 owns transforms).
 * - One black display headline, centered.
 * - Two large A1 buttons below-left / below-right; their combined width equals
 *   the headline width (single-column `minmax(0,max-content)` grid, buttons
 *   split the actions track 1fr/1fr).
 * - CTA wiring (PA-1h1-F1 + AK-B1): the two hero CTAs are THE client entry —
 *   an unauthenticated visitor opens the identity-auth overlay (register scene,
 *   the user picks the role; the register pane carries the flip-to-login switch
 *   so returning users reach the login scene from the modal), a logged-in
 *   visitor routes to the CTA role's default page (the router guard fail-closes
 *   a role mismatch to the user's own role default). No standalone login link
 *   lives on the hero (AK-B1: the CTAs own the entry; login is inside the modal).
 */
import { useRouter } from 'vue-router'
import UiButton from '@/components/ui/UiButton.vue'
import { LANDING_COPY } from '@/constants/m-landing.js'
import { authStore } from '@/modules/shell/auth-store.js'
import { defaultPageForRole } from '@/modules/shell/page-registry.js'
import { getIface } from '@/modules/shell/ifaces.js'

const router = useRouter()

function onEnter(role) {
  if (authStore.token) {
    const def = defaultPageForRole(role)
    if (def) router.push(def)
    return
  }
  const open = getIface('openIdentityAuth')
  if (open) {
    open({
      mode: 'register',
      // AK-L-F1: finishSuccess() fires onVerified once the modal closes — route
      // straight into the client so a fresh login/register doesn't leave the user
      // stranded on the hero needing a second CTA click. Role comes from the real
      // authenticated user (register lets them pick their own role).
      onVerified: () => {
        const def = defaultPageForRole(authStore.user?.role)
        if (def) router.push(def)
      },
    })
  }
}
</script>

<template>
  <section class="landing-hero" data-reveal aria-label="hero">
    <h1 class="landing-hero__title">{{ LANDING_COPY.HERO_TITLE }}</h1>
    <div class="landing-hero__actions">
      <UiButton
        variant="A1"
        size="lg"
        class="landing-hero__btn"
        data-cap="enter.student"
        @click="onEnter('student')"
        >{{ LANDING_COPY.HERO_CTO_STUDENT }}</UiButton
      >
      <UiButton
        variant="A1"
        size="lg"
        class="landing-hero__btn"
        data-cap="enter.teacher"
        @click="onEnter('teacher')"
        >{{ LANDING_COPY.HERO_CTO_TEACHER }}</UiButton
      >
    </div>
  </section>
</template>

<style scoped>
.landing-hero {
  min-height: var(--landing-hero-h);
  display: grid;
  grid-template-columns: minmax(0, max-content); /* column = widest child (the headline) */
  justify-content: center;
  align-content: center;
  justify-items: stretch; /* children fill the column by default (headline centers itself) */
  padding-bottom: clamp(0px, 8vh, 120px); /* bottom padding > top => content sits slightly above center */
  box-sizing: border-box;
  text-align: center;
}

.landing-hero__title {
  justify-self: center;
  font-size: var(--fs-display);
  font-weight: 700;
  letter-spacing: 0.04em;
  line-height: 1.15;
  white-space: nowrap; /* one black display line on desktop (wraps on mobile) */
  color: var(--ink);
}

.landing-hero__actions {
  display: grid;
  grid-template-columns: 1fr 1fr; /* two buttons split evenly => total width = headline width */
  gap: var(--space-4);
  margin-top: clamp(40px, 6vh, 64px);
}

.landing-hero__btn {
  width: 100%; /* fill each actions track (capsule shape kept) */
  font-weight: 700;
}

/* Narrow screens: column = container width, headline may wrap, buttons stack */
@media (max-width: 768px) {
  .landing-hero {
    grid-template-columns: minmax(0, 100%);
  }
  .landing-hero__title {
    font-size: clamp(28px, 7vw, 40px);
    white-space: normal;
  }
  .landing-hero__actions {
    grid-template-columns: 1fr;
    justify-self: center;
    max-width: 280px;
  }
}
</style>
