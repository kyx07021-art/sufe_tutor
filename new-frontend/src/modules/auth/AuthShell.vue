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
import { UiModal, UiButton } from '@/components/ui/index.js'
import { AUTH_COPY } from '@/constants/m-auth.js'
import { UI_COPY } from '@/constants/ui.js'

defineProps({
  open: { type: Boolean, default: false },
  /** scene id is passed through (not consumed here) for future shell variants */
  scene: { type: String, default: 'login' },
  /** contactMasks passed through (not consumed here) */
  contactMasks: { type: Object, default: () => ({}) },
  closeOnOutside: { type: Boolean, default: true },
})

const emit = defineEmits(['close', 'update:open'])

function close() {
  emit('close')
  emit('update:open', false)
}
</script>

<template>
  <UiModal
    :open="open"
    :label="AUTH_COPY.TITLE"
    width="440px"
    :close-on-outside="closeOnOutside"
    @close="close"
  >
    <div class="auth-shell">
      <h2 class="auth-shell__title">{{ AUTH_COPY.TITLE }}</h2>
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
  gap: var(--space-5);
  width: 100%;
  min-width: 0;
  max-width: 100%;
  padding: var(--space-6) var(--space-5) var(--space-5);
}

.auth-shell__title {
  font-size: var(--fs-xl);
  font-weight: 700;
  color: var(--ink);
  line-height: var(--lh-tight);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.auth-shell__body {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
  width: 100%;
}

.auth-shell__footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-3);
  min-width: 0;
}
/* C5 "two wide buttons": cancel (footer-left) + confirm (footer-right) share the footer width equally */
.auth-shell__footer :deep(.ui-btn) {
  flex: 1 1 0;
  min-width: 0;
}
</style>
