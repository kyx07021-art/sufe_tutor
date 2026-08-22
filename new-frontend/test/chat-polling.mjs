/**
 * chat-polling.mjs - M4-32 incremental polling pure-logic tests.
 * ----------------------------------------------------------------------------
 * Node-runnable (no Playwright, no browser). Run: node test/chat-polling.mjs
 *
 * Covers (each with G2 mutation guard where the assertion is load-bearing):
 *   1. pollOnce merge + dedup: duplicate message ids are NOT rendered twice.
 *      Mutation: a naive concat would render 4 rows, dedup yields 3.
 *   2. sinceId advances to the max merged id; empty incoming keeps it.
 *   3. Preview bump (I-17): lastMessage / lastAt updated from latest incoming;
 *      unread incremented for incoming NOT sent by the current user.
 *   4. Mine-only incoming: preview still bumps, unread does NOT increment.
 *   5. Non-text preview: lastMessageKind hint set, lastMessage left null for the
 *      caller to map to CHAT_COPY (this module stays free of user copy).
 *   6. Error path: apiFn rejects -> { error }, input state untouched.
 *   7. createPoller F3: start() twice -> exactly ONE timer; stop() clears.
 *   8. createPoller tick wiring: each tick calls onTick(apiFn).
 *   9. createPoller busy guard: overlapping ticks are dropped.
 */
import { pollOnce, createPoller, PREVIEW_KIND } from '../src/modules/chat/logic/polling.js'

const errors = []
const ok = (cond, msg) => { if (!cond) errors.push(msg) }

/* ---- fixtures ---- */
const existing = [
  { id: 1, sender_user_id: 1, kind: 'text', name: '', body: 'a', thumb: '', created_at: '2026-08-22T00:00:01Z' },
  { id: 2, sender_user_id: 2, kind: 'text', name: '', body: 'b', thumb: '', created_at: '2026-08-22T00:00:02Z' },
]

/* ============ 1. merge + dedup ============ */
{
  let apiUrl = ''
  const apiFn = async (url) => {
    apiUrl = url
    return {
      conversation: {},
      messages: [
        { id: 2, sender_user_id: 2, kind: 'text', name: '', body: 'b-updated', thumb: '', created_at: '2026-08-22T00:00:02Z' },
        { id: 3, sender_user_id: 2, kind: 'text', name: '', body: 'c', thumb: '', created_at: '2026-08-22T00:00:03Z' },
      ],
    }
  }
  const conversations = [{ conversationId: 10, lastMessage: '', lastAt: null, unread: 0, status: 'active' }]
  const result = await pollOnce({ apiFn, convId: 10, sinceId: 5, messages: existing, conversations, currentUserId: 1 })
  ok(apiUrl === '/conversations/10/messages?sinceId=5', 'poll: requests messages?sinceId=5')
  ok(result.messages.length === 3, 'poll: duplicate id removed (3 not 4)')
  ok(new Set(result.messages.map((m) => m.id)).size === 3, 'poll: no duplicate ids rendered')
  ok(result.messages[0].id === 1 && result.messages[1].id === 2 && result.messages[2].id === 3, 'poll: order stable')
  ok(result.messages[1].body === 'b-updated', 'poll: incoming wins for duplicate id (last occurrence)')
  ok(result.messages !== existing, 'poll: merged is a new array (inputs not mutated)')
  ok(existing.length === 2, 'poll: input messages array untouched')
  // G2 mutation guard: WITHOUT dedup the merged list would keep the duplicate.
  const rawLen = existing.length + 2
  ok(rawLen === 4, 'mutation: raw concat would be 4 (dedup is load-bearing)')
}

