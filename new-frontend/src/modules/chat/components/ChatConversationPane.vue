<script setup>
/**
 * ChatConversationPane - C2 conversation pane (module-lead assembly layer)
 * -----------------------------------------------------------------
 * - Layout (M4-01/02/06a): in-pane top bar / message scroll area / input slot; the
 *   top fade mask is pointer-events:none.
 * - Ended read-only gate (M4-06c): isChatInputVisible single point decides the input slot.
 * - Assembly (M4-07/08/10/11/15/17-23/24/25/30/32): ChatTopBar + ChatMessageList
 *   (dispatches ChatBubble/Image/File/SpecialBubble) + ChatHintText (temp hints) +
 *   ChatInputBar (send / attachments) + ChatEndConfirmModal (end-session confirm).
 * - Polling (M4-32) starts on mount and stops on unmount (F3); the end-session gate
 *   (M4-25) grays out the "End Session" entry when the I-15 relation carries a contract.
 * - Backend-pending surfaces carry an honest data-cap: the end-session write obtains
 *   its capToken through the M6 identity-auth flow (openEndSessionVerify) and the
 *   attachment stage pipeline POSTs the staged file to S2 /api/uploads (real
 *   uploader); the attachment SEND entry itself is still capped (ATTACH_CAP toast).
 * - Contract 6: zero Chinese, zero inline event/style attributes, zero v-html,
 *   zero <style> injection.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  chatState,
  backToList,
  isChatInputVisible,
  isEndSessionBusy,
  loadRelations,
  loadMessages,
  sendText,
  closeConversation,
  startActivePolling,
  stopActivePolling,
} from '../state.js'
import { api } from '@/core/api.js'
import { CHAT_COPY } from '@/constants/ui.js'
import { showToast } from '@/composables/useToast.js'
import { useScrollFade } from '@/composables/useScrollFade'
import { deriveTempHint } from '../logic/tempConversation.js'
import { canEnd } from '../logic/endSession.js'
import { stageAttachment, createRealUploader, CancelledError } from '../logic/upload.js'
import ChatTopBar from './ChatTopBar.vue'
import ChatMessageList from './ChatMessageList.vue'
import ChatHintText from './ChatHintText.vue'
import ChatInputBar from './ChatInputBar.vue'
import ChatEndConfirmModal from './ChatEndConfirmModal.vue'

const scrollEl = ref(null)
const { scrollable, atTop, update } = useScrollFade(scrollEl)

const conv = computed(
  () => chatState.conversations.find((c) => c.conversationId === chatState.activeConversationId) ?? null,
)
const peerName = computed(() => conv.value?.otherName ?? '')
const isEnded = computed(() => !!conv.value && conv.value.status === 'closed')
const inputVisible = computed(() => isChatInputVisible())
const showMask = computed(() => !!scrollable.value && !atTop.value)

/* ---- message assembly (M4-07) ---- */
const messages = computed(() => chatState.messages[chatState.activeConversationId] || [])
const loading = computed(() => !!chatState.messagesLoading[chatState.activeConversationId])
const hasMore = computed(() => !!chatState.hasMore[chatState.activeConversationId])
const currentUserId = computed(() => chatState.currentUserId)

/* ---- temp conversation hint (M4-26/28/29) ---- */
const tempHint = computed(() => {
  const c = conv.value
  if (!c) return ''
  const key = deriveTempHint(c)
  if (!key) return ''
  return (
    {
      init: CHAT_COPY.TEMP_HINT_INIT,
      sent: CHAT_COPY.TEMP_HINT_SENT,
      formal: CHAT_COPY.TEMP_HINT_FORMAL,
      received: CHAT_COPY.TEMP_HINT_RECEIVED,
    }[key] || ''
  )
})

/* ---- end-session gate (M4-25): I-15 relation has a contract -> gray out; when no
   relation is loaded, derive from the conversation row (no contract). ---- */
const relationForActive = computed(() => {
  const c = conv.value
  if (!c) return null
  const rel = chatState.relations.find((r) => r.conversationId === chatState.activeConversationId)
  if (rel) return rel
  return { conversationId: c.conversationId, status: c.status, tempStatus: c.tempStatus ?? null, signing: null }
})
const canEndActive = computed(() => canEnd(relationForActive.value))

/* ---- end-session confirm modal (M4-24/25) ---- */
const endModalOpen = ref(false)
const endBusy = computed(() => isEndSessionBusy(chatState.activeConversationId))
function openEndModal() {
  endModalOpen.value = true
}
function onCancelEnd() {
    endModalOpen.value = false
}
async function onConfirmEnd() {
  if (endBusy.value) return
  const ok = await closeConversation(chatState.activeConversationId)
  if (ok) endModalOpen.value = false
}

/* ---- send (M4-30) ---- */
const sendingActive = computed(() => !!chatState.sending[chatState.activeConversationId])
function onSend(text) {
  sendText(chatState.activeConversationId, text)
  scrollToBottom()
}

