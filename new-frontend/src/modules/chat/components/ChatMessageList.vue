<script setup>
/**
 * ChatMessageList - C2 conversation message list (M4-07, cursor load + render)
 * ----------------------------------------------------------------------------
 * Presentational container wired by the module lead into the conversation pane
 * scroll area. Renders messages newest-at-bottom (normal order; the parent owns
 * scroll-to-bottom), dispatches each row to the sibling bubble component that
 * matches `kind`, and exposes a "load earlier" affordance for the I-18 sinceId
 * cursor paging (M4-07 "recent N tail, no loss window").
 *
 * Props:
 *   messages      (Array)  normalized rows (oldest first).
 *   loading       (Boolean) initial-page loading flag.
 *   hasMore       (Boolean) whether an earlier page is loadable.
 *   currentUserId (Number)  the signed-in user id; `mine = sender === this`.
 * Emits:
 *   load-more  -> request the earlier page (cursor advance owned by parent).
 *
 * Dispatch: kind 'text' -> ChatBubble, 'image' -> ChatImageBubble,
 * 'file' -> ChatFileBubble; 'contract' and any unknown kind fall back to
 * ChatSpecialBubble (I-18 kind set + defensive fallback).
 *
 * Contract 6: zero raw Chinese in template/scoped CSS/comments, zero inline
 * event/style HTML attrs (Vue @click is fine), zero v-html, zero <style>
 * injection; JS only toggles classes.
 */
import { CHAT_COPY } from '@/constants/ui.js'
import UiButton from '@/components/ui/UiButton.vue'
import ChatBubble from './ChatBubble.vue'
import ChatImageBubble from './ChatImageBubble.vue'
import ChatFileBubble from './ChatFileBubble.vue'
import ChatSpecialBubble from './ChatSpecialBubble.vue'

const emit = defineEmits(['load-more'])

const props = defineProps({
  messages: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  hasMore: { type: Boolean, default: false },
  currentUserId: { type: Number, default: null },
})

/** True when the row was sent by the signed-in user. */
function isMine(m) {
  return m != null && m.sender_user_id === props.currentUserId
}
</script>

<template>
  <div class="chat-msg-list">
    <UiButton
      v-if="hasMore"
      variant="S1"
      class="chat-msg-list__more"
      @click="emit('load-more')"
    >
      {{ CHAT_COPY.LOAD_MORE }}
    </UiButton>

    <p v-if="loading && !messages.length" class="chat-msg-list__loading">
      {{ CHAT_COPY.MESSAGES_LOADING }}
    </p>

    <ul class="chat-msg-list__items">
      <li v-for="m in messages" :key="m.id" class="chat-msg-list__item">
        <ChatBubble v-if="m.kind === 'text'" :message="m" :mine="isMine(m)" />
        <ChatImageBubble v-else-if="m.kind === 'image'" :message="m" :mine="isMine(m)" />
        <ChatFileBubble v-else-if="m.kind === 'file'" :message="m" :mine="isMine(m)" />
        <ChatSpecialBubble v-else :message="m" />
      </li>
    </ul>
  </div>
</template>

<style scoped>
.chat-msg-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.chat-msg-list__items {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.chat-msg-list__item {
  display: flex;
  flex-direction: column;
}

.chat-msg-list__more {
  align-self: center;
}

.chat-msg-list__loading {
  padding: var(--space-6) var(--space-4);
  text-align: center;
  color: var(--gray-50);
  font-size: var(--fs-sm);
}
</style>