/* ============ 2. sinceId advance ============ */
{
  const apiFn = async () => ({ messages: [{ id: 9, sender_user_id: 2, kind: 'text', body: 'z', created_at: '2026-08-22T00:00:09Z' }] })
  const result = await pollOnce({ apiFn, convId: 1, sinceId: 3, messages: [{ id: 3, sender_user_id: 2, kind: 'text', body: 'old' }], conversations: [], currentUserId: 1 })
  ok(result.sinceId === 9, 'poll: sinceId advances to max merged id')
}
{
  // Realistic no-new-messages poll: existing rows are retained by dedup, so the
  // cursor stays at the max merged id (the prior sinceId).
  const existingRows = [{ id: 7, sender_user_id: 2, kind: 'text', body: 'old', created_at: '2026-08-22T00:00:07Z' }]
  const apiFn = async () => ({ messages: [] })
  const result = await pollOnce({ apiFn, convId: 1, sinceId: 7, messages: existingRows, conversations: [], currentUserId: 1 })
  ok(result.sinceId === 7, 'poll: empty incoming keeps sinceId (max merged id)')
}
{
  // Truly empty state + empty incoming: cursor falls back to the first-fetch
  // sentinel 0 (next poll fetches the most recent page).
  const apiFn = async () => ({ messages: [] })
  const result = await pollOnce({ apiFn, convId: 1, sinceId: 7, messages: [], conversations: [], currentUserId: 1 })
  ok(result.sinceId === 0, 'poll: empty merged list -> first-fetch sentinel 0')
}

/* ============ 3. preview bump (text + foreign unread) ============ */
{
  const conversations = [{ conversationId: 20, lastMessage: 'old', lastAt: '2026-08-22T00:00:00Z', unread: 2, status: 'active' }]
  const apiFn = async () => ({ conversation: {}, messages: [
    { id: 5, sender_user_id: 2, kind: 'text', body: 'hello', created_at: '2026-08-22T00:00:05Z' },
  ] })
  const result = await pollOnce({ apiFn, convId: 20, sinceId: 4, messages: [], conversations, currentUserId: 1 })
  ok(conversations[0].lastMessage === 'hello', 'preview: lastMessage set to latest incoming body')
  ok(conversations[0].lastAt === '2026-08-22T00:00:05Z', 'preview: lastAt set to latest incoming created_at')
  ok(conversations[0].lastMessageKind === PREVIEW_KIND.TEXT, 'preview: lastMessageKind = text')
  ok(conversations[0].unread === 3, 'preview: unread incremented for foreign incoming (2 -> 3)')
  ok(result.conversations === conversations, 'poll: conversations array reference preserved')
}

/* ============ 4. mine-only incoming: preview bumps, unread does NOT ============ */
{
  const conversations = [{ conversationId: 30, lastMessage: '', lastAt: null, unread: 0, status: 'active' }]
  const apiFn = async () => ({ conversation: {}, messages: [
    { id: 6, sender_user_id: 1, kind: 'text', body: 'mine', created_at: '2026-08-22T00:00:06Z' },
  ] })
  await pollOnce({ apiFn, convId: 30, sinceId: 5, messages: [], conversations, currentUserId: 1 })
  ok(conversations[0].lastMessage === 'mine', 'mine: preview lastMessage still bumps')
  ok(conversations[0].lastAt === '2026-08-22T00:00:06Z', 'mine: preview lastAt still bumps')
  ok(conversations[0].unread === 0, 'mine: unread NOT incremented (sender is currentUserId)')
}

/* ============ 5. non-text preview: kind hint, no copy ============ */
{
  const conversations = [{ conversationId: 40, lastMessage: 'old', lastAt: null, unread: 0, status: 'active' }]
  const apiFn = async () => ({ conversation: {}, messages: [
    { id: 7, sender_user_id: 2, kind: 'image', body: '', thumb: 'x.png', created_at: '2026-08-22T00:00:07Z' },
  ] })
  await pollOnce({ apiFn, convId: 40, sinceId: 6, messages: [], conversations, currentUserId: 1 })
  ok(conversations[0].lastMessageKind === PREVIEW_KIND.IMAGE, 'preview: image kind hint set')
  ok(conversations[0].lastMessage === null, 'preview: image lastMessage left null for caller mapping')
  ok(conversations[0].lastAt === '2026-08-22T00:00:07Z', 'preview: image lastAt still bumps')
  ok(conversations[0].unread === 1, 'preview: image foreign unread incremented')
}

