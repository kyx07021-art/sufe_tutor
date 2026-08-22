import { reactive, computed } from 'vue'
import { DEMO_CONVERSATIONS } from './demoData.js'
import { api } from '../../core/api.js'
import { showToast } from '../../composables/useToast.js'
import { CHAT_COPY } from '../../constants/m-chat.js'
import { getIface } from '../shell/ifaces.js'
import { normalizeMessage, sliceTail, advanceCursor } from './logic/messages.js'
import { sendMessages, createClientKey } from './logic/send.js'
import { pollOnce, PREVIEW_KIND, createPoller } from './logic/polling.js'
import { endSession, createEndSessionStore } from './logic/endSession.js'
import { applyTempSent, applyFormal, initTemp } from './logic/tempConversation.js'

/**
 * state.js - C2 chat module store + input-visibility single point + assembly actions.
 * -----------------------------------------------------------------------------------
 * - Store is seeded with DEMO_CONVERSATIONS; real I-17/I-18 data flows through the
 *   assembly loaders (loadMessages / loadRelations) and degrades silently to empty
 *   when the backend is not ready (non-fatal).
 * - `isChatInputVisible` is the module's ONLY input-visibility decision, shared by
 *   M4-06c (ended read-only gate) + M4-27 (temp quota) - never re-implemented.
 * - Action layer (M4-07/25/26/30/32 wiring): loadMessages / sendText /
 *   closeConversation / startTempConversation / startActivePolling all go through the
 *   standard interface caps via injected api. The end-session write obtains its
 *   capToken through the shell iface (openIdentityAuth) — see openEndSessionVerify.
 * - Relative imports (no '@' alias): this file is imported directly by the Node smoke,
 *   so it must resolve from plain Node.
 * - Mobile pane switching (M4-06b) is pure state (mobilePane), zero listeners (F3).
 */

/** Recent-message window size (I-18 sinceId=0 tail load; backward paging is outside
 *  this round's I-18 contract - data-cap). */
const PAGE_SIZE = 30

/** F6 end-session in-flight tracker (module singleton, injected into M4-25 endSession). */
const endBusy = createEndSessionStore()

/** F3 poller singleton (start is idempotent, stop cleans up). */
let activePoller = null

/**
 * Conversation list row shape = I-17 row (interfaces.md §19): conversationId /
 * otherName / avatar / lastMessage / lastAt / status / unread / tempStatus /
 * tempInitiatorId / quotaRemaining / iAmInitiator.
 */
export const chatState = reactive({
  conversations: [...DEMO_CONVERSATIONS],
  activeConversationId: DEMO_CONVERSATIONS[0]?.conversationId ?? null,
  /** 'list' | 'chat' - mobile (<=600px) visible pane; ignored on desktop. */
  mobilePane: 'list',
  /** Signed-in user id (assembly-injected; harness fixture = 1, real auth writes it). */
  currentUserId: 1,
  /** convId -> message rows (I-18 normalized, oldest first). */
  messages: {},
  /** convId -> polling cursor (sinceId). */
  sinceId: {},
  /** convId -> initial tail-load in flight. */
  messagesLoading: {},
  /** convId -> whether an earlier page is loadable (always false this round: backward paging data-cap). */
  hasMore: {},
  /** I-15 relation rows (with signing contract field, for the M4-25 gray-out gate). */
  relations: [],
  /** convId -> send in flight (M4-30 F6 backup, feeds ChatInputBar sending prop). */
  sending: {},
})

/** Currently active conversation object (or null). */
export const activeConversation = computed(
  () => chatState.conversations.find((c) => c.conversationId === chatState.activeConversationId) ?? null,
)

/** Open a conversation: set active id + mobile pane to chat (P22 negative case). */
export function openConversation(id) {
  chatState.activeConversationId = id
  chatState.mobilePane = 'chat'
  loadMessages(id)
}

/** Mobile back to the list pane. */
export function backToList() {
  chatState.mobilePane = 'list'
}

/** M4-25: end-session in-flight query (feeds ChatEndConfirmModal busy prop). */
export function isEndSessionBusy(convId) {
  return endBusy.isBusy(convId)
}

/** M4-30: send in-flight query (feeds ChatInputBar sending prop). */
export function isSendBusy(convId) {
  return !!chatState.sending[convId]
}

