<script setup>
import { computed } from 'vue'
import { UiCard, UiIcon } from '@/components/ui/index.js'
import { NOTIF_COPY } from '@/constants/m-notifications'
import { formatNotificationTime } from './data.js'

/**
 * NotificationCard - M5-02 notification card B1
 * -------------------------------------------------------
 * - Reuses M0 UiCard B1 base (review note 5) - no second card renderer.
 * - Left avatar: avatar_src 'system' -> logo, else -> user icon (I-26 carries no URL).
 * - Title (black, ellipsis, no wrap) + content (gray, ellipsis) + right time.
 * - Unread red dot sits left of the time; disappears when is_read.
 */
const props = defineProps({
  item: { type: Object, required: true },
})
const emit = defineEmits(['open'])

const isSystem = computed(() => props.item.avatar_src === 'system')
const timeText = computed(() => formatNotificationTime(props.item.created_at))
const avatarLabel = computed(() =>
  isSystem.value ? NOTIF_COPY.NOTIF_AVATAR_SYSTEM : NOTIF_COPY.NOTIF_AVATAR_USER,
)
</script>

<template>
  <UiCard variant="B1" class="nt-card" @click="emit('open')">
    <div class="nt-card__row">
      <div class="nt-card__avatar" :class="{ 'is-system': isSystem }" :aria-label="avatarLabel">
        <UiIcon :name="isSystem ? 'logo' : 'user'" :size="20" />
      </div>
      <div class="nt-card__main">
        <div class="nt-card__title">{{ item.title }}</div>
        <div class="nt-card__content">{{ item.content }}</div>
      </div>
      <div class="nt-card__side">
        <span v-if="!item.is_read" class="nt-card__dot" aria-label="unread"></span>
        <span class="nt-card__time">{{ timeText }}</span>
      </div>
    </div>
  </UiCard>
</template>

<style scoped>
.nt-card {
  border-radius: 0;
}
.nt-card__row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
}
.nt-card__avatar {
  flex: none;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--gray-10);
  color: var(--gray-70);
}
.nt-card__avatar.is-system {
  background: var(--brand-soft);
  color: var(--brand);
}
.nt-card__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.nt-card__title {
  font-size: var(--fs-base);
  font-weight: 600;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.nt-card__content {
  font-size: var(--fs-sm);
  color: var(--gray-60);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.nt-card__side {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.nt-card__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--danger);
  flex: none;
}
.nt-card__time {
  font-size: var(--fs-xs);
  color: var(--gray-50);
  white-space: nowrap;
}
</style>
