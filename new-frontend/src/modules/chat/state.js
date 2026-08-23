import { reactive, computed } from 'vue'
import { api } from '../../core/api.js'
import { showToast } from '../../composables/useToast.js'
import { CHAT_COPY, LIST_POLL_MS } from '../../constants/m-chat.js'
import { getIface } from '../shell/ifaces.js'
import { ROLES, authStore } from '../shell/auth-store.js'
import { normalizeMessage, sliceTail, advanceCursor } from './logic/messages.js'
import { sendMessages, createClientKey } from './logic/send.js'
import { pollOnce, PREVIEW_KIND, createPoller } from './logic/polling.js'
import { endSession, createEndSessionStore } from './logic/endSession.js'
import { applyTempSent, applyFormal, initTemp } from './logic/tempConversation.js'
import { unreadOpenFromCard } from './logic/unread.js'

/**
 * state.js - C2 chat module store + input-visibility single point + assembly actions.
 * -----------------------------------------------------------------------------------
 * - Conversation list is loaded from I-17 via loadConversations() on page entry: there
 *   is no fixture seed, the shell renders only real rows and degrades silently to an
 *   empty list when the backend is not ready (non-fatal). The first loaded row becomes
 *   the active conversation (desktop opens it immediately) without touching mobilePane,
 *   so the mobile shell still starts on the list pane (P22 negative path).
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
  conversations: [],
  activeConversationId: null,
  /** 'list' | 'chat' - mobile (<=600px) visible pane; ignored on desktop. */
  mobilePane: 'list',
  /** Signed-in user id (assembly-injected from authStore.user.id; null until known). */
  currentUserId: null,
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
  markConversationRead(id)
  loadMessages(id)
}

/**
 * Mark a conversation read (I-22): clear the local unread dot (M4-05 openFromCard)
 * and persist the read cursor server-side via POST /api/conversations/:id/read.
 * Fired on every openConversation — opening a conversation IS the read trigger
 * (interfaces.md I-22: "read cursor advances to the latest"; the server unread
 * count decrements). The server call is fire-and-forget and non-fatal: a failure
 * leaves the local dot cleared and the next open retries the idempotent POST; the
 * failure is logged (E1), never swallowed silently.
 * @param {number} convId  conversation id
 * @param {Function} [apiFn]  network fn following the core api() signature
 *   (injectable for Node tests; defaults to the module single-point api)
 * @returns {number|null}  the resulting unread value (0), or null when the row is missing
 */
export function markConversationRead(convId, apiFn = api) {
  const next = unreadOpenFromCard(chatState.conversations, convId)
  if (next == null) return null
  apiFn(`/conversations/${convId}/read`, { method: 'POST', auth: true }).catch((err) => {
    console.warn(`markConversationRead failed (conv ${convId}): ${err && err.message}`)
  })
  return next
}

/** Mobile back to the list pane. */
export function backToList() {
  chatState.mobilePane = 'list'
}

/**
 * Set the signed-in user id (assembly-injected from authStore.user.id once auth is
 * ready). Feeds bubble ownership (mine vs peer), optimistic-send sender ids and the
 * unread / temp-formal decisions — a hardcoded value made peers render as mine.
 * @param {number|null} id  the current user's id, or null when signed out
 */
