/**
 * messages.js - M4-07 message loading / rendering helpers (pure logic).
 * ---------------------------------------------------------------------------
 * Cursor-based message loading for the C2 conversation pane (plan M4-07:
 * "recent N messages cursor" / "long-conversation tail visible / no loss
 * window"). Sibling to timeFormat/unread/colorFilter: zero DOM, zero Vue, zero
 * `@` alias, zero import dependencies — importable from plain Node for tests.
 *
 * I-18 `GET /api/conversations/:id/messages?sinceId=N` returns
 *   { conversation, messages: [{ id, sender_user_id, kind, name, body, thumb,
 *   created_at }] }
 * with `kind` one of 'text' | 'image' | 'file' | 'contract'; sinceId=0 fetches
 * the most recent N messages (the tail).
 *
 * Exports:
 *   normalizeMessage(raw)          -> normalized row (C3: undefined/null guarded)
 *   dedupByMid(existing, incoming) -> merged rows, no duplicate `id`, last
 *                                     occurrence wins (I-18 data-mid/seq dedup)
 *   sliceTail(rows, max)           -> keep the most recent `max` rows in order
 *                                     (long-conversation tail, no loss window)
 *   advanceCursor(rows)            -> sinceId = max numeric id, or 0 when empty
 *   hasMore(rows, pageSize)        -> true when a full page of rows was returned
 */

/** Allowed message kinds (I-18). Anything else normalizes to 'text'. */
const KINDS = new Set(['text', 'image', 'file', 'contract'])

/** Coerce a raw id to a non-negative integer; missing/invalid -> 0. */
function toId(value) {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0
}

/** Coerce a raw sender id to a Number, or null when missing/invalid. */
function toSenderId(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** Coerce a field to a string (C3: null/undefined -> ''). */
function toString(value) {
  return value == null ? '' : String(value)
}

/**
 * Normalize one raw I-18 message row into the shape the chat UI consumes.
 * Missing/null/undefined fields are replaced with safe defaults (C3). Unknown
 * or missing `kind` falls back to 'text'. Returns null for non-object input so
 * callers can `.filter(Boolean)` over API payloads.
 * @param {*} raw - raw message row from I-18.
 * @returns {object|null} normalized row, or null for non-object input.
 */
export function normalizeMessage(raw) {
  if (raw == null || typeof raw !== 'object') return null
  return {
    id: toId(raw.id),
    sender_user_id: toSenderId(raw.sender_user_id),
    kind: KINDS.has(raw.kind) ? raw.kind : 'text',
    name: toString(raw.name),
    body: toString(raw.body),
    thumb: toString(raw.thumb),
    created_at: toString(raw.created_at),
  }
}

/**
 * Merge `incoming` into `existing` with no duplicate `id` (I-18 data-mid/seq
 * dedup semantics; M4-32 polling dedup). The LAST occurrence of an id wins —
 * its row replaces any earlier row with the same id — while each id keeps its
 * FIRST-seen position so ordering stays stable. Returns a NEW array; inputs
 * are not mutated. Null rows (normalizeMessage on non-object input) are
 * skipped so the result never contains nulls.
 * @param {Array} existing - currently rendered rows (oldest first).
 * @param {Array} incoming - freshly loaded rows (oldest first).
 * @returns {Array} merged rows with unique ids.
 */
export function dedupByMid(existing, incoming) {
  const seen = new Map()
  for (const row of existing) {
    if (row == null) continue
    seen.set(row.id, row)
  }
  for (const row of incoming) {
    if (row == null) continue
    seen.set(row.id, row)
  }
  return Array.from(seen.values())
}

/**
 * Keep the most recent `max` rows, preserving order (oldest first). Dropping
 * the head never drops a NEWER message: the kept slice is contiguous, so the
 * visible tail has no loss window. `max` is floored; non-finite/negative
 * values yield an empty slice. Returns a copy (never mutates `rows`).
 * @param {Array} rows - ordered rows (oldest first).
 * @param {number} max - maximum number of rows to keep.
 * @returns {Array} the last `max` rows in original order.
 */
export function sliceTail(rows, max) {
  const n = Number.isFinite(max) ? Math.max(0, Math.floor(max)) : 0
  if (n === 0 || rows.length === 0) return []
  if (rows.length <= n) return rows.slice()
  return rows.slice(rows.length - n)
}

/**
 * Advance the sinceId cursor to the largest numeric message id in `rows` (the
 * newest id; I-18 sinceId=N fetches messages AFTER N). Returns 0 for an empty
 * or non-numeric set so the first call fetches the most recent page.
 * @param {Array} rows - normalized message rows.
 * @returns {number} max numeric id, or 0.
 */
export function advanceCursor(rows) {
  let max = 0
  for (const row of rows) {
    if (row == null) continue
    const n = Number(row.id)
    if (Number.isFinite(n) && n > max) max = n
  }
  return max
}

/**
 * Whether more (older) messages exist. Heuristic over the page contract: when
 * a request returned a full page (`pageSize` rows) there is likely an earlier
 * page; a short page means the head was reached. A non-positive/non-finite
 * pageSize is always false.
 * @param {Array} rows - rows returned by the last request.
 * @param {number} pageSize - page size used for that request.
 * @returns {boolean} true when the list is full and more may be loadable.
 */
export function hasMore(rows, pageSize) {
  const n = Number(pageSize)
  if (!Number.isFinite(n) || n <= 0) return false
  return (rows == null ? 0 : rows.length) >= n
}
