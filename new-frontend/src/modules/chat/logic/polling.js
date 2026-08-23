/**
 * polling.js - M4-32 incremental polling (pure logic, Node-runnable).
 * ---------------------------------------------------------------------------
 * Cursor-based incremental sync for the C2 conversation pane (plan M4-32:
 * "sinceId cursor + data-mid/seq dedup + preview bump").
 *
 * Poll contract (I-18, interfaces.md S2):
 *   GET /api/conversations/:id/messages?sinceId=N  ->  { conversation, messages:
 *   [{ id, sender_user_id, kind, name, body, thumb, created_at }] }
 *   sinceId=0 fetches the most recent page. The response `conversation` also
 *   carries the row's temp fields (init/sent/formal); this module does not
 *   touch them — the assembly may refresh the temp hint from them.
 *
 * Two responsibilities:
 *   1. pollOnce      - one incremental round-trip: merge incoming into the
 *      rendered list (dedup by message id, so duplicate ids are never rendered
 *      twice), advance the sinceId cursor, bump the I-17 list-row preview
 *      (lastMessage / lastAt / unread). Pure state-in/state-out; the caller
 *      writes the result into the chat store.
 *   2. createPoller  - timer lifecycle for repeated polls. start() is
 *      idempotent (F3: calling start() twice never stacks a second timer);
 *      stop() clears the timer. Each tick awaits `onTick(apiFn)`; a busy guard
 *      drops a tick that fires while the previous one is still in flight.
 *
 * Reuses sibling pure helpers: normalizeMessage / dedupByMid / advanceCursor
 * from ./messages.js (M4-07) and unreadReceive from ./unread.js (M4-05).
 * Zero Vue / zero DOM / zero '@' alias; relative imports only.
 */

import { normalizeMessage, dedupByMid, advanceCursor } from './messages.js'
import { unreadReceive } from './unread.js'
import { CHAT_POLL_MS } from '../../../constants/m-chat.js'

/** Preview kind hints written onto the I-17 conversation row. */
export const PREVIEW_KIND = {
  TEXT: 'text',
  IMAGE: 'image',
  FILE: 'file',
  CONTRACT: 'contract',
}

/** Map an I-18 message kind to a preview kind (unknown -> text). */
function previewKindOf(kind) {
  if (kind === PREVIEW_KIND.IMAGE || kind === PREVIEW_KIND.FILE || kind === PREVIEW_KIND.CONTRACT) {
    return kind
  }
  return PREVIEW_KIND.TEXT
}

/** Find the I-17 row for a conversation, or undefined. */
function findConversation(conversations, convId) {
  return conversations.find((c) => c.conversationId === convId)
}

/**
 * One incremental poll round for a single conversation (I-18).
 * @param {object} opts
 * @param {(path:string)=>Promise<*>} opts.apiFn     - raw HTTP caller (path only).
 * @param {number} opts.convId                       - conversation id to poll.
 * @param {number} opts.sinceId                      - cursor; 0 = first (tail) fetch.
 * @param {Array}  opts.messages                     - currently rendered rows (oldest first).
 * @param {Array}  opts.conversations                - I-17 conversation rows (mutated in place).
 * @param {number} opts.currentUserId                - id of the signed-in user.
 * @returns {Promise<{messages:Array, conversations:Array, sinceId:number, error?:Error}>}
 */
export async function pollOnce({ apiFn, convId, sinceId, messages, conversations, currentUserId }) {
  const existing = messages || []
  const rows = conversations || []
  try {
    const payload = await apiFn(`/conversations/${convId}/messages?sinceId=${sinceId}`)
    const raw = payload == null ? [] : Array.isArray(payload) ? payload : payload.messages || []
    const incoming = raw.map(normalizeMessage).filter(Boolean)
    const merged = dedupByMid(existing, incoming)
    const nextSinceId = advanceCursor(merged)
    bumpPreview(rows, convId, incoming, currentUserId)
    return { messages: merged, conversations: rows, sinceId: nextSinceId }
  } catch (err) {
    // Non-fatal (e.g. 404 for a temp conversation whose initiator is someone
    // else): report the error, leave the input state untouched.
    return { messages: existing, conversations: rows, sinceId, error: err }
  }
}

/**
 * Update the I-17 list row for `convId` from the latest incoming message:
 * preview text (lastMessage / lastAt) + unread count.
 *
 * Non-text kinds store a kind hint (`row.lastMessageKind`) instead of raw copy,
 * and leave `row.lastMessage` null — the assembly maps lastMessageKind to
 * CHAT_COPY (PREVIEW_IMAGE / PREVIEW_FILE / PREVIEW_CONTRACT) so this pure
 * module stays free of user-facing copy.
 *
 * Unread only counts incoming messages NOT sent by the current user (my own
 * echoed messages do not bump the red dot).
 *
 * Mutates `conversations` rows in place (Vue-reactive friendly); a no-op when
 * there is no incoming or no matching row.
 */
function bumpPreview(conversations, convId, incoming, currentUserId) {
  if (!incoming.length) return
  const row = findConversation(conversations, convId)
  if (!row) return

  const latest = incoming[incoming.length - 1]
  row.lastMessageKind = previewKindOf(latest.kind)
  if (row.lastMessageKind === PREVIEW_KIND.TEXT) {
    row.lastMessage = latest.body
  } else {
    row.lastMessage = null // caller maps lastMessageKind -> CHAT_COPY preview label
  }
  if (latest.created_at) row.lastAt = latest.created_at

  let foreignCount = 0
  for (const m of incoming) {
    if (m.sender_user_id !== currentUserId) foreignCount++
  }
  for (let i = 0; i < foreignCount; i++) unreadReceive(conversations, convId)
}

/**
 * Timer lifecycle for repeated polling. start() is idempotent (F3: a second
 * start on an already-running poller is a no-op, never a second timer). stop()
 * clears the timer. Each tick awaits `onTick(apiFn)`; a busy guard drops ticks
 * that fire while the previous one is still in flight.
 * @param {object} opts
 * @param {(path:string)=>Promise<*>} opts.apiFn       - raw HTTP caller (forwarded to onTick).
 * @param {number} [opts.intervalMs=CHAT_POLL_MS]       - poll interval in ms.
 * @param {(apiFn:Function)=>Promise<void>} opts.onTick - poll closure; receives apiFn,
 *   typically calling pollOnce with its captured state and writing the result.
 * @returns {{start:()=>void, stop:()=>void, active:boolean}}
 */
export function createPoller({ apiFn, intervalMs = CHAT_POLL_MS, onTick }) {
  let timer = null
  let busy = false

  async function runTick() {
    if (busy) return
    busy = true
    try {
      await onTick(apiFn)
    } finally {
      busy = false
    }
  }

  return {
    start() {
      if (timer != null) return
      timer = setInterval(runTick, intervalMs)
    },
    stop() {
      if (timer != null) clearInterval(timer)
      timer = null
    },
    get active() {
      return timer != null
    },
  }
}
