<script setup>
/**
 * ChatPage - C2 chat module page container (M4-01 double-column layout + M4-06b mobile pane switch)
 * -----------------------------------------------------------------
 * - Two columns: list pane 20% / conversation pane 80%, separated by a thin divider (plan L395).
 * - Mobile (<=600px): one pane at a time; tapping a conversation switches to the chat window
 *   (P22 negative case); the top-bar back button returns to the list.
 * - Route: registered via src/modules/chat/pages.js (shell/page-registry.js's
 *   import.meta.glob collects module pages.js; M2-08 in-memory history router, path /chat).
 */
import { computed, onMounted } from 'vue'
import ChatListPane from './components/ChatListPane.vue'
import ChatConversationPane from './components/ChatConversationPane.vue'
import { authStore } from '../shell/auth-store.js'
import { chatState, openConversation, loadConversations } from './state.js'

const paneClass = computed(() => (chatState.mobilePane === 'chat' ? 'chat--chat' : 'chat--list'))

// Page-entry assembly (F1): load the I-17 conversation list once on mount. The
// router gate runs before /chat mounts, so authStore.user is present in production;
// in the isolated test harness it is null and the list degrades silently to empty.
onMounted(() => {
  loadConversations(authStore.user)
})
</script>

<template>
  <main class="chat" :class="paneClass">
    <ChatListPane class="chat__list" @open="openConversation" />
    <ChatConversationPane class="chat__conv" />
  </main>
</template>

<style scoped>
/* =========== double-column layout (M4-01) =========== */
.chat {
  display: flex;
  width: 100%;
  height: 100vh; /* chat page fills the viewport; the page itself does not scroll */
  overflow: hidden;
  background: var(--paper);
  color: var(--ink);
}

.chat__list {
  flex: 0 0 20%; /* list pane = 20% of viewport width (plan L395) */
  min-width: 0;
  border-right: var(--border-w) solid var(--line); /* thin divider between panes */
  background: var(--paper); /* white fill */
  overflow-y: auto;
}

.chat__conv {
  flex: 1 1 80%; /* conversation pane = remaining 80% */
  min-width: 0;
  background: var(--gray-10); /* ten-degree gray fill (plan L395) */
}

/* =========== mobile pane switch (M4-06b): one pane at a time ===========
   tap conversation -> mobilePane='chat' -> chat window shown (P22 negative case);
   top-bar back button -> mobilePane='list' -> list shown. Desktop ignores. */
@media (max-width: 600px) {
  .chat__list {
    flex: 0 0 100%;
    border-right: none;
  }
  .chat__conv {
    flex: 1 1 100%;
  }
  .chat--chat .chat__list { display: none; }
  .chat--list .chat__conv { display: none; }
}
</style>
