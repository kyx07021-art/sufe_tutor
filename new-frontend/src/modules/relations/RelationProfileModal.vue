<script setup>
/**
 * RelationProfileModal - M3 peer profile modal (PA-1h2-M1 open-profile wiring)
 * -------------------------------------------------------
 * - Renders the other party's minimal profile from the M3 node model
 *   ({ userId, role, name, avatar, edges }): avatar ring, name, role label and
 *   an "open chat" button that jumps into the matching conversation.
 * - The "open chat" entry re-emits `open-conversation` with the node's primary
 *   (first active) conversation id; the page routes it through the chat store +
 *   router (openRelationConversation).
 * - Built on UiModalA1 (M0 modal A1): X / outside / Esc close all surface as
 *   `update:open(false)` to the page. This modal has no own copy beyond the
 *   module single source (m-relations.js).
 * - Contract 6: zero raw Chinese (copy from m-relations.js), zero inline
 *   event/style literals, zero raw-HTML interpolation.
 */
import { computed } from 'vue'
import { UiButton, UiIcon } from '@/components/ui/index.js'
import { RELATIONS_COPY } from '@/constants/m-relations.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  /** M3-01 node for the other party (null when closed). */
  peer: { type: Object, default: null },
})

const emit = defineEmits(['update:open', 'open-conversation'])

const COPY = RELATIONS_COPY

/** Role display label from the node role (display mapping, module copy source). */
const roleLabel = computed(() => {
  if (!props.peer) return ''
  return props.peer.role === 'teacher' ? COPY.ROLE_TEACHER : COPY.ROLE_STUDENT
})

/** Primary conversation for this peer: first active edge, else the first edge. */
const primaryConversationId = computed(() => {
  const edges = props.peer && props.peer.edges
  if (!edges || !edges.length) return null
  const active = edges.find((e) => e.status === 'active')
  return (active || edges[0]).conversationId
})

/** Close via UiModalA1's own X / outside / Esc channel. */
function onUpdateOpen(v) {
  emit('update:open', v)
}

/** "Open chat": jump into the peer's conversation, then close the modal. */
function onOpenChat() {
  const id = primaryConversationId.value
  if (id == null) return
  emit('open-conversation', { conversationId: id })
  emit('update:open', false)
}
</script>

<template>
  <UiModalA1 :open="open" :title="COPY.PROFILE_TITLE" width="360px" @update:open="onUpdateOpen">
    <div v-if="peer" class="rel-profile">
      <div class="rel-profile__avatar">
        <img v-if="peer.avatar" class="rel-profile__avatar-img" :src="peer.avatar" alt="" />
        <span v-else class="rel-profile__avatar-fallback" aria-hidden="true">
          <UiIcon class="rel-profile__avatar-icon" name="user" />
        </span>
      </div>
      <p class="rel-profile__name">{{ peer.name }}</p>
      <p class="rel-profile__role">{{ roleLabel }}</p>
      <UiButton
        v-if="primaryConversationId != null"
        variant="C1"
        width="180px"
        class="rel-profile__chat"
        @click="onOpenChat"
      >
        {{ COPY.OPEN_CHAT }}
      </UiButton>
    </div>
  </UiModalA1>
</template>

<style scoped>
.rel-profile {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-5) var(--space-6) var(--space-6);
  box-sizing: border-box;
}

.rel-profile__avatar {
  width: 96px;
  max-width: 100%;
  min-width: 0;
}

.rel-profile__avatar-img {
  display: block;
  width: 100%;
  aspect-ratio: 1;
  height: auto;
  border-radius: var(--radius-circle);
  object-fit: cover;
}

/* Neutral circle fallback: gray-10 disc with a gray-70 user glyph. */
.rel-profile__avatar-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  aspect-ratio: 1;
  border-radius: var(--radius-circle);
  background: var(--gray-10);
  color: var(--gray-70);
}

.rel-profile__avatar-icon {
  width: 45%;
  height: 45%;
}

.rel-profile__name {
  margin: var(--space-2) 0 0;
  font-size: var(--fs-lg);
  font-weight: 600;
  line-height: var(--lh-tight);
  color: var(--ink);
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

.rel-profile__role {
  margin: 0;
  font-size: var(--fs-sm);
  color: var(--gray-60);
  text-align: center;
}

.rel-profile__chat {
  margin-top: var(--space-3);
}
</style>
