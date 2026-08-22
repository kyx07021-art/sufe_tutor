<script setup>
import { useRouter } from 'vue-router'
import { UiButton } from '@/components/ui/index.js'
import ChatBubbleSvg from '@/assets/svg/chat-bubble.svg'
import { pagesByRole } from './page-registry.js'
import { authStore } from './auth-store.js'
import { SHELL_COPY } from '@/constants/m-shell.js'

/**
 * ChatButton - Top bar conversations entry (M2-06)
 * -------------------------------------------------------
 * - UiButton variant "B" (bare short capsule, no fill/border) with the chat-bubble
 *   SVG as its inner content.
 * - Click resolves the C2 conversation page from the current role's registered pages
 *   by the interface-cap marker meta.c2 (M4's chat page carries it, path /chat).
 *   Navigates to the resolved page when found; stays inert otherwise.
 * - data-cap="M4.c2" marks the interface cap; meta.c2 on the chat page is its registry
 *   side, so the button and the page stay aligned by identifier, not a hardcoded path
 *   (a dead /conversations lookup left the button inert - PA-1h2-M2).
 * - aria-label sourced from SHELL_COPY.CHAT_LABEL (single source, no raw copy).
 * - Zero inline style/event attributes; comments English (contract 6).
 */

const router = useRouter()

function openConversations() {
  const target = pagesByRole(authStore.user?.role).find((p) => p.meta?.c2)
  if (target) router.push(target.path)
}
</script>

<template>
  <UiButton
    variant="B"
    data-cap="M4.c2"
    class="chat-btn"
    :aria-label="SHELL_COPY.CHAT_LABEL"
    @click="openConversations"
  >
    <ChatBubbleSvg class="chat-btn__svg" />
  </UiButton>
</template>

<style scoped>
/* Icon-only short capsule: fixed 40x40 hit area; zero side padding so the glyph owns
   the full content box (UiButton default --btn-pad = half-radius would squeeze it). */
.chat-btn {
  --btn-w: 40px;
  --btn-h: 40px;
  --btn-pad: 0;
}

/* Chat bubble glyph size. */
.chat-btn__svg {
  width: 20px;
  height: 20px;
}
</style>