/* ---- attachments (M4-14/21): real S2 uploader wired; the SEND entry stays capped
   (ATTACH_CAP toast) until the attach-and-send UI lands. ---- */
const realUploader = createRealUploader(api)
function onAttach(file) {
  const task = stageAttachment(file, { onProgress: () => {}, uploader: realUploader })
  task.promise
    .then(() => showToast(CHAT_COPY.ATTACH_CAP))
    .catch((err) => {
      // E1: a failed stage is never silent. A user-initiated cancel stays quiet.
      if (err instanceof CancelledError) return
      showToast(CHAT_COPY.UPLOAD_FAILED)
    })
}

/* ---- scrolling (chat stick-to-bottom convention) ---- */
function nearBottom() {
  const el = scrollEl.value
  if (!el) return true
  return el.scrollHeight - el.scrollTop - el.clientHeight < 80
}
function scrollToBottom() {
  const el = scrollEl.value
  if (el) el.scrollTop = el.scrollHeight
}

/* ---- mobile pane switch (M4-06b): back button visibility ---- */
const isMobile = ref(false)
let mql = null
function syncMobile() {
  isMobile.value = mql ? mql.matches : false
}

watch(messages, () => {
  if (nearBottom()) scrollToBottom()
})

/* switch conversation: scroll to top + re-measure the fade mask */
watch(
  () => chatState.activeConversationId,
  async () => {
    await nextTick()
    if (scrollEl.value) scrollEl.value.scrollTop = 0
    update()
    if (nearBottom()) scrollToBottom()
  },
)

onMounted(() => {
  loadRelations()
  // The conversation list (I-17) loads asynchronously after the panes mount
  // (ChatPage.onMounted -> loadConversations); skip a message load for a not-yet
  // known conversation to avoid a spurious /conversations/null/messages 404.
  if (chatState.activeConversationId != null) loadMessages(chatState.activeConversationId)
  startActivePolling()
  mql = window.matchMedia('(max-width: 600px)')
  syncMobile()
  if (mql.addEventListener) mql.addEventListener('change', syncMobile)
  else if (mql.addListener) mql.addListener(syncMobile)
})

onBeforeUnmount(() => {
  stopActivePolling()
  if (mql) {
    if (mql.removeEventListener) mql.removeEventListener('change', syncMobile)
    else if (mql.removeListener) mql.removeListener(syncMobile)
  }
})
</script>

<template>
  <section class="chat-conv" :class="{ 'chat-conv--closed': isEnded }">
    <ChatTopBar
      :peer-name="peerName"
      :is-ended="isEnded"
      :can-end="canEndActive"
      :show-back="isMobile"
      @back="backToList"
      @end-session="openEndModal"
    />

    <div ref="scrollEl" class="chat-conv__scroll">
      <!-- top fade mask (M4-02): pointer-events:none never blocks scroll/click (P22) -->
      <div class="chat-conv__mask" :class="{ 'is-visible': showMask }" aria-hidden="true"></div>
      <div class="chat-conv__messages">
        <ChatHintText v-if="tempHint" :text="tempHint" />
        <ChatMessageList
          :messages="messages"
          :loading="loading"
          :has-more="hasMore"
          :current-user-id="currentUserId"
          @load-more="() => {}"
        />
        <p v-if="!loading && !messages.length && !tempHint" class="chat-conv__empty">
          {{ CHAT_COPY.NO_MESSAGES }}
        </p>
      </div>
    </div>

    <!-- input slot (M4-06c gate render; M4-17 real input component) -->
    <div v-if="inputVisible" class="chat-conv__input-slot">
      <ChatInputBar
        :sending="sendingActive"
        @send="onSend"
        @attach-image="onAttach"
        @attach-file="onAttach"
      />
    </div>

    <ChatEndConfirmModal
      :open="endModalOpen"
      :busy="endBusy"
      @confirm="onConfirmEnd"
      @cancel="onCancelEnd"
    />
  </section>
</template>

<style scoped>
.chat-conv {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  background: var(--gray-10);
}

/* -- message scroll area (M4-06a) -- */
.chat-conv__scroll {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}

/* -- top fade mask (M4-02): fades up to pure white, never blocks scroll/click -- */
.chat-conv__mask {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: var(--modal-mask-h, 32px);
  background: linear-gradient(to bottom, var(--paper) 0%, transparent 100%);
  pointer-events: none;
  opacity: 0;
  transition: opacity var(--dur-base) var(--ease-out);
}
.chat-conv__mask.is-visible { opacity: 1; }

.chat-conv__messages {
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.chat-conv__empty {
  padding: var(--space-6) var(--space-4);
  text-align: center;
  color: var(--gray-50);
  font-size: var(--fs-sm);
}

/* -- input slot (M4-06c gate render; M4-17 real input component) -- */
.chat-conv__input-slot {
  flex: none;
  padding: 0 var(--space-4) 10px; /* 10px float off the true bottom edge (plan L435) */
}

/* -- motion reduction -- */
@media (prefers-reduced-motion: reduce) {
  .chat-conv__mask { transition: none; }
}
</style>
