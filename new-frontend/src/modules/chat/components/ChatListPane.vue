<script setup>
/**
 * ChatListPane — C2.3 conversation list pane (M4-01 layout; M4-03 selection + ended-grayed; M4-05 unread wiring)
 * -----------------------------------------------------------------
 * - One B1-style card per conversation: round avatar + name (top) / last message
 *   (bottom, max 70% width ellipsis) + right-hand time (ended shows the fixed CLOSED_LABEL).
 * - Card click emits 'open' -> ChatPage -> openConversation, which marks the
 *   conversation read (M4-05 openFromCard local dot clear + I-22 server read cursor).
 * - M4-03 negative path: an ended (closed) card stays clickable to view read-only history
 *   (the send-gate lives in ChatConversationPane / state.isChatInputVisible), but it is
 *   visually grayed and never shows an unread red dot.
 */
import { computed } from 'vue'
import { chatState } from '../state.js'
import { CHAT_COPY } from '@/constants/ui.js'
import { formatListTime } from '../logic/timeFormat.js'
import UiIcon from '@/components/ui/UiIcon.vue'

const emit = defineEmits(['open'])

const items = computed(() => chatState.conversations)
const activeId = computed(() => chatState.activeConversationId)

/** Right-hand time slot: ended -> fixed CLOSED_LABEL; otherwise M4-04 formatListTime (today/yesterday/date). */
function timeLabelOf(c) {
  return c.status === 'closed' ? CHAT_COPY.CLOSED_LABEL : formatListTime(c.lastAt)
}

/** Red-dot visibility: an ended (read-only) conversation never shows an unread dot (M4-03 negative path). */
function showDot(c) {
  return c.status !== 'closed' && c.unread > 0
}

/** Card click: open the conversation (read-marking single point lives in
 *  openConversation -> markConversationRead). */
function onCardClick(c) {
  emit('open', c.conversationId)
}
</script>

<template>
  <aside class="chat-list" :aria-label="CHAT_COPY.LIST_ARIA_LABEL">
    <ul class="chat-list__cards">
      <li v-for="c in items" :key="c.conversationId">
        <button
          type="button"
          class="chat-card"
          :class="{ 'is-active': c.conversationId === activeId, 'is-closed': c.status === 'closed' }"
          @click="onCardClick(c)"
        >
          <span class="chat-card__avatar">
            <img v-if="c.avatar" :src="c.avatar" alt="" />
            <UiIcon v-else name="user" :size="18" />
          </span>
          <span class="chat-card__main">
            <span class="chat-card__name">{{ c.otherName }}</span>
            <span class="chat-card__preview">{{ c.lastMessage }}</span>
          </span>
          <span class="chat-card__meta">
            <span v-if="showDot(c)" class="chat-card__dot" aria-hidden="true"></span>
            <span class="chat-card__time">{{ timeLabelOf(c) }}</span>
          </span>
        </button>
      </li>
    </ul>
    <p v-if="!items.length" class="chat-list__empty">{{ CHAT_COPY.LIST_EMPTY }}</p>
  </aside>
</template>

<style scoped>
.chat-list {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.chat-list__cards {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-2) 0;
}

.chat-list__empty {
  padding: var(--space-5) var(--space-3);
  color: var(--gray-50);
  font-size: var(--fs-sm);
  text-align: center;
}

/* -- Conversation card (B1-style rounded rectangle, white fill; bottom divider is the straight part only) -- */
.chat-card {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  padding: var(--space-3) var(--space-4);
  background: var(--paper);
  border-bottom: var(--border-w) solid var(--gray-10);
  text-align: left;
  cursor: pointer;
  transition: background var(--dur-base) var(--ease-out);
}
.chat-card:hover { background: var(--gray-10); }
.chat-card.is-active { background: var(--gray-10); } /* selected: fill shifts to 10-degree gray (plan L399) */

/* Ended (closed): content grayed + avatar dimmed (M4-03); stays clickable to view read-only history. */
.chat-card.is-closed .chat-card__avatar { opacity: 0.6; }

.chat-card__avatar {
  flex: none;
  width: 44px;
  height: 44px;
  border-radius: var(--radius-circle);
  background: var(--gray-10);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--gray-50);
  overflow: hidden;
}

.chat-card__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.chat-card__name {
  font-size: var(--fs-base);
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.chat-card.is-closed .chat-card__name { color: var(--gray-50); } /* ended: name in gray (plan L407) */

.chat-card__preview {
  display: block;
  max-width: 70%; /* last message takes at most 70% of the card left side (plan L403) */
  font-size: var(--fs-sm);
  color: var(--gray-50);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chat-card__meta {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.chat-card__time {
  font-size: var(--fs-xs);
  color: var(--gray-50);
  white-space: nowrap;
}
.chat-card.is-closed .chat-card__time { color: var(--gray-50); }

.chat-card__dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: var(--radius-circle);
  background: var(--brand);
}
</style>