export function setCurrentUser(id) {
  chatState.currentUserId = id
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

/* ================= Conversation list (I-17) ================= */

/**
 * Normalize one I-17 conversation row into the store row shape (single source).
 * Accepts BOTH the contract shape (interfaces.md §19: conversationId / otherName /
 * avatar / lastMessage / lastAt / status / unread / tempStatus / tempInitiatorId /
 * quotaRemaining / iAmInitiator) AND the current backend raw shape (id /
 * student_name / teacher_name / student_avatar / teacher_avatar / last_body /
 * last_kind / last_at / last_sender / unread_count + tempStatus / tempInitiatorId /
 * iAmInitiator / quota). The backend is being unified to the contract shape
 * (PA-1c-F3); this keeps the consumer robust meanwhile.
 * @param {object} c  raw row
 * @param {object} [me]  current user { id, role }; picks the other-party name/avatar
 * @returns {object|null} store row, or null when the row is unusable
 */
export function normalizeConversationRow(c, me) {
  if (!c || (c.conversationId == null && c.id == null)) return null
  const isTeacher = me && me.role === ROLES.TEACHER
  return {
    conversationId: c.conversationId ?? c.id,
    // I-17: otherName prefers the teacher side when the role is unknown.
    otherName: c.otherName ?? (isTeacher ? c.student_name : c.teacher_name) ?? '',
    avatar: c.avatar ?? (isTeacher ? c.student_avatar : c.teacher_avatar) ?? '',
    lastMessage: c.lastMessage ?? c.last_body ?? '',
    lastMessageKind: c.lastMessageKind ?? c.last_kind ?? null,
    lastAt: c.lastAt ?? c.last_at ?? null,
    status: c.status ?? 'active',
    unread: c.unread ?? c.unread_count ?? 0,
    tempStatus: c.tempStatus ?? null,
    tempInitiatorId: c.tempInitiatorId ?? null,
    quotaRemaining: c.quotaRemaining ?? c.quota ?? 0,
    iAmInitiator: c.iAmInitiator ?? (me && c.tempInitiatorId != null && c.tempInitiatorId === me.id),
  }
}

/**
 * Apply a set of I-17 raw rows to the store (replace any placeholder rows).
 * The first row becomes the active conversation when none is active yet and its
 * recent messages are loaded, matching the previous fixture-seed behavior of
 * opening a conversation immediately on desktop; mobilePane is intentionally left
 * untouched so mobile still starts on the list pane (P22 negative path).
 * @param {Array<object>} rows  raw I-17 rows
 * @param {object} [me]  current user { id, role }
 * @returns {Array<object>} the normalized rows stored
 */
export function applyConversations(rows, me) {
  const normalized = (rows || []).map((c) => normalizeConversationRow(c, me)).filter(Boolean)
  chatState.conversations = normalized
  if (chatState.activeConversationId == null && normalized.length > 0) {
    chatState.activeConversationId = normalized[0].conversationId
    loadMessages(normalized[0].conversationId)
  }
  return normalized
}

/**
 * Load the conversation list (I-17) and replace the store rows. Failure degrades
 * silently to an empty list (non-fatal). `apiFn` is injectable for Node tests; it
 * defaults to the module single-point api.
 * @param {object} [me]  current user { id, role } (used for other-party naming)
 * @param {Function} [apiFn]  network fn following the core api() signature
 */
export async function loadConversations(me, apiFn = api) {
  try {
    const payload = await apiFn('/conversations', { auth: true })
    const raw = Array.isArray(payload) ? payload : (payload && payload.conversations) || []
    applyConversations(raw, me)
  } catch {
    chatState.conversations = chatState.conversations || []
  }
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

/** F3 conversation-list poller singleton (start is idempotent, stop cleans up). */
let listPoller = null

/**
 * Start periodic I-17 conversation-list refresh (PA-2-F12). The message poll
 * above only covers the ACTIVE conversation; a conversation newly opened by the
 * other party would never appear in the receiver's list until a page re-entry.
 * This poller re-fetches the whole list on a slower cadence (LIST_POLL_MS), so
 * new rows surface with their unread/status while the page stays open.
 *
 * Testable: `apiFn` and `intervalMs` are injectable for Node smoke tests; the
 * default apiFn is the module single-point api and the default interval is the
 * LIST_POLL_MS constant. F3 idempotent: a second start on an already-running
 * poller is a no-op, never a second timer.
 * @param {{ apiFn?: Function, intervalMs?: number }} [opts]
 * @returns {{ start:()=>void, stop:()=>void, active:boolean }}
 */
export function startListPolling({ apiFn = api, intervalMs = LIST_POLL_MS } = {}) {
  if (listPoller) return listPoller
  listPoller = createPoller({
    apiFn,
    intervalMs,
    onTick: async (fn) => {
      await loadConversations(authStore.user, fn)
    },
  })
  listPoller.start()
  return listPoller
}

/** Stop the conversation-list poller (F3 cleanup; component unmount / logout). */
export function stopListPolling() {
  if (listPoller) {
    listPoller.stop()
    listPoller = null
  }
}
