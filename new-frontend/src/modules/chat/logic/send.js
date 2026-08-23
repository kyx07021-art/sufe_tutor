/**
 * send.js - M4-30 optimistic send pipeline for the C2 chat module.
 * ---------------------------------------------------------------------------
 * Full pipeline for POST /api/conversations/:id/messages (I-19/20/21):
 *   clientKey idempotency (A2) + optimistic negative-tempId rows + failure
 *   rollback + per-conversation in-flight busy lock (F6).
 *
 * Pure-ish: zero Vue, zero `@` alias, no DOM. `apiFn` is injected so the module
 * imports cleanly from plain Node (unit tests) and the browser alike.
 * `apiFn(path, { method, body })` follows the src/core/api.js single-point
 * signature; auth injection / 401 handling live in api.js, not here.
 *
 * Message row shape (I-18):
 *   { id, sender_user_id, kind, name, body, thumb, created_at,
 *     pending?:true, clientKey?, tempId? }
 *   - id < 0 on optimistic rows (tempId); replaced by the server id on success.
 *   - pending:true marks rows that are not yet persisted server-side.
 *
 * The module never mutates the caller's arrays: sendMessages() returns a NEW
 * messages array (success: temp rows replaced by server rows; failure: the
 * exact original array reference). The caller owns its reactive store and
 * decides when to apply the returned array.
 *
 * Zero Chinese in comments (contract 6).
 */

/** Monotonic negative id generator for optimistic rows (session-unique). */
let tempSeq = 0

/** Module-scoped per-conversation in-flight lock (F6). */
const inFlightConvIds = new Set()

/** Fallback idempotency-key counter (used when webcrypto lacks randomUUID). */
let clientSeq = 0

/**
 * Create a unique clientKey for one send-batch item (A2 idempotency key).
 * Prefers crypto.randomUUID when available; otherwise falls back to a monotonic
 * counter + random suffix (never a bare timestamp, which can collide across
 * two calls in the same millisecond).
 *
 * @returns {string} A per-item key unique within this session.
 */
