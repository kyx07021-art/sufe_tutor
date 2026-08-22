/**
 * chat-messages.mjs - M4-07 message loading/rendering pure-logic + SFC guards.
 * ----------------------------------------------------------------------------
 * Node-runnable (no Playwright, no browser). Covers:
 *   1. normalizeMessage: C3 field guards (missing/null/undefined -> defaults),
 *      kind coercion, non-object -> null.
 *   2. dedupByMid: duplicate `id` removed, LAST occurrence wins, order stable,
 *      unique ids kept, null rows skipped. Mutation guard: without dedup the
 *      merged list would render duplicates (length would not shrink).
 *   3. sliceTail: keeps the most recent N rows, order preserved, no loss window
 *      (every dropped row is older than every kept row), full/empty passthrough.
 *   4. advanceCursor: max numeric id, 0 for empty / non-numeric.
 *   5. hasMore: full page -> true, short/empty page -> false, bad pageSize -> false.
 *   6. SFC: ChatMessageList.vue parses; imports the four bubble components;
 *      references CHAT_COPY.MESSAGES_LOADING / LOAD_MORE and the `load-more`
 *      emit; zero CJK anywhere in the file (contract 6).
 *
 * Run: node test/chat-messages.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse } from '@vue/compiler-sfc'

import {
  normalizeMessage,
  dedupByMid,
  sliceTail,
  advanceCursor,
  hasMore,
} from '../src/modules/chat/logic/messages.js'

const errors = []
const ok = (cond, msg) => { if (!cond) errors.push(msg) }

/* ============ 1. normalizeMessage ============ */
const full = normalizeMessage({
  id: 42, sender_user_id: 7, kind: 'text', name: 'a', body: 'hi', thumb: 't.png', created_at: '2026-08-22T10:00:00Z',
})
ok(full && full.id === 42 && full.sender_user_id === 7 && full.kind === 'text', 'normalize: full row preserved (id/sender/kind)')
ok(full.body === 'hi' && full.thumb === 't.png' && full.created_at === '2026-08-22T10:00:00Z', 'normalize: full row preserved (body/thumb/created_at)')

const missing = normalizeMessage({ id: 1 })
ok(missing.id === 1, 'normalize: id kept')
ok(missing.sender_user_id === null, 'normalize: missing sender_user_id -> null')
ok(missing.kind === 'text', 'normalize: missing kind -> text')
ok(missing.name === '' && missing.body === '' && missing.thumb === '' && missing.created_at === '', 'normalize: missing strings -> empty string')

ok(normalizeMessage({ kind: 'image' }).kind === 'image', 'normalize: image kind kept')
ok(normalizeMessage({ kind: 'file' }).kind === 'file', 'normalize: file kind kept')
ok(normalizeMessage({ kind: 'contract' }).kind === 'contract', 'normalize: contract kind kept')
ok(normalizeMessage({ kind: 'bogus' }).kind === 'text', 'normalize: unknown kind coerced to text')

ok(normalizeMessage(undefined) === null, 'normalize: undefined -> null')
ok(normalizeMessage(null) === null, 'normalize: null -> null')
ok(normalizeMessage('x') === null, 'normalize: non-object -> null')

/* ============ 2. dedupByMid ============ */
const base = [normalizeMessage({ id: 1 }), normalizeMessage({ id: 2 })]
const inc = [normalizeMessage({ id: 2, body: 'updated' }), normalizeMessage({ id: 3 })]
const merged = dedupByMid(base, inc)
ok(merged.length === 3, 'dedup: duplicate id removed (3 of 4)')
ok(merged[0].id === 1 && merged[1].id === 2 && merged[2].id === 3, 'dedup: order stable (first-seen positions kept)')
ok(merged[1].body === 'updated', 'dedup: last occurrence wins (value replaced)')

const unique = dedupByMid([{ id: 1 }, { id: 2 }], [{ id: 3 }, { id: 4 }])
ok(unique.length === 4, 'dedup: unique ids all kept')

const within = dedupByMid([], [{ id: 5 }, { id: 5, body: 'new' }])
ok(within.length === 1 && within[0].body === 'new', 'dedup: duplicate within a single input deduped')

