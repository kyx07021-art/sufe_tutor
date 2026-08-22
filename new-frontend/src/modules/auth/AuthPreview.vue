<script setup>
/**
 * AuthPreview - M6 dev-only test surface (served from /preview/auth.html)
 * -------------------------------------------------------
 * - Lets the smoke test drive the assembled AuthModal: pick a scene
 *   (verify / login / register), toggle contactMasks, read the resolved default
 *   auth method from the state machine (M6-3), and open the modal.
 * - Self-contained: renders AuthHost + UiToast so the standalone static harness
 *   (/preview/auth.html) can show the modal without the app shell.
 * - Dev-only labels are English; user-visible copy still flows from AUTH_COPY.
 */
import { computed, ref } from 'vue'
import { UiButton, UiCheckButton, UiToast } from '@/components/ui/index.js'
import AuthHost from './AuthHost.vue'
import { openIdentityAuth } from './authState.js'
import { AUTH_SCENES, defaultMethod, availableMethods } from './authMethod.js'
import { AUTH_COPY } from '@/constants/m-auth.js'

const scene = ref(AUTH_SCENES.VERIFY)
const maskPhone = ref(true)
const maskEmail = ref(true)
/** blocked-path probe: a click-counter button behind the modal overlay */
const behindCount = ref(0)

const masks = computed(() => ({ phone: maskPhone.value, email: maskEmail.value }))
const defaultNow = computed(() => defaultMethod(scene.value, masks.value))
const availableNow = computed(() => availableMethods(scene.value, masks.value))
const methodTitle = (m) => AUTH_COPY.METHOD_TITLE[m] || m
const scenes = [AUTH_SCENES.VERIFY, AUTH_SCENES.LOGIN, AUTH_SCENES.REGISTER]

function open() {
  openIdentityAuth({ scene: scene.value, contactMasks: masks.value })
}
</script>

<template>
  <div class="auth-preview">
    <h1 class="auth-preview__title">M6 C5 Identity Auth · Review</h1>

    <section class="auth-preview__sec">
      <div class="auth-preview__row">
        <UiButton variant="B" @click="behindCount++">behind click count: {{ behindCount }}</UiButton>
      </div>
    </section>

    <section class="auth-preview__sec">
      <h2 class="auth-preview__h">Scene</h2>
      <div class="auth-preview__row">
        <UiButton
          v-for="s in scenes"
          :key="s"
          variant="B"
          :class="{ 'is-active': scene === s }"
          @click="scene = s"
        >{{ s }}</UiButton>
      </div>
    </section>

    <section class="auth-preview__sec">
      <h2 class="auth-preview__h">contactMasks (I-05)</h2>
      <div class="auth-preview__row">
        <UiCheckButton v-model="maskPhone" variant="B" label="phone" />
        <UiCheckButton v-model="maskEmail" variant="B" label="email" />
      </div>
      <p class="auth-preview__note">
        default method: <strong>{{ methodTitle(defaultNow) }}</strong>
        &nbsp;·&nbsp; available: {{ availableNow.map(methodTitle).join(' / ') }}
      </p>
    </section>

    <section class="auth-preview__sec">
      <div class="auth-preview__row">
        <UiButton fill="brand" @click="open">Open identity auth</UiButton>
      </div>
    </section>

    <AuthHost />
    <UiToast />
  </div>
</template>

<style scoped>
.auth-preview {
  max-width: 640px;
  margin: 0 auto;
  padding: 48px 24px 120px;
}
.auth-preview__title { font-size: var(--fs-xl); font-weight: 700; }
.auth-preview__sec { margin-top: var(--space-6); }
.auth-preview__h {
  font-size: var(--fs-base);
  font-weight: 600;
  padding-bottom: var(--space-2);
  margin-bottom: var(--space-3);
  border-bottom: var(--border-w) solid var(--line);
}
.auth-preview__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
}
.auth-preview__row .is-active { color: var(--brand); }
.auth-preview__note { margin-top: var(--space-3); color: var(--gray-60); font-size: var(--fs-sm); }
</style>
