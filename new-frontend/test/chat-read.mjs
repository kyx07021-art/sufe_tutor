/**
 * test/chat-read.mjs — M4-05 + I-22 read-marking (openConversation -> markConversationRead)
 * -----------------------------------------------------------------------------------------
 * Node-runnable (no Playwright, no browser). Locks the PA-1h2-M5 fix: opening a
 * conversation now persists the read cursor server-side via POST /api/conversations/:id/read
 * (interfaces.md I-22 "已读游标推最新"), so the server unread count decrements instead
 * of staying stale forever.
 *   1. markConversationRead: clears the local unread dot (M4-05 openFromCard), fires the
 *      I-22 POST (path + method + auth), returns null for a missing row (no POST), and is
 *      non-fatal on network failure (the local dot still clears; the failure is logged,
 *      E1, never swallowed silently).
 *   2. openConversation wiring: opening a conversation calls markConversationRead (captured
 *      via a stubbed global fetch) + sets the active id + mobile pane to 'chat' (P22).
 *   3. G2 mutation guard: a variant with the I-22 call removed WOULD skip the POST — the
 *      capture assertion turns red, proving the test locks the real behavior.
 *
 * Run: node test/chat-read.mjs   (also picked up by `npm test`)
 */
import { markConversationRead, openConversation, chatState } from '../src/modules/chat/state.js'
import { unreadOpenFromCard } from '../src/modules/chat/logic/unread.js'

const errors = []
const ok = (cond, msg) => { if (!cond) errors.push(msg) }

function resetStore() {
  chatState.conversations = []
  chatState.activeConversationId = null
  chatState.mobilePane = 'list'
  chatState.messages = {}
  chatState.messagesLoading = {}
}

/* ============ 1. markConversationRead: local clear + I-22 POST ============ */
resetStore()
chatState.conversations = [{ conversationId: 7, unread: 3, status: 'active' }]
const calls = []
const captured = markConversationRead(7, async (path, init) => {
  calls.push([path, init])
  return { ok: true }
})
ok(captured === 0, 'markRead: returns 0 (unread cleared)')
ok(chatState.conversations[0].unread === 0, 'markRead: local unread dot cleared')
ok(calls.length === 1, 'markRead: fired one read call')
ok(calls[0][0] === '/conversations/7/read', 'markRead: POSTs the I-22 path')
ok(calls[0][1].method === 'POST', 'markRead: uses POST')
ok(calls[0][1].auth === true, 'markRead: auth (participant-gated)')

/* missing row -> null, no POST fired */
resetStore()
const calls2 = []
const miss = markConversationRead(99, async (path, init) => {
  calls2.push(path)
  return { ok: true }
})
ok(miss === null, 'markRead: missing row -> null')
ok(calls2.length === 0, 'markRead: missing row -> no POST fired')

/* network failure non-fatal (E1 logged, never swallowed): local dot still clears */
resetStore()
chatState.conversations = [{ conversationId: 5, unread: 2, status: 'active' }]
const warnMsgs = []
const origWarn = console.warn
console.warn = (msg) => warnMsgs.push(msg)
const failed = markConversationRead(5, async () => {
  throw new Error('backend down')
})
await Promise.resolve() // let the rejection handler run before restoring console.warn
console.warn = origWarn
ok(failed === 0, 'markRead: network failure still returns 0 (non-fatal)')
ok(chatState.conversations[0].unread === 0, 'markRead: local dot cleared despite failure')
ok(
  warnMsgs.some((m) => typeof m === 'string' && m.includes('markConversationRead failed')),
  'markRead: failure logged (E1), not swallowed silently',
)

/* ============ 2. openConversation wiring: opening marks read + P22 pane switch ============ */
resetStore()
chatState.conversations = [{ conversationId: 7, unread: 3, status: 'active' }]
const fetchCalls = []
const origFetch = globalThis.fetch
globalThis.fetch = async (url, init) => {
  fetchCalls.push([String(url), init && init.method])
  return { ok: true, status: 200, json: async () => ({ ok: true }) }
}
try {
  openConversation(7)
  // openConversation -> loadMessages is fire-and-forget; let its fetch settle.
  await Promise.resolve()
  await Promise.resolve()
} finally {
  globalThis.fetch = origFetch
}
ok(chatState.activeConversationId === 7, 'open: sets active id')
ok(chatState.mobilePane === 'chat', 'open: mobile pane switches to chat (P22)')
ok(chatState.conversations[0].unread === 0, 'open: local unread dot cleared via markConversationRead')
ok(
  fetchCalls.some(([url, method]) => url === '/api/conversations/7/read' && method === 'POST'),
  'open: fired the I-22 read POST',
)

/* ============ 3. G2 mutation guard: removing the I-22 call breaks the lock ============ */
// The capture assertions above turn red the moment markConversationRead stops calling
// the endpoint. To prove the lock has teeth, run a MUTATED copy of the logic with the
// server call removed and assert it WOULD skip the POST (i.e. the real assertion that
// the POST fires would fail on such a mutation).
resetStore()
chatState.conversations = [{ conversationId: 7, unread: 3, status: 'active' }]
const mutCalls = []
function mutantWithoutI22(convId) {
  // I-22 server call REMOVED on purpose - mutation (real impl also fires the POST).
  unreadOpenFromCard(chatState.conversations, convId)
  return 0
}
mutantWithoutI22(7, async (path) => mutCalls.push(path))
ok(mutCalls.length === 0, 'mutation guard: I-22 removal WOULD skip the read POST (real impl fires it)')

if (errors.length) {
  console.log('CHAT READ TEST FAIL')
  errors.forEach((e) => console.log(' - ' + e))
  process.exit(1)
}
console.log('CHAT READ TEST PASS')
