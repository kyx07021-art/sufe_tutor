<script setup>
/**
 * SettingsDeactivate - M5-12 account deactivation (I-14, capToken + F7)
 * -------------------------------------------------------
 * - Settings section content for account deactivation. No props / no emits by design.
 * - Renders the deactivate warning + a danger button (M0 A variant, danger fill).
 *   Clicking the danger button opens a UiConfirmModalA1 with the same warning text.
 * - The real deactivate flow requires a capToken (I-14 POST /api/settings/deactivate)
 *   which M6 identity-auth issues and is NOT built yet. So the confirm's final action
 *   is an honest data-cap placeholder: it only toasts CAP_TOAST and never calls the API.
 * - F7 anchor (for when the flow IS wired): after a real deactivate the module must
 *   call clearAuth() (auth-store) and clear local state; the assembly handles
 *   routing. Today the cap only toasts, so this handler does not touch auth state.
 */
import { ref } from 'vue'
import { UiButton, UiConfirmModalA1 } from '@/components/ui/index.js'
import { showToast } from '@/composables/useToast'
import { NOTIF_COPY } from '@/constants/m-notifications'

const confirmOpen = ref(false)

function onOpenConfirm() {
  confirmOpen.value = true
}

function onConfirm() {
  // cap placeholder: the capToken flow (I-14) belongs to M6 and is not built, so the
  // API is never called here. F7 anchor: once wired, a real deactivate must call
  // clearAuth() (auth-store) and clear local state (the assembly handles routing).
  showToast(NOTIF_COPY.CAP_TOAST)
}
</script>

<template>
  <div class="sd-deactivate" data-cap="m5-12-deactivate">
    <p class="sd-deactivate__warn">{{ NOTIF_COPY.SETTINGS_DEACTIVATE_WARN }}</p>
    <UiButton variant="A" fill="danger" class="sd-deactivate__btn" @click="onOpenConfirm">
      {{ NOTIF_COPY.SETTINGS_DEACTIVATE_CONFIRM }}
    </UiButton>

    <UiConfirmModalA1
      v-model:open="confirmOpen"
      :title="NOTIF_COPY.SETTINGS_DEACTIVATE"
      :confirm-text="NOTIF_COPY.SETTINGS_DEACTIVATE_CONFIRM"
      :cancel-text="NOTIF_COPY.SETTINGS_DEACTIVATE_CANCEL"
      @confirm="onConfirm"
    >
      <p class="sd-deactivate__warn">{{ NOTIF_COPY.SETTINGS_DEACTIVATE_WARN }}</p>
    </UiConfirmModalA1>
  </div>
</template>

<style scoped>
/* settings row stacks with spacing only - no dividers between elements (flat settings design) */
.sd-deactivate {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  box-sizing: border-box;
}
.sd-deactivate__warn {
  color: var(--gray-50);
  font-size: var(--fs-sm);
  line-height: var(--lh-body);
}
.sd-deactivate__btn {
  --btn-w: 160px;
  --btn-h: 44px;
  --btn-fs: var(--fs-base);
}
</style>
