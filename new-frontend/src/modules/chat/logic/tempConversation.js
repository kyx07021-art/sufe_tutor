/**
 * tempConversation.js — M4-26/27/28/29 temporary-conversation logic (pure).
 * ---------------------------------------------------------------------------
 * Temporary conversation (temp) state machine (interfaces.md §17/§19, S2-T0):
 *   init (only the initiator sees/sends, quota 1) -> first message lands ->
 *   sent (receiver sees + can reply; initiator over-quota is rejected with
 *   409 TEMP_QUOTA_EXCEEDED) -> receiver replies -> formal (tempStatus -> null,
 *   tempInitiatorId kept = wasTemp for the "converted" hint).
 *
 * Pure + Node-runnable: zero Vue, zero '@' alias, zero DOM. Rows use the STORE
 * shape (CONTRACT.md §2.3): conversationId / status('active'|'closed') /
 * lastMessage / lastAt / unread / tempStatus / tempInitiatorId /
 * quotaRemaining / iAmInitiator, plus `wasTemp` (set by applyFormal) so the
 * formal hint is distinguishable from a never-temp conversation.
 *
 * Copy mapping is the caller's job: these functions return hint KEYS
 * ('init'|'sent'|'formal'|'received') that map to CHAT_COPY.TEMP_HINT_*;
 * they never contain copy literals. The input-bar single point
 * `isChatInputVisible` (state.js, M4-27) is kept read-only; the mutation guard
 * that proves the temp-quota flag is load-bearing lives in test/chat-temp.mjs.
 */

/**
 * Hint KEY for a conversation row, or null when no hint applies.
 * - formal (tempStatus null but the conversation WAS temp)  -> 'formal'
 * - sent + initiator  -> 'sent'    (M4-26: initiator sent the first message)
 * - sent + receiver   -> 'received' (M4-28: receiver side hint)
 * - init + initiator  -> 'init'    (M4-26: initiator has not sent yet)
 * - otherwise (normal/closed/init-as-receiver) -> null (no hint)
 * @param {{tempStatus?: string|null, iAmInitiator?: boolean, wasTemp?: boolean}} conv
 * @returns {'init'|'sent'|'formal'|'received'|null}
 */
export function deriveTempHint(conv) {
  if (conv.tempStatus == null && conv.wasTemp) return 'formal'
  if (conv.tempStatus === 'sent' && conv.iAmInitiator === true) return 'sent'
  if (conv.tempStatus === 'sent' && conv.iAmInitiator === false) return 'received'
  if (conv.tempStatus === 'init' && conv.iAmInitiator === true) return 'init'
  return null
}

/**
 * Whether the current user may see this conversation row (I-17 list rule).
 * - Initiator side: always visible (the row appears from the moment it is created).
 * - Receiver side: init is hidden (negative path: before the initiator sends,
 *   the receiver's list must NOT show the row); sent and formal are visible.
 * @param {{tempStatus?: string|null, iAmInitiator?: boolean}} conv
 * @param {boolean} [iAmInitiator] current user is the temp initiator
 *        (falls back to conv.iAmInitiator).
 * @returns {boolean}
 */
export function tempVisibleToMe(conv, iAmInitiator) {
  const me = iAmInitiator !== undefined ? iAmInitiator : conv.iAmInitiator
  if (me) return true
  if (conv.tempStatus === 'init') return false
  return true
}

/**
 * Whether the current user may still send in this conversation (M4-27).
 * - Non-initiator: always true (the receiver may reply freely).
 * - Formal / never-temp (tempStatus null): true.
 * - Initiator in init with quota left: true.
 * - Initiator after the first message (sent, quota 0): false.
 * @param {{tempStatus?: string|null, iAmInitiator?: boolean, quotaRemaining?: number|null}} conv
 * @returns {boolean}
 */
export function tempQuotaLeft(conv) {
  if (!conv.iAmInitiator) return true
  if (conv.tempStatus == null) return true
  if (conv.tempStatus === 'init' && (conv.quotaRemaining ?? 0) > 0) return true
  return false
}

/**
 * After the initiator's first message lands: tempStatus -> 'sent', quota spent.
 * Pure — returns a NEW row, the input is not mutated.
 * @param {object} conv store row
 * @returns {object} new row with tempStatus 'sent' and quotaRemaining 0
 */
export function applyTempSent(conv) {
  return { ...conv, tempStatus: 'sent', quotaRemaining: 0 }
}

/**
 * Receiver replied -> the temp becomes a formal conversation (M4-29).
 * tempStatus -> null (the input-bar temp-quota flag no longer applies, so
 * isChatInputVisible flips back to true) and wasTemp -> true so the "converted"
 * hint is derivable. Pure — returns a NEW row, the input is not mutated.
 * @param {object} conv store row
 * @returns {object} new row with tempStatus null and wasTemp true
 */
export function applyFormal(conv) {
  return { ...conv, tempStatus: null, wasTemp: true }
}

/** Module-private: insert `row` or replace the row with the same conversationId (F7). */
function upsertRow(conversations, row) {
  const idx = conversations.findIndex((c) => c.conversationId === row.conversationId)
  if (idx === -1) return [...conversations, row]
  return [...conversations.slice(0, idx), row, ...conversations.slice(idx + 1)]
}

/**
 * Initiate a temp conversation (M4-26, I-23).
 * POST /api/conversations/temp via the injected apiFn (core/api.js convention:
 *   apiFn('/conversations/temp', { method:'POST', body:{ targetUserId, firstMessage } })
 *   -> { conversationId, status, tempStatus, tempInitiatorId, iAmInitiator, quota }).
 * The response is normalized to the STORE shape (quotaRemaining = resp.quota)
 * and upserted into `conversations` (F7: add or replace by conversationId).
 * On 409 TEMP_QUOTA_EXCEEDED -> { conv:null, conversations, error:'TEMP_QUOTA_EXCEEDED' }.
 * Any other failure rethrows so the caller's toast layer decides (E1 — never
 * swallow a real error silently).
 *
 * @param {object} opts
 * @param {(path:string, init:object) => Promise<object>} opts.apiFn injected fetch
 * @param {number} opts.targetUserId
 * @param {string} opts.firstMessage first temp message (<=1000, server enforced)
 * @param {Array<object>} opts.conversations current store rows
 * @param {boolean} [opts.iAmInitiator] fallback when the response omits it (default true)
 * @param {string} [opts.now] ISO timestamp for lastAt (injectable for tests)
 * @returns {Promise<{conv: object, conversations: Array<object>} |
 *                    {conv: null, conversations: Array<object>, error: string}>}
 */
export async function initTemp({ apiFn, targetUserId, firstMessage, conversations, iAmInitiator, now = new Date().toISOString() }) {
  try {
    const resp = await apiFn('/conversations/temp', {
      method: 'POST',
      body: { targetUserId, firstMessage },
    })
    const conv = {
      conversationId: resp.conversationId,
      status: resp.status ?? 'active',
      tempStatus: resp.tempStatus ?? null,
      tempInitiatorId: resp.tempInitiatorId ?? null,
      quotaRemaining: resp.quota ?? 0,
      iAmInitiator: resp.iAmInitiator ?? (iAmInitiator !== undefined ? iAmInitiator : true),
      lastMessage: firstMessage,
      lastAt: now,
      unread: 0,
    }
    return { conv, conversations: upsertRow(conversations, conv) }
  } catch (e) {
    if (e && (e.code === 'TEMP_QUOTA_EXCEEDED' || e.status === 409)) {
      return { conv: null, conversations, error: 'TEMP_QUOTA_EXCEEDED' }
    }
    throw e
  }
}
