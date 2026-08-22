<script setup>
import { UiButton } from '@/components/ui/index.js'
import { NOTIF_COPY } from '@/constants/m-notifications'
import { formatNotificationTime } from './data.js'

/**
 * NotificationDetail - M5-05 notification detail view + list/detail slide
 * -------------------------------------------------------
 * - Renders the full body of a single notification inside the C3 modal. The
 *   detail slides in from the right while the list slides out to the left, all
 *   clipped by the modal body (overflow hidden).
 * - This detail's own top bar carries only the back button; the X close belongs
 *   to the outer UiModalA1 (the modal's top bar stays the same).
 * - title / content are server text (data, not hardcoded copy); every static
 *   string comes from NOTIF_COPY (contract 6).
 * - Self-contained enter/leave animation via <Transition name="nt-detail"> on
 *   the root; prefers-reduced-motion squeezes it to none.
 * - Zero inline style attributes / v-html / runtime <style> injection.
 */
defineProps({
  item: { type: Object, required: true },
})
const emit = defineEmits(['back', 'close'])
</script>

<template>
  <Transition name="nt-detail">
    <div class="nt-detail">
      <div class="nt-detail__bar">
        <UiButton variant="B1" arrow="left" @click="emit('back')">
          {{ NOTIF_COPY.NOTIF_BACK }}
        </UiButton>
      </div>
      <div class="nt-detail__body">
        <h3 class="nt-detail__title">{{ item.title }}</h3>
        <time class="nt-detail__time" :datetime="item.created_at">
          {{ formatNotificationTime(item.created_at) }}
        </time>
        <p class="nt-detail__content">{{ item.content }}</p>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.nt-detail {
  box-sizing: border-box;
}

.nt-detail__bar {
  display: flex;
  align-items: center;
  flex: none;
  padding: var(--space-3) var(--space-5) 0;
}

.nt-detail__body {
  padding: var(--space-5);
}

.nt-detail__title {
  font-size: var(--fs-lg);
  font-weight: 600;
  color: var(--ink);
  overflow-wrap: break-word;
}

.nt-detail__time {
  display: block;
  margin-top: var(--space-2);
  font-size: var(--fs-sm);
  color: var(--gray-60);
}

.nt-detail__content {
  margin-top: var(--space-4);
  font-size: var(--fs-base);
  color: var(--ink);
  line-height: var(--lh-body);
  white-space: normal;
  overflow-wrap: break-word;
}

/* Slide in from the right on enter, out to the left on leave (clipped by parent). */
.nt-detail-enter-active,
.nt-detail-leave-active {
  transition:
    opacity var(--dur-base) var(--ease-out),
    transform var(--dur-base) var(--ease-out);
}
.nt-detail-enter-from {
  opacity: 0;
  transform: translateX(40px);
}
.nt-detail-leave-to {
  opacity: 0;
  transform: translateX(-40px);
}

/* prefers-reduced-motion: no slide, instant state switch. */
@media (prefers-reduced-motion: reduce) {
  .nt-detail-enter-active,
  .nt-detail-leave-active {
    transition: none;
  }
  .nt-detail-enter-from,
  .nt-detail-leave-to {
    transform: none;
  }
}
</style>
