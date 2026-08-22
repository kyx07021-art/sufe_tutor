<script setup>
import { ref } from 'vue'
import { UiButton, UiToast } from '@/components/ui/index.js'
import { M5Host, openC3, openC4 } from '@/modules/notifications/index.js'
import { setAuth, clearAuth, persistAuth } from '@/modules/shell/auth-store.js'
import { NOTIF_COPY } from '@/constants/m-notifications'

// Dev-only M5 preview harness (not user-facing; real copy lives in constants).
// Auth is driven by the real M2 authStore (setAuth/persistAuth) - no module-local
// authed boolean. The smoke test toggles this to gate the blocked paths.
const authed = ref(false)
const moreBtn = ref(null)

function toggleAuth() {
  authed.value = !authed.value
  if (authed.value) {
    const auth = { token: 'preview-token', user: { id: 1, role: 'student', username: 'preview' } }
    setAuth(auth)
    persistAuth({ ...auth, remember: false })
  } else {
    clearAuth()
  }
}
function summonMore() {
  openC4(moreBtn.value ? moreBtn.value.el : null)
}
</script>

<template>
  <div class="m5-pv">
    <h1 class="m5-pv__title">M5 preview - C3 notifications + C4 more</h1>
    <p class="m5-pv__note">dev harness only; copy lives in constants/m-notifications.js</p>
    <div class="m5-pv__bar">
      <UiButton ref="moreBtn" variant="B" class="m5pv__more" @click="summonMore">
        {{ NOTIF_COPY.MORE_LABEL }}
      </UiButton>
      <UiButton variant="B" class="m5pv__notif" @click="openC3">
        {{ NOTIF_COPY.NOTIF_TITLE }}
      </UiButton>
      <UiButton variant="B" class="m5pv__auth" @click="toggleAuth">
        {{ authed ? 'authed' : 'guest' }}
      </UiButton>
    </div>
    <M5Host />
    <UiToast />
  </div>
</template>

<style scoped>
.m5-pv {
  padding: var(--space-6) var(--space-8);
}
.m5-pv__title {
  font-size: var(--fs-xl);
  font-weight: 600;
}
.m5-pv__note {
  color: var(--gray-50);
  font-size: var(--fs-sm);
  margin-top: var(--space-2);
}
.m5-pv__bar {
  display: flex;
  gap: var(--space-3);
  margin-top: var(--space-6);
}
</style>