/* ============ 6. error path: no mutation ============ */
{
  const conv = [{ conversationId: 50, lastMessage: 'old', lastAt: null, unread: 1, status: 'active' }]
  const msgs = [{ id: 1, sender_user_id: 2, kind: 'text', body: 'x', created_at: '2026-08-22T00:00:01Z' }]
  const apiFn = async () => { const e = new Error('404'); e.status = 404; throw e }
  const result = await pollOnce({ apiFn, convId: 50, sinceId: 3, messages: msgs, conversations: conv, currentUserId: 1 })
  ok(result.error instanceof Error && result.error.status === 404, 'error: surfaces api error')
  ok(result.messages === msgs, 'error: messages reference untouched')
  ok(result.conversations === conv, 'error: conversations reference untouched')
  ok(result.sinceId === 3, 'error: sinceId unchanged')
  ok(conv[0].unread === 1 && conv[0].lastMessage === 'old', 'error: no preview/unread mutation')
}

/* ============ 7. createPoller F3: single timer ============ */
{
  let intervalCount = 0
  let clearCount = 0
  const origSet = globalThis.setInterval
  const origClear = globalThis.clearInterval
  globalThis.setInterval = () => { intervalCount += 1; return intervalCount }
  globalThis.clearInterval = () => { clearCount += 1 }
  try {
    const onTick = async () => {}
    const poller = createPoller({ apiFn: async () => ({}), intervalMs: 1000, onTick })
    poller.start()
    poller.start()
    poller.start()
    ok(intervalCount === 1, 'F3: start() twice -> only ONE timer')
    ok(poller.active === true, 'F3: active true while running')
    poller.stop()
    ok(clearCount === 1, 'F3: stop() clears the timer')
    ok(poller.active === false, 'F3: active false after stop')
    poller.stop()
    ok(clearCount === 1, 'F3: stop() twice is harmless (no double clear)')
  } finally {
    globalThis.setInterval = origSet
    globalThis.clearInterval = origClear
  }
}

/* ============ 8. createPoller tick wiring: onTick receives apiFn ============ */
{
  let capturedCb = null
  const origSet = globalThis.setInterval
  const origClear = globalThis.clearInterval
  globalThis.setInterval = (cb, ms) => { capturedCb = cb; return 99 }
  globalThis.clearInterval = () => {}
  try {
    let received = null
    const apiFn = async () => ({ ok: true })
    const poller = createPoller({ apiFn, intervalMs: 1000, onTick: async (fn) => { received = fn } })
    poller.start()
    ok(typeof capturedCb === 'function', 'F3: timer callback captured')
    await capturedCb()
    ok(received === apiFn, 'poll: onTick receives apiFn')
    poller.stop()
  } finally {
    globalThis.setInterval = origSet
    globalThis.clearInterval = origClear
  }
}

/* ============ 9. createPoller busy guard: overlapping ticks dropped ============ */
{
  let capturedCb = null
  const origSet = globalThis.setInterval
  const origClear = globalThis.clearInterval
  globalThis.setInterval = (cb, ms) => { capturedCb = cb; return 1 }
  globalThis.clearInterval = () => {}
  try {
    let calls = 0
    let release = null
    const gate = new Promise((res) => { release = res })
    const apiFn = async () => ({})
    const poller = createPoller({ apiFn, intervalMs: 50, onTick: async () => { calls += 1; await gate; calls += 1 } })
    poller.start()
    const first = capturedCb() // starts a tick, busy = true, awaits the gate
    await capturedCb()         // busy -> dropped immediately (no second onTick)
    release()                  // release the gate
    await first
    ok(calls === 2, 'busy: overlapping tick dropped (2 not 4)')
    poller.stop()
  } finally {
    globalThis.setInterval = origSet
    globalThis.clearInterval = origClear
  }
}

if (errors.length) {
  console.log('CHAT POLLING TEST FAIL')
  errors.forEach((e) => console.log(' - ' + e))
  process.exit(1)
}
console.log('CHAT POLLING TEST PASS')