export function createClientKey() {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') {
    try {
      return `ck-${c.randomUUID()}`
    } catch {
      /* fall through to the counter fallback */
    }
  }
  clientSeq += 1
  return `ck-${Date.now().toString(36)}-${clientSeq}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Build an optimistic message row for one batch item.
 *
 * @param {object} item
 * @param {string} [item.kind]  'text' | 'image' | 'file' (batch items from
 *   stageAttachment carry their kind; default 'text').
 * @param {string} [item.body]  Text body or image/file caption.
 * @param {string} [item.name]  File name (uploads).
 * @param {string} [item.thumb]  Thumbnail data URL (image uploads).
 * @param {string|number} [item.uploadId]  Staged-upload id (uploads only).
 * @param {string} item.clientKey  Idempotency key (A2).
 * @param {number} item.currentUserId  Sender id for the row.
 * @returns {object} A row with a NEGATIVE tempId (also used as `id` so the
 *   row is Vue-keyable), pending:true, and the item's clientKey.
 */
export function makeOptimistic({ kind, body, name, thumb, uploadId, clientKey, currentUserId }) {
  const tempId = nextTempId()
  return {
    id: tempId,
    tempId,
    sender_user_id: currentUserId,
    kind: kind || 'text',
    name: name || '',
    body: body || '',
    thumb: thumb || '',
    uploadId: uploadId || undefined,
    created_at: new Date().toISOString(),
    pending: true,
    clientKey,
  }
}

/**
 * Drop batch items whose clientKey is already represented locally (A2).
 * Duplicates are filtered against `existingClientKeys` and against each other
 * (two items in the same batch sharing a key keep only the first). A batch item
 * without a clientKey is KEPT: dropping it would silently lose user content;
 * the malformed batch is better rejected by the API than silently truncated.
 *
 * @param {Array} batch  Raw batch items (each may carry clientKey).
 * @param {Array} existingClientKeys  clientKeys already present in `messages`.
 * @returns {Array} Batch items that are still safe to send.
 */
export function dedupBatchByClientKey(batch, existingClientKeys) {
  const seen = new Set(existingClientKeys || [])
  return (batch || []).filter((item) => {
    if (!item.clientKey) return true
    if (seen.has(item.clientKey)) return false
    seen.add(item.clientKey)
    return true
  })
}

/**
 * Send one batch of messages optimistically.
 *
 * Pipeline: busy lock (F6) -> dedup (A2) -> build optimistic rows -> build API
 * body -> await apiFn -> replace temp rows by clientKey (success) or roll back
 * to the exact pre-send array (failure).
 *
 * `onPending` is the true-optimistic render hook: it fires synchronously with
 * the optimistic messages array BEFORE the network await, so a caller can
 * render pending bubbles immediately and reconcile with the returned array
 * afterwards.
 *
 * `conversations` is part of the contract signature but intentionally NOT used
 * by this module: the conversation-list preview bump is the caller's
 * responsibility (keeps send.js store-agnostic and Node-runnable).
 *
 * @param {object} opts
 * @param {Function} opts.apiFn  apiFn(path, { method, body }) -> Promise<response>
 * @param {number|string} opts.convId  Conversation id.
 * @param {Array} opts.batch  [{ kind:'text', body, clientKey } |
 *                            { uploadId, clientKey, kind?, name?, body?, thumb? }].
 * @param {number} opts.currentUserId  Sender id for optimistic rows.
 * @param {Array} opts.messages  Current message rows (pre-send; not mutated).
 * @param {Array} [opts.conversations]  Reserved (caller-owned store).
 * @param {Function} [opts.onPending]  Called with the optimistic messages array
 *   right before the API call.
 * @returns {Promise<object>}
 *   - ok:true  -> { ok, messages (temp replaced by real), response, tempQuota?,
 *                 convStatus?, deduped? } (deduped:true when nothing needed sending)
 *   - ok:false -> { ok:false, messages (exact original array), error, code?, status?,
 *                 busy? } (busy:true when a send for the same convId was in flight)
 */
export async function sendMessages({ apiFn, convId, batch, currentUserId, messages, conversations, onPending }) {
  const current = messages || []

  // F6: per-conversation in-flight lock — a second call for the same convId
  // while one is in flight returns early (no double send, no double rollback).
  if (inFlightConvIds.has(convId)) {
    return { ok: false, busy: true, messages: current }
  }

  // A2: drop items whose clientKey already exists in `messages` (no duplicate
  // optimistic row). Empty batch / fully-deduped batch -> no-op success.
  const items = dedupBatchByClientKey(batch, current.map((m) => m.clientKey).filter(Boolean))
  if (items.length === 0) {
    return { ok: true, messages: current, response: null, deduped: true }
  }

  inFlightConvIds.add(convId)
  try {
    // Optimistically append one temp row per item to a NEW array (the caller's
    // array stays untouched).
    const optimistic = items.map((item) =>
      makeOptimistic({
        kind: item.kind,
        body: item.body,
        name: item.name,
        thumb: item.thumb,
        uploadId: item.uploadId,
        clientKey: item.clientKey,
        currentUserId,
      }),
    )
    const optimisticMessages = [...current, ...optimistic]

    // True-optimistic render hook (fires before the network await).
    if (typeof onPending === 'function') onPending(optimisticMessages)

    // I-19/20/21 body shape: text items carry kind/body; upload items carry only
    // uploadId (the staged upload already holds kind/name/body/thumb server-side).
    const body = {
      batch: items.map((item) =>
        item.uploadId
          ? { uploadId: item.uploadId, clientKey: item.clientKey }
          : { kind: item.kind || 'text', body: item.body, clientKey: item.clientKey },
      ),
    }

    const response = await apiFn(`/conversations/${convId}/messages`, { method: 'POST', body })

    // Success: replace each temp row with the real row matched by clientKey
    // (I-19 response messages echo the same clientKey). The server echo is a
    // minimal row ({id, kind, name, clientKey}); merge it under the optimistic
    // row so the display fields (body / sender_user_id / created_at / thumb)
    // survive until the next poll reconciles with the full row (PA-2-F3: a bare
    // `{ ...real }` replacement blanked the bubble for up to one poll cycle).
    // A temp row whose key is absent from the response stays pending — the next
    // poll (M4-32) reconciles.
    const realByKey = new Map((response?.messages || []).map((m) => [m.clientKey, m]))
    const finalMessages = optimisticMessages.map((row) => {
      if (!row.pending) return row
      const real = realByKey.get(row.clientKey)
      // tempId is an optimistic-only marker; drop it once the server row lands.
      return real ? { ...real, ...row, id: real.id, pending: false, tempId: undefined } : row
    })

    return {
      ok: true,
      messages: finalMessages,
      response,
      tempQuota: response?.tempQuota,
      convStatus: response?.convStatus,
    }
  } catch (error) {
    // Failure (incl. 403 closed / 409 TEMP_QUOTA_EXCEEDED): roll back to the
    // exact pre-send array. The caller toasts SEND_FAILED or the server message.
    return { ok: false, messages: current, error, code: error?.code, status: error?.status }
  } finally {
    inFlightConvIds.delete(convId)
  }
}

/**
 * Next unique negative tempId.
 * A strict monotonic counter (not -Date.now()) so two rows built in the same
 * millisecond can never collide within this session.
 */
function nextTempId() {
  tempSeq -= 1
  return tempSeq
}
