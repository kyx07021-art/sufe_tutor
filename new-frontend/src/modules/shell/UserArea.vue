<script setup>
import { computed } from 'vue'
import { UiIcon } from '@/components/ui/index.js'
import { authStore } from './auth-store.js'
import { SHELL_COPY } from '@/constants/m-shell.js'

/**
 * UserArea - top bar user identity display (M2-03)
 * ------------------------------------------------
 * - Renders the current user's round avatar (real image when user.avatar is
 *   present, otherwise the user.svg placeholder), the black bold username
 *   (ellipsis past 10 chars, capped at 140px via CSS) and a fixed downward
 *   caret (arrow-down.svg) that never rotates.
 * - Purely presentational: hover reveal of the C4 dropdown is owned by the
 *   companion UserAreaDropdown (M2-04); this component binds no hover/click.
 * - Renders safely when authStore.user is null (falls back to an ellipsis name).
 * - aria-label from SHELL_COPY.USER_MENU_LABEL (single source); zero inline
 *   style/event attributes; comments English (contract 6).
 */

const user = computed(() => authStore.user)

const userName = computed(() => user.value?.username || '…')
</script>

<template>
  <button
    type="button"
    class="user-area"
    :aria-label="SHELL_COPY.USER_MENU_LABEL"
  >
    <img
      v-if="user?.avatar"
      class="user-area__avatar"
      :src="user.avatar"
      alt=""
    />
    <UiIcon
      v-else
      class="user-area__avatar user-area__avatar--placeholder"
      name="user"
      :size="32"
    />
    <span class="user-area__name">{{ userName }}</span>
    <UiIcon class="user-area__caret" name="arrow-down" :size="12" />
  </button>
</template>

<style scoped>
/* Reset button UA defaults so the user area reads as plain content. */
.user-area {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  font-size: var(--fs-base);
  line-height: var(--lh-body);
  color: var(--ink);
  cursor: default;
}

/* Round avatar: real image crops to a circle; placeholder icon shares geometry. */
.user-area__avatar {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-circle);
  object-fit: cover;
  flex: none;
}

.user-area__avatar--placeholder {
  color: var(--gray-50);
}

/* Black bold username, ellipsis past ~10 chars (capped at 140px). */
.user-area__name {
  max-width: 140px;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-weight: 700;
  color: var(--ink);
}

/* Fixed downward caret: static glyph, never rotates, no transition. */
.user-area__caret {
  width: 12px;
  height: 12px;
  color: var(--ink);
  flex: none;
}
</style>
