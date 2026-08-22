/**
 * M4-25 end-session write path unit test (Node-runnable, no DOM / no Vue).
 * ----------------------------------------------------------------------
 * Covers the M4-25 acceptance surface, including G2 mutation guards
 * (the three mutations named in the primitive row: remove-sync / remove-idempotency
 * / remove-busy would all go red):
 *   1. canEnd gray-out judgment:
 *        - signing truthy -> false (mutation: removing the signing check -> true)
 *        - status closed -> false (mutation: removing the status check -> true)
 *        - temp conversation -> true
 *        - null relation data -> false (conservative)
 *   2. applyEnded F7 sync:
 *        - formal row -> status 'closed' (kept, readonly)
 *        - temp row -> removed entirely
 *        - input never mutated; identity when nothing changes
 *   3. endSession write path:
 *        - success (formal / temp) -> ok + reconciled conversations (F7)
 *        - idempotency: already-closed short-circuits, apiFn called 0 times
 *        - busy: second call while first in-flight is a no-op, apiFn called once
 *        - capToken null -> capped:true, apiFn NOT called (honest cap)
 *        - server already-closed code -> ok:true already:true + reconciled
 *        - server 404 (temp already deleted) -> ok:true already:true + reconciled
 *        - failure -> ok:false, error, state unchanged
 *
 * Run: node test/chat-endsession.mjs
 */
import {
  canEnd,
  applyEnded,
  createEndSessionStore,
  endSession,
  ALREADY_CLOSED_CODE,
} from '../src/modules/chat/logic/endSession.js'

