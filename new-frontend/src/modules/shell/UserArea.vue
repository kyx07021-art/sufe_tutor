<script setup>
import { computed } from 'vue'
import { UiButton, UiIcon } from '@/components/ui/index.js'
import { authStore } from './auth-store.js'

/**
 * UserArea - top bar user identity display (M2-03)
 * ------------------------------------------------
 * - Renders the current user's round avatar (real image when user.avatar is
 *   present, otherwise the user.svg placeholder), the black bold username
 *   (ellipsis past 10 chars, capped at 140px via CSS) and a fixed downward
 *   caret (arrow-down.svg) that never rotates.
 * - AK-N-B2: the avatar carrier is a 40px round UiButton (variant B) so the
 *   placeholder person icon matches the envelope (NotifyButton) and chat-bubble
 *   (ChatButton) icons — same 20px glyph size, same ink color, same 40px round
 *   carrier, same gray-15 hover fill. The real avatar image stays a 40px circle.
 *   The button is a purely decorative carrier (aria-hidden + tabindex -1): the
 *   interactive trigger lives on the UserAreaDropdown wrapper (role="button").
 * - Purely presentational: the element is a plain div, not a button — it carries
 *   no click/hover and is not focusable. Hover reveal of the C4 dropdown and the
 *   keyboard activation contract live on the companion UserAreaDropdown wrapper
 *   (M2-04, role="button" + tabindex on the wrapper). A native <button> here was
 *   an ADR 0004 §1 "native element" violation: cursor:default + no click handler
 *   meant the button semantics were decorative only.
 * - Renders safely when authStore.user is null (falls back to an ellipsis name).
 * - The a11y label lives on the wrapper (UserAreaDropdown aria-label, single
 *   source SHELL_COPY.USER_MENU_LABEL); zero inline style/event attributes;
 *   comments English (contract 6).
 */

const user = computed(() => authStore.user)

const userName = computed(() => user.value?.username || '…')
</script>

<template>
  <div class="user-area">
    <UiButton
      variant="B"
      circle
      tabindex="-1"
      aria-hidden="true"
      class="user-area__avatar-btn"
    >
      <img
        v-if="user?.avatar"
        class="user-area__avatar-img"
        :src="user.avatar"
        alt=""
      />
      <UiIcon
        v-else
        class="user-area__avatar-placeholder"
        name="user"
        :size="20"
      />
    </UiButton>
    <span class="user-area__name">{{ userName }}</span>
    <UiIcon class="user-area__caret" name="arrow-down" :size="12" />
  </div>
</template>

<style scoped>
/* Presentational identity block: inline-flex layout, zero interactive affordance. */
.user-area {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0;
  font-size: var(--fs-base);
  line-height: var(--lh-body);
  color: var(--ink);
}

/* Avatar carrier = 40px round capsule button (B), the same carrier as the
   envelope / chat-bubble top-bar buttons (AK-N-B2). flex:none keeps the circle
   from shrinking; UiButton's own gray-15 hover fill + ripple provide the hover. */
.user-area__avatar-btn {
  --btn-w: 40px;
  --btn-h: 40px;
  --btn-pad: 0;
  flex: none;
}

/* Real avatar image: crops to the 40px circle of its carrier button. */
.user-area__avatar-img {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-circle);
  object-fit: cover;
  display: block;
}

/* Placeholder person icon: 20px ink glyph — same spec as the envelope / bubble
   icons (AK-N-B2). */
.user-area__avatar-placeholder {
  width: 20px;
  height: 20px;
  color: var(--ink);
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
