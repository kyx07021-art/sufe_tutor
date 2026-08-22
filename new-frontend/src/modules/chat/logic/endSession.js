/**
 * endSession.js - M4-25 end-session write path (F7 sync + idempotency + busy).
 * --------------------------------------------------------------------------
 * Pure, Node-runnable logic for the C2 "end conversation" action (I-16):
 *
 *   - canEnd(relationRow)   : single-source gray-out judgment for the ChatTopBar
 *                             `canEnd` prop. A relation (I-15 row) cannot be
 *                             ended when it is already closed OR carries a
 *                             formal contract (`signing` truthy). A temp
 *                             conversation (tempStatus !== null) CAN be ended
 *                             (I-16 temp close = delete the row, zero notices).
 *   - applyEnded(list, id)  : F7 local-state sync. Returns a NEW conversations
 *                             array: a temp row is removed entirely; a formal
 *                             row is flipped to status 'closed' (kept, readonly).
 *                             The input array is never mutated.
 *   - createEndSessionStore : F6 busy tracker factory (one isolated Set per
 *                             store, so tests get G4-clean isolation).
 *   - endSession(deps)      : the full write path. Busy-guarded (F6), idempotent
 *                             (already-closed local short-circuit), capToken-
 *                             injected (the caller supplies the provider; a null
 *                             token means the write is NOT sent — capped), and
 *                             network hidden behind an injected apiFn so Node
 *                             tests mock it. It returns
 *                             result objects and NEVER toasts or touches the store:
 *                             the caller writes the returned `conversations` back
 *                             to chatState and maps results to CHAT_COPY keys.
 *
 * Zero Vue / DOM / '@' alias imports - plain ESM, importable from Node.
 */

/** Server error code for "conversation already closed" (I-16 idempotent short-circuit). */
export const ALREADY_CLOSED_CODE = 'CONVERSATION_ALREADY_CLOSED'

/**
 * Gray-out judgment for the end-session button (M4-25 gate).
 * @param {object|null} relationRow - I-15 relation row:
 *   { conversationId, status, tempStatus, tempInitiatorId, other, last, signing }.
 * @returns {boolean} true when the conversation can be ended. false when: relation
 *   data is absent (loading/unknown - conservative), the conversation is already
 *   closed, or a formal contract exists (`signing` truthy). Temp conversations
 *   (tempStatus !== null) can always be ended (I-16 temp close = delete row).
 */
export function canEnd(relationRow) {
  if (!relationRow) return false
  if (relationRow.status === 'closed') return false
  if (relationRow.signing) return false
  return true
}

/**
 * F7 local-state sync after a successful (or already-completed) end.
 * Pure reducer: never mutates the input.
 * @param {Array<object>} conversations - I-17 conversation rows.
 * @param {number} convId - the ended conversation id.
 * @returns {Array<object>} new array: temp row removed; formal row status='closed'.
 *   Same reference when nothing changes (row absent or already closed).
 */
export function applyEnded(conversations, convId) {
  const row = conversations.find((c) => c.conversationId === convId)
  if (!row) return conversations
  if (row.tempStatus != null) {
    return conversations.filter((c) => c.conversationId !== convId)
  }
  if (row.status === 'closed') return conversations
  return conversations.map((c) => (c.conversationId === convId ? { ...c, status: 'closed' } : c))
}

/**
 * In-flight (busy) tracker for end-session calls (F6).
 * @returns {{ isBusy:(convId:number)=>boolean, busy:(convId:number)=>void, done:(convId:number)=>void }}
 *   A fresh, isolated tracker. The production assembly creates one and passes it to
 *   every endSession call; tests create one per scenario (G4 global-state isolation).
 */
export function createEndSessionStore() {
  const inflight = new Set()
  return {
    isBusy: (convId) => inflight.has(convId),
    busy: (convId) => {
      inflight.add(convId)
    },
    done: (convId) => {
      inflight.delete(convId)
    },
  }
}

/** Module-scoped default tracker (single shared busy set for the assembled app). */
export const defaultEndSessionStore = createEndSessionStore()

/** True when the API error means the conversation was already ended (idempotent). */
function isAlreadyClosed(err) {
  if (!err) return false
  if (err.code && err.code === ALREADY_CLOSED_CODE) return true
  if (err.status === 404) return true
  return false
}

/**
 * Full end-session write path (M4-25).
 * @param {object} deps
 * @param {(path:string, opts:object)=>Promise} deps.apiFn - injected network call
 *   (e.g. core/api.js api()). POST /conversations/:id/close { capToken }.
 * @param {()=>Promise<string|null|undefined>} deps.capTokenProvider - injected
 *   capToken source. Resolving null/undefined => capped (the write does NOT reach
 *   the API); the caller decides what that means (e.g. the verify modal was
 *   dismissed).
 * @param {number} deps.convId - conversation id to end.
 * @param {Array<object>} deps.conversations - current local conversation rows.
 * @param {{isBusy,busy,done}} [deps.store] - busy tracker (default module-scoped).
 * @returns {Promise<object>} one of:
 *   { ok:false, busy:true }           - a close for this conv is already in flight (no-op).
 *   { ok:true, already:true, conversations } - already closed locally (no network).
 *   { ok:false, capped:true }         - capToken unavailable; write NOT sent.
 *   { ok:true, conversations }         - ended; caller writes conversations + toasts END_DONE.
 *   { ok:true, already:true, conversations } - server reports already closed; reconciled.
 *   { ok:false, error }               - failed; state unchanged (caller toasts error.message).
 */
export async function endSession({
  apiFn,
  capTokenProvider,
  convId,
  conversations = [],
  store = defaultEndSessionStore,
}) {
  if (store.isBusy(convId)) return { ok: false, busy: true }

  const row = conversations.find((c) => c.conversationId === convId)
  if (row && row.status === 'closed') return { ok: true, already: true, conversations }

  store.busy(convId)
  try {
    let capToken
    try {
      capToken = await capTokenProvider()
    } catch (err) {
      return { ok: false, error: err }
    }
    if (capToken === null || capToken === undefined) {
      return { ok: false, capped: true }
    }
    try {
      await apiFn(`/conversations/${convId}/close`, { method: 'POST', body: { capToken } })
    } catch (err) {
      if (isAlreadyClosed(err)) {
        return { ok: true, already: true, conversations: applyEnded(conversations, convId) }
      }
      return { ok: false, error: err }
    }
    return { ok: true, conversations: applyEnded(conversations, convId) }
  } finally {
    store.done(convId)
  }
}
