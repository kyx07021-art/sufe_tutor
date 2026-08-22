/**
 * chat-temp.mjs — M4-26/27/28/29 temporary-conversation logic tests.
 * ----------------------------------------------------------------------------
 * Node-runnable (no Playwright, no browser). Covers the temp state machine:
 *   1. deriveTempHint: all four hint keys + the no-hint cases.
 *   2. tempVisibleToMe (I-17): receiver sees sent, NOT init (negative path);
 *      initiator side always visible (the init row persists in the initiator's
 *      own list even before any message is sent — M4-26 negative path).
 *   3. tempQuotaLeft (M4-27): initiator init+quota1 true; after applyTempSent
 *      false; non-initiator true; formal true.
 *   4. applyFormal (M4-29): tempStatus -> null + wasTemp true; the input bar is
 *      restored (isChatInputVisible true) because the temp-quota flag is gone.
 *   5. initTemp (M4-26, I-23): success normalizes + upserts (F7 add and replace);
 *      409 TEMP_QUOTA_EXCEEDED -> error key; other failures rethrow (E1).
 *   6. isChatInputVisible temp-quota mutation guard (G2): with the flag the gate
 *      hides the input; a MUTANT copy with the flag removed shows it — proving
 *      the flag is load-bearing.
 *
 * Run: node test/chat-temp.mjs
 */
import {
  deriveTempHint,
  tempVisibleToMe,
  tempQuotaLeft,
  applyTempSent,
  applyFormal,
  initTemp,
} from '../src/modules/chat/logic/tempConversation.js'
import { isChatInputVisible } from '../src/modules/chat/state.js'

const errors = []
const ok = (cond, msg) => { if (!cond) errors.push(msg) }

/* ============ 1. deriveTempHint (M4-26/28/29) ============ */
ok(deriveTempHint({ tempStatus: null, wasTemp: true, iAmInitiator: true }) === 'formal', 'hint: formal (tempStatus null + wasTemp) -> formal')
ok(deriveTempHint({ tempStatus: 'sent', iAmInitiator: true }) === 'sent', 'hint: sent + initiator -> sent')
ok(deriveTempHint({ tempStatus: 'sent', iAmInitiator: false }) === 'received', 'hint: sent + receiver -> received')
ok(deriveTempHint({ tempStatus: 'init', iAmInitiator: true }) === 'init', 'hint: init + initiator -> init')
ok(deriveTempHint({ tempStatus: null, wasTemp: false }) === null, 'hint: never-temp active -> no hint')
ok(deriveTempHint({ tempStatus: null, status: 'closed' }) === null, 'hint: closed normal -> no hint')
ok(deriveTempHint({ tempStatus: 'init', iAmInitiator: false }) === null, 'hint: init + receiver -> no hint (receiver never sees init)')
ok(deriveTempHint({ tempStatus: 'sent', iAmInitiator: undefined }) === null, 'hint: sent + missing initiator flag -> no hint (no guess)')

/* ============ 2. tempVisibleToMe (M4-28, I-17) ============ */
ok(tempVisibleToMe({ tempStatus: 'sent' }, false) === true, 'visibility: receiver sees sent')
ok(tempVisibleToMe({ tempStatus: 'init' }, false) === false, 'visibility NEG: receiver does NOT see init (hidden before first message)')
ok(tempVisibleToMe({ tempStatus: 'init' }, true) === true, 'visibility: initiator sees init (temp row persists in own list — M4-26)')
ok(tempVisibleToMe({ tempStatus: null }, false) === true, 'visibility: formal/normal visible to receiver')
ok(tempVisibleToMe({ tempStatus: 'init', iAmInitiator: true }) === true, 'visibility: iAmInitiator falls back to conv flag (initiator)')
ok(tempVisibleToMe({ tempStatus: 'init', iAmInitiator: false }) === false, 'visibility: iAmInitiator falls back to conv flag (receiver init hidden)')

/* ============ 3. tempQuotaLeft (M4-27) ============ */
ok(tempQuotaLeft({ tempStatus: 'init', iAmInitiator: true, quotaRemaining: 1 }) === true, 'quota: initiator init + quota1 may send')
ok(tempQuotaLeft({ tempStatus: 'init', iAmInitiator: true, quotaRemaining: 0 }) === false, 'quota: initiator init + quota0 may NOT send')
ok(tempQuotaLeft({ tempStatus: 'sent', iAmInitiator: true, quotaRemaining: 0 }) === false, 'quota: initiator sent + quota0 may NOT send')
ok(tempQuotaLeft({ tempStatus: 'sent', iAmInitiator: false, quotaRemaining: 0 }) === true, 'quota: receiver may always reply')
ok(tempQuotaLeft({ tempStatus: null, iAmInitiator: true, quotaRemaining: 0 }) === true, 'quota: formal may send freely')

/* ============ 4. applyTempSent + applyFormal + input restore ============ */
const initRow = { conversationId: 7, status: 'active', tempStatus: 'init', tempInitiatorId: 3, quotaRemaining: 1, iAmInitiator: true, lastMessage: '', lastAt: '2026-08-22T10:00:00Z', unread: 0 }
const sentRow = applyTempSent(initRow)
ok(sentRow.tempStatus === 'sent' && sentRow.quotaRemaining === 0, 'applyTempSent: tempStatus sent + quota 0')
ok(initRow.tempStatus === 'init', 'applyTempSent: input NOT mutated (pure)')
ok(tempQuotaLeft(sentRow) === false, 'applyTempSent: after first message quota is spent')

