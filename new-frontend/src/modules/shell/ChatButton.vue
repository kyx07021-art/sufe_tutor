<script setup>
import { useRouter } from 'vue-router'
import { UiButton } from '@/components/ui/index.js'
import ChatBubbleSvg from '@/assets/svg/chat-bubble.svg'
import { getPageByPath, pagesByRole } from './page-registry.js'
import { authStore } from './auth-store.js'
import { SHELL_COPY } from '@/constants/m-shell.js'

/**
 * ChatButton - Top bar conversations entry (M2-06)
 * -------------------------------------------------------
 * - UiButton variant "B" (bare short capsule, no fill/border) with the chat-bubble
 *   SVG as its inner content.
 * - Click resolves the C2 conversations page: first by exact path '/conversations',
 *   falling back to the current role's pages matching name 'conversations' or
 *   meta.c2. Navigates to the resolved page when found; stays inert otherwise.
 * - data-cap="M4.c2" marks the interface cap waiting for the M4 conversation page
 *   registration (no navigation until that page exists).
 * - aria-label sourced from SHELL_COPY.CHAT_LABEL (single source, no raw copy).
 * - Zero inline style/event attributes; comments English (contract 6).
 */

const router = useRouter()

function openConversations() {
  const target =
    getPageByPath('/conversations') ||
    pagesByRole(authStore.user?.role).find((p) => p.name === 'conversations' || p.meta?.c2)
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