const passthrough = dedupByMid([{ id: 1 }], [])
ok(passthrough.length === 1, 'dedup: empty incoming passthrough')
ok(passthrough !== base, 'dedup: returns a new array (no mutation)')

const skippedNull = dedupByMid([null, { id: 1 }], [null, { id: 2 }])
ok(skippedNull.length === 2 && skippedNull[0].id === 1 && skippedNull[1].id === 2, 'dedup: null rows skipped')

// G2 mutation guard: a version WITHOUT dedup would keep the duplicate, so the
// merged length would equal the raw combined length instead of shrinking.
const rawLen = base.length + inc.length
ok(merged.length < rawLen, 'dedup mutation guard: dedup shrinks duplicated input (no-dupe version would render duplicates)')

/* ============ 3. sliceTail ============ */
const rows10 = Array.from({ length: 10 }, (_, i) => ({ id: i + 1 }))
const tail = sliceTail(rows10, 4)
ok(tail.length === 4, 'sliceTail: keeps most recent N')
ok(tail[0].id === 7 && tail[3].id === 10, 'sliceTail: keeps the newest tail in order')
ok(tail[0].id >= rows10[0].id, 'sliceTail: dropped rows are all older (no loss window)')
ok(sliceTail(rows10, 99).length === 10, 'sliceTail: max >= length passthrough')
ok(sliceTail(rows10, 99) !== rows10, 'sliceTail: passthrough returns a copy')
ok(sliceTail([], 5).length === 0, 'sliceTail: empty input')
ok(sliceTail(rows10, 0).length === 0, 'sliceTail: max 0 -> empty')
ok(sliceTail(rows10, -3).length === 0, 'sliceTail: negative max -> empty')
ok(sliceTail(rows10, NaN).length === 0, 'sliceTail: NaN max -> empty')

/* ============ 4. advanceCursor ============ */
ok(advanceCursor([{ id: 1 }, { id: 7 }, { id: 3 }]) === 7, 'cursor: max numeric id')
ok(advanceCursor([]) === 0, 'cursor: empty -> 0')
ok(advanceCursor([{ id: NaN }, null]) === 0, 'cursor: non-numeric rows -> 0')

/* ============ 5. hasMore ============ */
ok(hasMore([1, 2, 3], 3) === true, 'hasMore: full page -> true')
ok(hasMore([1, 2], 3) === false, 'hasMore: short page -> false')
ok(hasMore([], 3) === false, 'hasMore: empty -> false')
ok(hasMore([1], 0) === false, 'hasMore: pageSize 0 -> false')
ok(hasMore([1], NaN) === false, 'hasMore: NaN pageSize -> false')

/* ============ 6. SFC parse + contract-6 guards ============ */
const sfcPath = fileURLToPath(new URL('../src/modules/chat/components/ChatMessageList.vue', import.meta.url))
const sfcSrc = readFileSync(sfcPath, 'utf8')
const parsed = parse(sfcSrc, { filename: 'ChatMessageList.vue' })
ok(parsed.errors.length === 0, 'SFC: ChatMessageList.vue parses clean')
ok(/ChatBubble\.vue/.test(sfcSrc) && /ChatImageBubble\.vue/.test(sfcSrc), 'SFC: imports ChatBubble + ChatImageBubble')
ok(/ChatFileBubble\.vue/.test(sfcSrc) && /ChatSpecialBubble\.vue/.test(sfcSrc), 'SFC: imports ChatFileBubble + ChatSpecialBubble')
ok(/CHAT_COPY\.MESSAGES_LOADING/.test(sfcSrc) && /CHAT_COPY\.LOAD_MORE/.test(sfcSrc), 'SFC: references MESSAGES_LOADING + LOAD_MORE')
ok(/'load-more'/.test(sfcSrc), 'SFC: emits load-more')
ok(!/[一-鿿]/.test(sfcSrc), 'SFC: zero CJK anywhere (contract 6)')

if (errors.length) {
  console.log('CHAT MESSAGES TEST FAIL')
  errors.forEach((e) => console.log(' - ' + e))
  process.exit(1)
}
console.log('CHAT MESSAGES TEST PASS')
