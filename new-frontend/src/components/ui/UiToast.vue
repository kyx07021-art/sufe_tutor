<script setup>
import { toastState } from '@/composables/useToast'

/**
 * UiToast - Toast (singleton stack)
 * - Mounted once; showToast() pops one up, auto-dismiss by default.
 * - Minimal capsule: white background + thin border + shadow.
 */
</script>

<template>
  <Teleport to="body">
    <div class="ui-toast-stack" role="status" aria-live="polite">
      <TransitionGroup name="ui-toast">
        <div v-for="t in toastState.items" :key="t.id" class="ui-toast">
          {{ t.message }}
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.ui-toast-stack {
  position: fixed;
  left: 50%;
  bottom: 48px;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  z-index: 3000;
  pointer-events: none;
}

.ui-toast {
  box-sizing: border-box;
  max-width: 70vw;
  padding: var(--space-3) var(--space-5);
  background: var(--paper-raised);
  border: var(--border-w) solid var(--line);
  border-radius: var(--radius-pill);
  box-shadow: var(--shadow-float-sm);
  color: var(--ink);
  font-size: var(--fs-sm);
  line-height: 1.5;
  text-align: center;
}

.ui-toast-enter-active,
.ui-toast-leave-active {
  transition: opacity var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-out);
}
.ui-toast-enter-from,
.ui-toast-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