/**
 * Input-visibility single point (M4-06c ended read-only gate + M4-27 temp quota dual flag).
 * The input bar disappears in three cases:
 *   1. No active conversation - nothing to type into.
 *   2. Conversation ended (status === 'closed') - read-only; the plan C2 input bar
 *      "no longer appears" entirely.
 *   3. Temp initiator spent their single message (M4-27 flag: tempStatus non-init AND
 *      iAmInitiator AND quotaRemaining===0).
 * @param {object} [state] store to inspect (default chatState); pure for unit tests.
 */
export function isChatInputVisible(state) {
  const s = state || chatState
  const conv = s.conversations.find((c) => c.conversationId === s.activeConversationId)
  if (!conv) return false
  if (conv.status === 'closed') return false
  if (conv.tempStatus && conv.tempStatus !== 'init' && conv.iAmInitiator && conv.quotaRemaining === 0) return false
  return true
}

/* ================= Message loading (M4-07, I-18 tail cursor) ================= */

/**
 * Load the recent-message window for a conversation (I-18 sinceId=0).
 * Failure (backend not ready) degrades silently to an empty array - non-fatal.
 */
export async function loadMessages(convId) {
  chatState.messagesLoading[convId] = true
  try {
    const payload = await api(`/conversations/${convId}/messages?sinceId=0`, { auth: true })
    const raw = Array.isArray(payload) ? payload : (payload && payload.messages) || []
    const rows = raw.map(normalizeMessage).filter(Boolean)
    chatState.messages[convId] = sliceTail(rows, PAGE_SIZE)
    chatState.sinceId[convId] = advanceCursor(chatState.messages[convId])
    // Backward paging is outside this round's I-18 contract (sinceId only does
    // incremental polling): hasMore stays false - data-cap.
    chatState.hasMore[convId] = false
  } catch {
    chatState.messages[convId] = chatState.messages[convId] || []
  } finally {
    chatState.messagesLoading[convId] = false
  }
}

/** Earlier-page load: I-18 does not support backward paging - data-cap placeholder
 *  (no dead button: the list side never renders load-more this round). */
export function loadMoreMessages() {
  /* data-cap: backward paging awaits an S2 contract; hasMore stays false so the
     list never triggers this path */
}

/* ================= Optimistic send (M4-30, I-19/20/21) ================= */

/**
 * Optimistic text send: clientKey idempotency + optimistic tempId + failure rollback +
 * F6 busy. On success F7 syncs the list preview and advances the temp quota
 * (applyTempSent).
 */
export async function sendText(convId, text) {
  const idx = chatState.conversations.findIndex((c) => c.conversationId === convId)
  if (idx === -1) return
  const conv = chatState.conversations[idx]
  chatState.sending[convId] = true
  try {
    const result = await sendMessages({
      apiFn: api,
      convId,
      batch: [{ kind: 'text', body: text, clientKey: createClientKey() }],
      currentUserId: chatState.currentUserId,
      messages: chatState.messages[convId] || [],
      onPending: (optimistic) => {
        chatState.messages[convId] = optimistic
      },
    })
    if (result.ok) {
      chatState.messages[convId] = result.messages
      const row = chatState.conversations[idx]
      if (row) {
        row.lastMessage = text
        row.lastAt = new Date().toISOString()
      }
      // Temp initiator's first message lands -> quota spent -> input hides via the
      // isChatInputVisible temp-quota flag (M4-27).
      if (row && row.tempStatus && row.iAmInitiator) {
        chatState.conversations[idx] = applyTempSent(chatState.conversations[idx])
      }
    } else if (result.error) {
      showToast(result.error.message || CHAT_COPY.SEND_FAILED)
    }
    // result.busy -> in-flight no-op (F6)
  } finally {
    chatState.sending[convId] = false
  }
}

/* ================= Temp conversation (M4-26, I-23) ================= */

/**
 * Initiate a temp conversation (I-23). On success F7 upserts into the list and opens
 * the conversation. Exposed through the module boundary for cross-module entries
 * (teacher-square "send message", etc.).
 */
export async function startTempConversation(targetUserId, firstMessage) {
  try {
    const result = await initTemp({
      apiFn: api,
      targetUserId,
      firstMessage,
      conversations: chatState.conversations,
    })
    if (result.error) {
      showToast(CHAT_COPY.TEMP_QUOTA_EXCEEDED)
      return null
    }
    chatState.conversations = result.conversations
    openConversation(result.conv.conversationId)
    return result.conv
  } catch (err) {
    showToast(err.message || CHAT_COPY.TEMP_QUOTA_EXCEEDED)
    return null
  }
}

/* ================= End session (M4-25, I-16) ================= */