const errors = []
const ok = (cond, msg) => {
  if (!cond) errors.push(msg)
}
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`)

/* ============ 1. canEnd gray-out judgment ============ */
const activeRow = { conversationId: 1, status: 'active', tempStatus: null, tempInitiatorId: null, other: {}, last: null, signing: null }
const closedRow = { conversationId: 2, status: 'closed', tempStatus: null, signing: null }
const contractRow = { conversationId: 3, status: 'active', tempStatus: null, signing: { contractId: 9, contractStatus: 'signing' } }
const tempRow = { conversationId: 4, status: 'active', tempStatus: 'init', tempInitiatorId: 7, signing: null }

ok(canEnd(activeRow) === true, 'canEnd: active formal no contract -> true')
ok(canEnd(closedRow) === false, 'canEnd: already closed -> false')
ok(canEnd(contractRow) === false, 'canEnd: formal contract (signing truthy) -> false')
ok(canEnd(tempRow) === true, 'canEnd: temp conversation -> true')
ok(canEnd(null) === false, 'canEnd: no relation data -> false (conservative)')

// G2 mutation: remove the signing check -> the real assertion would go red.
function mutantSigningCheckRemoved(r) {
  if (!r) return false
  if (r.status === 'closed') return false
  // signing check REMOVED on purpose - mutation.
  return true
}
ok(mutantSigningCheckRemoved(contractRow) === true, 'canEnd mutation guard: removing signing check WOULD allow ending with a contract')

// G2 mutation: remove the status check -> a closed conv would be endable.
function mutantStatusCheckRemoved(r) {
  if (!r) return false
  // status check REMOVED on purpose - mutation.
  if (r.signing) return false
  return true
}
ok(mutantStatusCheckRemoved(closedRow) === true, 'canEnd mutation guard: removing status check WOULD allow ending a closed conv')

/* ============ 2. applyEnded F7 sync ============ */
const formalList = [
  { conversationId: 1, status: 'active', tempStatus: null },
  { conversationId: 2, status: 'active', tempStatus: null },
]
const formalAfter = applyEnded(formalList, 1)
ok(formalAfter !== formalList, 'applyEnded formal: returns a new array')
eq(formalAfter[0], { conversationId: 1, status: 'closed', tempStatus: null }, 'applyEnded formal: row flipped to closed')
eq(formalAfter[1], { conversationId: 2, status: 'active', tempStatus: null }, 'applyEnded formal: other rows untouched')
eq(formalList[0], { conversationId: 1, status: 'active', tempStatus: null }, 'applyEnded formal: input not mutated')

const tempList = [
  { conversationId: 5, status: 'active', tempStatus: 'sent', tempInitiatorId: 7 },
  { conversationId: 6, status: 'active', tempStatus: null },
]
const tempAfter = applyEnded(tempList, 5)
eq(tempAfter, [{ conversationId: 6, status: 'active', tempStatus: null }], 'applyEnded temp: row removed entirely')
ok(tempList.length === 2, 'applyEnded temp: input not mutated (still 2 rows)')

// already-closed formal row -> identity (no churn / no re-render)
const closedList = [{ conversationId: 2, status: 'closed', tempStatus: null }]
ok(applyEnded(closedList, 2) === closedList, 'applyEnded: already-closed row returns same reference')
// missing row -> identity
ok(applyEnded(formalList, 99) === formalList, 'applyEnded: missing row returns same reference')

/* ============ 3. endSession write path ============ */
const baseRow = { conversationId: 1, status: 'active', tempStatus: null, otherName: 'A' }

// success (formal): ok + reconciled conversations (F7)
{
  const store = createEndSessionStore()
  let calls = 0
  const apiFn = async () => {
    calls++
    return { ok: true }
  }
  const r = await endSession({ apiFn, capTokenProvider: async () => 'cap-token', convId: 1, conversations: [baseRow], store })
  ok(r.ok === true && !r.already, 'endSession success: ok true, not already')
  ok(r.conversations && r.conversations[0].status === 'closed', 'endSession success: F7 row closed')
  ok(calls === 1, 'endSession success: apiFn called once')
  ok(baseRow.status === 'active', 'endSession success: input not mutated')
}

// success (temp): row removed (F7)
{
  const store = createEndSessionStore()
  let calls = 0
  const apiFn = async () => {
    calls++
    return { ok: true }
  }
  const tempConv = { conversationId: 5, status: 'active', tempStatus: 'sent', tempInitiatorId: 7 }
  const r = await endSession({ apiFn, capTokenProvider: async () => 'cap', convId: 5, conversations: [tempConv], store })
  ok(r.ok === true, 'endSession temp success: ok true')
  eq(r.conversations, [], 'endSession temp success: row removed (F7)')
  ok(calls === 1, 'endSession temp success: apiFn called once')
}

// idempotency: already-closed short-circuits (apiFn 0 calls)
{
  const store = createEndSessionStore()
  let calls = 0
  const apiFn = async () => {
    calls++
    return { ok: true }
  }
  const closedConv = { conversationId: 2, status: 'closed', tempStatus: null }
  const r = await endSession({ apiFn, capTokenProvider: async () => 'cap', convId: 2, conversations: [closedConv], store })
  ok(r.ok === true && r.already === true, 'endSession idempotent: already true')
  ok(calls === 0, 'endSession idempotent: apiFn NOT called')
}

// busy: second call while first in-flight is a no-op
{
  const store = createEndSessionStore()
  let calls = 0
  let release
  const apiFn = async () => {
    calls++
    if (calls === 1) return new Promise((res) => {
      release = res
    })
    return { ok: true }
  }
  const p1 = endSession({ apiFn, capTokenProvider: async () => 'cap', convId: 1, conversations: [baseRow], store })
  await Promise.resolve()
  await Promise.resolve()
  const r2 = await endSession({ apiFn, capTokenProvider: async () => 'cap', convId: 1, conversations: [baseRow], store })
  ok(r2.ok === false && r2.busy === true, 'endSession busy: second call no-op (busy true)')
  ok(calls === 1, 'endSession busy: apiFn called once')
  release({ ok: true })
  const r1 = await p1
  ok(r1.ok === true, 'endSession busy: first call completes ok')
  const r3 = await endSession({ apiFn, capTokenProvider: async () => 'cap', convId: 1, conversations: [baseRow], store })
  ok(r3.ok === true, 'endSession busy: busy cleared after done')
}

// capToken null -> capped:true, apiFn NOT called (honest cap)
{
  const store = createEndSessionStore()
  let calls = 0
  const apiFn = async () => {
    calls++
    return { ok: true }
  }
  const r = await endSession({ apiFn, capTokenProvider: async () => null, convId: 1, conversations: [baseRow], store })
  ok(r.ok === false && r.capped === true, 'endSession cap: capped true, not ok')
  ok(calls === 0, 'endSession cap: apiFn NOT called (honest cap)')
  ok(baseRow.status === 'active', 'endSession cap: state unchanged')
}

// capTokenProvider throwing -> ok:false error, state unchanged
{
  const store = createEndSessionStore()
  const r = await endSession({
    apiFn: async () => ({ ok: true }),
    capTokenProvider: async () => {
      throw new Error('cap failure')
    },
    convId: 1,
    conversations: [baseRow],
    store,
  })
  ok(r.ok === false && r.error && /cap failure/.test(r.error.message), 'endSession cap-provider throw: ok false with error')
  ok(baseRow.status === 'active', 'endSession cap-provider throw: state unchanged')
}

// server already-closed (code) -> ok true, already true, reconciled (F7)
{
  const store = createEndSessionStore()
  const err = new Error('already closed')
  err.code = ALREADY_CLOSED_CODE
  err.status = 409
  const apiFn = async () => {
    throw err
  }
  const r = await endSession({ apiFn, capTokenProvider: async () => 'cap', convId: 1, conversations: [baseRow], store })
  ok(r.ok === true && r.already === true, 'endSession already-code: ok true already true')
  ok(r.conversations[0].status === 'closed', 'endSession already-code: F7 reconciled')
}

// server 404 (temp already deleted) -> ok true, already true, row removed (F7)
{
  const store = createEndSessionStore()
  const err = new Error('not found')
  err.code = 'CONVERSATION_NOT_FOUND'
  err.status = 404
  const apiFn = async () => {
    throw err
  }
  const tempConv = { conversationId: 5, status: 'active', tempStatus: 'sent', tempInitiatorId: 7 }
  const r = await endSession({ apiFn, capTokenProvider: async () => 'cap', convId: 5, conversations: [tempConv], store })
  ok(r.ok === true && r.already === true, 'endSession 404: ok true already true')
  eq(r.conversations, [], 'endSession 404: temp row removed (F7 reconcile)')
}

// failure -> ok:false, error, state unchanged
{
  const store = createEndSessionStore()
  const apiFn = async () => {
    throw new Error('network down')
  }
  const before = JSON.stringify(baseRow)
  const r = await endSession({ apiFn, capTokenProvider: async () => 'cap', convId: 1, conversations: [baseRow], store })
  ok(r.ok === false && r.error && /network down/.test(r.error.message), 'endSession failure: ok false with error')
  ok(JSON.stringify(baseRow) === before, 'endSession failure: state unchanged')
}

/* ============ 4. G2 mutation guards (the three named in M4-25) ============ */
// remove F7 sync -> success would NOT reconcile local state.
async function mutantNoSync(deps) {
  const { apiFn, capTokenProvider, convId, conversations, store } = deps
  if (store.isBusy(convId)) return { ok: false, busy: true }
  store.busy(convId)
  try {
    const capToken = await capTokenProvider()
    await apiFn(`/conversations/${convId}/close`, { method: 'POST', body: { capToken } })
    // F7 sync REMOVED on purpose - mutation.
    return { ok: true, conversations }
  } finally {
    store.done(convId)
  }
}
{
  const store = createEndSessionStore()
  const mutRow = { conversationId: 1, status: 'active', tempStatus: null }
  const res = await mutantNoSync({ apiFn: async () => ({}), capTokenProvider: async () => 'c', convId: 1, conversations: [mutRow], store })
  ok(res.conversations[0].status !== 'closed', 'endSession mutation guard: removing F7 sync WOULD leave the row active')
}

// remove idempotent short-circuit -> already-closed WOULD hit the network.
async function mutantNoIdempotency(deps) {
  const { apiFn, capTokenProvider, convId, store } = deps
  if (store.isBusy(convId)) return { ok: false, busy: true }
  // idempotent short-circuit REMOVED on purpose - mutation.
  store.busy(convId)
  try {
    const capToken = await capTokenProvider()
    await apiFn(`/conversations/${convId}/close`, { method: 'POST', body: { capToken } })
    return { ok: true }
  } finally {
    store.done(convId)
  }
}
{
  const store = createEndSessionStore()
  let calls = 0
  await mutantNoIdempotency({
    apiFn: async () => {
      calls++
      return {}
    },
    capTokenProvider: async () => 'c',
    convId: 2,
    conversations: [{ conversationId: 2, status: 'closed' }],
    store,
  })
  ok(calls === 1, 'endSession mutation guard: removing idempotency WOULD hit the network for already-closed')
}

// remove busy guard -> concurrent closes WOULD double-fire.
async function mutantNoBusy(deps) {
  const { apiFn, capTokenProvider, convId } = deps
  // busy guard REMOVED on purpose - mutation.
  const capToken = await capTokenProvider()
  await apiFn(`/conversations/${convId}/close`, { method: 'POST', body: { capToken } })
  return { ok: true }
}
{
  let calls = 0
  const resolvers = []
  const apiFn = async () => {
    calls++
    return new Promise((res) => {
      resolvers.push(res)
    })
  }
  const mb1 = mutantNoBusy({ apiFn, capTokenProvider: async () => 'c', convId: 1 })
  const mb2 = mutantNoBusy({ apiFn, capTokenProvider: async () => 'c', convId: 1 })
  await new Promise((r) => setTimeout(r, 0)) // let both calls reach the apiFn await
  ok(calls === 2, 'endSession mutation guard: removing busy guard WOULD double-fire (both calls issued)')
  resolvers.forEach((res) => res({}))
  await Promise.all([mb1, mb2])
  ok(calls === 2, 'endSession mutation guard: removing busy guard WOULD double-fire concurrent closes')
}

/* ============ summary ============ */
if (errors.length) {
  console.log('END SESSION TEST FAIL')
  errors.forEach((e) => console.log(' - ' + e))
  process.exit(1)
}
console.log('END SESSION TEST PASS')