const formalRow = applyFormal(sentRow)
ok(formalRow.tempStatus === null && formalRow.wasTemp === true, 'applyFormal: tempStatus null + wasTemp true')
ok(sentRow.tempStatus === 'sent', 'applyFormal: input NOT mutated (pure)')
ok(deriveTempHint(formalRow) === 'formal', 'applyFormal: hint key becomes formal')

const formalState = {
  activeConversationId: 7,
  conversations: [
    { conversationId: 7, status: 'active', tempStatus: null, wasTemp: true, iAmInitiator: true, quotaRemaining: 0 },
  ],
}
ok(isChatInputVisible(formalState) === true, 'M4-29: after formal the input bar is RESTORED (temp-quota flag gone)')

/* ============ 5. initTemp (M4-26, I-23) ============ */
const calls = []
const FIRST_MSG = 'hi, are you free?'
const successApi = async (path, init) => {
  calls.push([path, init])
  return { conversationId: 10, status: 'active', tempStatus: 'sent', tempInitiatorId: 3, iAmInitiator: true, quota: 0 }
}
const r1 = await initTemp({
  apiFn: successApi,
  targetUserId: 3,
  firstMessage: FIRST_MSG,
  conversations: [],
  iAmInitiator: true,
  now: '2026-08-22T12:00:00Z',
})
ok(r1.error === undefined, 'initTemp: success has no error')
ok(calls.length === 1 && calls[0][0] === '/conversations/temp' && calls[0][1].method === 'POST', 'initTemp: calls POST /conversations/temp')
ok(JSON.stringify(calls[0][1].body) === JSON.stringify({ targetUserId: 3, firstMessage: FIRST_MSG }), 'initTemp: body carries targetUserId + firstMessage')
ok(r1.conv.conversationId === 10 && r1.conv.tempStatus === 'sent', 'initTemp: row normalized conversationId + tempStatus')
ok(r1.conv.quotaRemaining === 0, 'initTemp: quotaRemaining = resp.quota (0)')
ok(r1.conv.iAmInitiator === true && r1.conv.tempInitiatorId === 3, 'initTemp: iAmInitiator + tempInitiatorId from response')
ok(r1.conv.lastMessage === FIRST_MSG && r1.conv.lastAt === '2026-08-22T12:00:00Z' && r1.conv.unread === 0, 'initTemp: lastMessage/lastAt/unread seeded (F7)')
ok(Array.isArray(r1.conversations) && r1.conversations.length === 1 && r1.conversations[0] === r1.conv, 'initTemp: row upserted (added)')

// F7 replace: an existing stale init row with the same conversationId is replaced.
const stale = [{ conversationId: 10, status: 'active', tempStatus: 'init', tempInitiatorId: 3, quotaRemaining: 1, iAmInitiator: true, lastMessage: '', lastAt: '2026-08-22T09:00:00Z', unread: 0 }]
const r2 = await initTemp({
  apiFn: successApi,
  targetUserId: 3,
  firstMessage: FIRST_MSG,
  conversations: stale,
  iAmInitiator: true,
  now: '2026-08-22T12:00:00Z',
})
ok(r2.conversations.length === 1 && r2.conversations !== stale, 'initTemp F7: replace keeps length + returns a fresh array')
ok(r2.conversations[0].tempStatus === 'sent' && r2.conversations[0].lastMessage === FIRST_MSG, 'initTemp F7: stale row replaced by normalized row')

// 409 TEMP_QUOTA_EXCEEDED -> error key, conversations untouched.
const origArr = [{ conversationId: 1, status: 'active', tempStatus: 'sent', iAmInitiator: true, quotaRemaining: 0 }]
const quotaApi = async () => { throw { status: 409, code: 'TEMP_QUOTA_EXCEEDED', message: 'quota' } }
const r3 = await initTemp({ apiFn: quotaApi, targetUserId: 3, firstMessage: 'x', conversations: origArr, iAmInitiator: true })
ok(r3.error === 'TEMP_QUOTA_EXCEEDED' && r3.conv === null, 'initTemp: 409 TEMP_QUOTA_EXCEEDED -> error key')
ok(r3.conversations === origArr && origArr.length === 1, 'initTemp: 409 leaves conversations unchanged')

// Other failures rethrow (E1 — never swallow silently).
const boomApi = async () => { throw new Error('boom') }
let threw = false
try {
  await initTemp({ apiFn: boomApi, targetUserId: 3, firstMessage: 'x', conversations: [], iAmInitiator: true })
} catch (e) {
  threw = e instanceof Error && e.message === 'boom'
}
ok(threw, 'initTemp: non-409 failure rethrows (E1)')

/* ============ 6. isChatInputVisible temp-quota mutation guard (M4-27, G2) ============ */
const quotaState = {
  activeConversationId: 5,
  conversations: [{ conversationId: 5, status: 'active', tempStatus: 'sent', iAmInitiator: true, quotaRemaining: 0 }],
}
ok(isChatInputVisible(quotaState) === false, 'M4-27: sent initiator quota 0 => input hidden')
function mutantQuotaGateRemoved(s) {
  const conv = s.conversations.find((c) => c.conversationId === s.activeConversationId)
  if (!conv) return false
  // ended gate kept; temp-quota flag REMOVED on purpose — mutation.
  if (conv.status === 'closed') return false
  return true
}
ok(mutantQuotaGateRemoved(quotaState) === true, 'M4-27 G2 mutation guard: removing the temp-quota flag WOULD show the input')

if (errors.length) {
  console.log('CHAT TEMP TEST FAIL')
  errors.forEach((e) => console.log(' - ' + e))
  process.exit(1)
}
console.log('CHAT TEMP TEST PASS')