/**
 * Real capToken producer for the end-session write (I-06 via the M6 identity-auth
 * iface). Opens the verify modal through the shell interface registry (default
 * verify scene per authState) and resolves with the fresh capToken on success, or
 * null when the user dismisses it — the write is then a no-op (capped) and the
 * confirm modal stays open. getIface returns undefined when the auth module has
 * not loaded (plain-Node tests), in which case it resolves null so the endSession
 * logic stays import-safe.
 */
function openEndSessionVerify() {
  const open = getIface('openIdentityAuth')
  if (!open) return Promise.resolve(null)
  return new Promise((resolve) => {
    open({
      onVerified: (capToken) => resolve(capToken || null),
      onCancel: () => resolve(null),
    })
  })
}

/**
 * End-session write path: busy (F6) + idempotent (already-closed short-circuit) +
 * F7 sync (applyEnded) + real capToken (openEndSessionVerify -> I-06 verify modal).
 */
export async function closeConversation(convId) {
  const result = await endSession({
    apiFn: api,
    capTokenProvider: openEndSessionVerify,
    convId,
    conversations: chatState.conversations,
    store: endBusy,
  })
  if (result.ok) {
    chatState.conversations = result.conversations
    showToast(result.already ? CHAT_COPY.END_ALREADY : CHAT_COPY.END_DONE)
    return true
  }
  if (result.capped) {
    showToast(CHAT_COPY.END_REAUTH_HINT)
    return false
  }
  if (result.error) {
    showToast(result.error.message || CHAT_COPY.END_FAILED)
    return false
  }
  return false
}

/* ================= Relations & gray-out gate (I-15 / M4-25) ================= */

/** Load I-15 relations (with signing contract field, for the end-session gray-out
 *  gate). Failure degrades to empty (non-fatal). */
export async function loadRelations() {
  try {
    const payload = await api('/my-relations', { auth: true })
    chatState.relations = (payload && payload.relations) || []
  } catch {
    chatState.relations = chatState.relations || []
  }
}

/* ================= Incremental polling (M4-32, I-18) ================= */

/** Non-text message list-preview placeholder mapping (I-17 lastMessageKind -> CHAT_COPY). */
function previewLabelOf(kind) {
  if (kind === PREVIEW_KIND.IMAGE) return CHAT_COPY.PREVIEW_IMAGE
  if (kind === PREVIEW_KIND.FILE) return CHAT_COPY.PREVIEW_FILE
  if (kind === PREVIEW_KIND.CONTRACT) return CHAT_COPY.PREVIEW_CONTRACT
  return ''
}

/**
 * Start polling the active conversation (F3 idempotent: repeated start does not stack
 * a timer; component unmount calls stop). onTick: pollOnce (sinceId cursor + data-mid
 * dedup + preview bump + unread) + temp->formal detection (M4-29: initiator sees the
 * peer's first reply -> applyFormal, tempStatus->null, hint switches).
 */
export function startActivePolling() {
  if (activePoller) return activePoller
  activePoller = createPoller({
    apiFn: api,
    intervalMs: 3000,
    onTick: async () => {
      const convId = chatState.activeConversationId
      if (convId == null) return
      const res = await pollOnce({
        apiFn: api,
        convId,
        sinceId: chatState.sinceId[convId] || 0,
        messages: chatState.messages[convId] || [],
        conversations: chatState.conversations,
        currentUserId: chatState.currentUserId,
      })
      if (res.error) return
      chatState.messages[convId] = res.messages
      chatState.sinceId[convId] = res.sinceId
      // Preview placeholder mapping (I-17 lastMessageKind -> CHAT_COPY).
      const row = chatState.conversations.find((c) => c.conversationId === convId)
      if (row && row.lastMessageKind && row.lastMessage == null) {
        row.lastMessage = previewLabelOf(row.lastMessageKind)
      }
      // M4-29 formal conversion: initiator in 'sent' state sees the peer's first
      // reply -> formal (tempStatus->null + wasTemp).
      if (row && row.tempStatus === 'sent' && row.iAmInitiator) {
        const latest = res.messages[res.messages.length - 1]
        if (latest && latest.sender_user_id !== chatState.currentUserId) {
          const i = chatState.conversations.findIndex((c) => c.conversationId === convId)
          if (i !== -1) chatState.conversations[i] = applyFormal(chatState.conversations[i])
        }
      }
    },
  })
  activePoller.start()
  return activePoller
}

/** Stop polling the active conversation (F3 cleanup). */
export function stopActivePolling() {
  if (activePoller) {
    activePoller.stop()
    activePoller = null
  }
}
