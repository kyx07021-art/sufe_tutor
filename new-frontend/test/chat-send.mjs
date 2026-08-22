/**
 * chat-send.mjs - M4-30 optimistic send pipeline unit tests (Node-only).
 * ---------------------------------------------------------------------------
 * No browser, no Vue, no network. `apiFn` is mocked. Covers:
 *   1. createClientKey uniqueness.
 *   2. makeOptimistic negative-tempId row shape.
 *   3. dedupBatchByClientKey (A2) - within-batch + against existing keys.
 *   4. success path: optimistic row observed BEFORE the await via onPending,
 *      then replaced by the real server row (tempId gone, id = server id),
 *      apiFn called once with the exact I-19 body.
 *   5. clientKey dedup keeps messages length correct (mutation: removing dedup
 *      would append a duplicate optimistic row -> length / body assertions red).
 *   6. failure path: apiFn rejects -> ok:false, messages === the exact ORIGINAL
 *      array (mutation: removing rollback would leave the temp row -> red),
 *      403 code propagated.
 *   7. F6 busy: a second concurrent call for the same convId returns busy and
 *      apiFn is called once (mutation: removing the guard -> two calls -> red).
 *   8. temp integration: tempQuota / convStatus passed through.
 *   9. fully-deduped batch -> no-op success (deduped:true, no duplicate row).
 *
 * Run: node test/chat-send.mjs
 */

import {
  createClientKey,
  makeOptimistic,
  dedupBatchByClientKey,
  sendMessages,
} from '../src/modules/chat/logic/send.js'

const errors = []
const ok = (cond, msg) => {
  if (!cond) errors.push(msg)
}

/** Build an ApiError-shaped object (matches src/core/api.js ApiError fields). */
function fakeError(code, status, message) {
  const e = new Error(message || code)
  e.code = code
  e.status = status
  return e
}

/** A deferred promise the test resolves/rejects manually. */
function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const BASE_ROW = { id: 1, sender_user_id: 7, kind: 'text', body: 'old', created_at: '2026-08-21T00:00:00Z' }

/* ---------- 1. createClientKey ---------- */
const ck1 = createClientKey()
const ck2 = createClientKey()
ok(typeof ck1 === 'string' && ck1.length > 0, 'createClientKey: returns a string')
ok(ck1 !== ck2, 'createClientKey: unique across calls')

/* ---------- 2. makeOptimistic ---------- */
const optRow = makeOptimistic({ kind: 'text', body: 'hello', clientKey: 'ck-opt', currentUserId: 7 })
ok(optRow.id < 0, 'makeOptimistic: tempId negative')
ok(optRow.tempId === optRow.id, 'makeOptimistic: tempId mirrors id (Vue key)')
ok(optRow.pending === true, 'makeOptimistic: pending flag set')
ok(optRow.clientKey === 'ck-opt', 'makeOptimistic: carries clientKey')
ok(optRow.sender_user_id === 7, 'makeOptimistic: sender set')
ok(optRow.kind === 'text' && optRow.body === 'hello', 'makeOptimistic: kind/body set')
ok(optRow.created_at && !Number.isNaN(Date.parse(optRow.created_at)), 'makeOptimistic: created_at ISO')
const optRow2 = makeOptimistic({ clientKey: 'ck-opt2', currentUserId: 1 })
ok(optRow2.id !== optRow.id, 'makeOptimistic: tempId unique per row')

/* ---------- 3. dedupBatchByClientKey (A2) ---------- */
const batch3 = [
  { kind: 'text', body: 'a', clientKey: 'ck-1' },
  { kind: 'text', body: 'b', clientKey: 'ck-2' },
  { kind: 'text', body: 'c', clientKey: 'ck-1' }, // within-batch duplicate
]
ok(dedupBatchByClientKey(batch3, []).length === 2, 'dedup: within-batch duplicate key dropped')
const deduped3 = dedupBatchByClientKey(batch3, ['ck-2'])
ok(deduped3.length === 1 && deduped3[0].clientKey === 'ck-1', 'dedup: keys already present are dropped')
ok(dedupBatchByClientKey([{ kind: 'text', body: 'keyless' }], []).length === 1, 'dedup: key-less item is kept')

/* ---------- 4. success path ---------- */
{
  const d = deferred()
  let calls = 0
  let sentPath = null
  let sentBody = null
  const apiFn = (path, opts) => {
    calls += 1
    sentPath = path
    sentBody = opts.body
    return d.promise
  }
  const serverRow = { id: 100, sender_user_id: 7, kind: 'text', body: 'hi', clientKey: 'ck-9', created_at: '2026-08-22T00:00:00Z' }
  const original = [BASE_ROW]
  let pendingSeen = null
  const p = sendMessages({
    apiFn,
    convId: 1,
    currentUserId: 7,
    messages: original,
    conversations: [],
    batch: [{ kind: 'text', body: 'hi', clientKey: 'ck-9' }],
    onPending: (arr) => {
      pendingSeen = arr
    },
  })

  // The optimistic row must be observable BEFORE the API resolves.
  ok(pendingSeen !== null, 'success: onPending fires before the await')
  ok(pendingSeen.length === 2, 'success: optimistic row appended')
  ok(pendingSeen[1].pending === true && pendingSeen[1].id < 0 && pendingSeen[1].clientKey === 'ck-9', 'success: optimistic row shape')
  ok(calls === 1, 'success: apiFn called once')
  ok(sentPath === '/conversations/1/messages', 'success: correct path')
  ok(sentBody && sentBody.batch.length === 1 && sentBody.batch[0].kind === 'text' && sentBody.batch[0].body === 'hi' && sentBody.batch[0].clientKey === 'ck-9', 'success: I-19 body carries clientKey')

  d.resolve({ messages: [serverRow] })
  const result = await p
  ok(result.ok === true, 'success: ok true')
  ok(result.messages.length === 2, 'success: final length 2')
  ok(result.messages[1].id === 100, 'success: temp replaced by server id')
  ok(result.messages[1].tempId === undefined, 'success: tempId gone')
  ok(result.messages[1].pending === false, 'success: pending flag dropped')
  ok(result.messages[1].clientKey === 'ck-9', 'success: real row carries clientKey')
  ok(result.messages[0] === BASE_ROW, 'success: pre-existing row untouched')
  ok(calls === 1, 'success: apiFn still called once')
}

/* ---------- 5. clientKey dedup keeps messages length correct (A2) ---------- */
{
  const d = deferred()
  let calls = 0
  let sentBody = null
  const apiFn = (path, opts) => {
    calls += 1
    sentBody = opts.body
    return d.promise
  }
  // messages already contain a pending row for 'ck-dup' (a previous optimistic row).
  const withExisting = [
    BASE_ROW,
    { id: -5, tempId: -5, sender_user_id: 7, kind: 'text', body: 'prev', pending: true, clientKey: 'ck-dup', created_at: '2026-08-22T00:00:00Z' },
  ]
  const p = sendMessages({
    apiFn,
    convId: 2,
    currentUserId: 7,
    messages: withExisting,
    conversations: [],
    batch: [
      { kind: 'text', body: 'prev retry', clientKey: 'ck-dup' }, // already present -> deduped
      { kind: 'text', body: 'fresh', clientKey: 'ck-fresh' },
    ],
  })

  ok(calls === 1, 'dedup: only one item reaches the API (dup key dropped)')
  ok(sentBody && sentBody.batch.length === 1 && sentBody.batch[0].clientKey === 'ck-fresh', 'dedup: body contains only the fresh item')

  d.resolve({ messages: [{ id: 200, sender_user_id: 7, kind: 'text', body: 'fresh', clientKey: 'ck-fresh', created_at: '2026-08-22T00:00:00Z' }] })
  const result = await p
  // 2 existing + 1 fresh = 3. Without dedup a duplicate optimistic row for
  // 'ck-dup' would be appended -> 4 (mutation: removing dedup goes red here).
  ok(result.messages.length === 3, 'dedup: messages length stays correct (no duplicate optimistic row)')
  ok(result.messages[2].id === 200 && result.messages[2].pending === false, 'dedup: fresh row replaced by server row')
}

/* ---------- 6. failure path + rollback ---------- */
{
  const original = [BASE_ROW]
  let calls = 0
  const apiFn = async () => {
    calls += 1
    throw fakeError('CONVERSATION_CLOSED', 403, '会话已结束')
  }
  const result = await sendMessages({
    apiFn,
    convId: 3,
    currentUserId: 7,
    messages: original,
    conversations: [],
    batch: [{ kind: 'text', body: 'x', clientKey: 'ck-3' }],
  })
  ok(result.ok === false, 'failure: ok false')
  ok(result.code === 'CONVERSATION_CLOSED', 'failure: code propagated')
  ok(result.status === 403, 'failure: status propagated')
  // Rollback returns the EXACT original array reference. Removing the rollback
  // would return a new array containing the temp row -> this assertion goes red.
  ok(result.messages === original, 'failure: rollback restores the exact original array')
  ok(result.messages.length === 1, 'failure: no temp row left')
  ok(result.messages[0].pending === undefined, 'failure: original row unchanged')
  ok(calls === 1, 'failure: apiFn called once')
}

{
  // Generic error (no code) also rolls back.
  const apiFn = async () => {
    throw new Error('boom')
  }
  const result = await sendMessages({
    apiFn,
    convId: 4,
    currentUserId: 7,
    messages: [],
    conversations: [],
    batch: [{ kind: 'text', body: 'y', clientKey: 'ck-4' }],
  })
  ok(result.ok === false, 'failure: generic error -> ok false')
  ok(result.code === undefined && result.status === undefined, 'failure: no code/status on generic error')
  ok(result.messages.length === 0, 'failure: generic error rolled back (empty)')
}

/* ---------- 7. F6 busy lock ---------- */
{
  const d = deferred()
  let calls = 0
  const apiFn = () => {
    calls += 1
    return d.promise
  }
  const pA = sendMessages({
    apiFn,
    convId: 5,
    currentUserId: 7,
    messages: [],
    conversations: [],
    batch: [{ kind: 'text', body: 'a', clientKey: 'ck-5a' }],
  })
  const pB = sendMessages({
    apiFn,
    convId: 5,
    currentUserId: 7,
    messages: [],
    conversations: [],
    batch: [{ kind: 'text', body: 'b', clientKey: 'ck-5b' }],
  })

  // Mutation: removing the busy guard would call apiFn twice -> this goes red.
  ok(calls === 1, 'busy: apiFn called once while in flight')

  // Resolve the in-flight send before awaiting so a guard-removal mutation
  // fails with clean assertion errors (both calls share the same deferred)
  // instead of hanging the runner on an unsettled await.
  d.resolve({ messages: [] })
  const rA = await pA
  const rB = await pB
  ok(rA.ok === true, 'busy: first (winning) call succeeds')
  ok(rB.ok === false && rB.busy === true, 'busy: second call reports busy')
  ok(rB.messages.length === 0, 'busy: second call leaves messages untouched')

  // Lock is released after completion -> a third call can send.
  const dC = deferred()
  let callsC = 0
  const pC = sendMessages({
    apiFn: () => {
      callsC += 1
      return dC.promise
    },
    convId: 5,
    currentUserId: 7,
    messages: [],
    conversations: [],
    batch: [{ kind: 'text', body: 'c', clientKey: 'ck-5c' }],
  })
  ok(callsC === 1, 'busy: lock released after the first send completes')
  dC.resolve({ messages: [] })
  await pC
}

/* ---------- 8. temp integration (tempQuota / convStatus pass-through) ---------- */
{
  const d = deferred()
  const p = sendMessages({
    apiFn: () => d.promise,
    convId: 6,
    currentUserId: 7,
    messages: [],
    conversations: [],
    batch: [{ kind: 'text', body: 't', clientKey: 'ck-6' }],
  })
  d.resolve({
    messages: [{ id: 300, sender_user_id: 7, kind: 'text', body: 't', clientKey: 'ck-6', created_at: '2026-08-22T00:00:00Z' }],
    tempQuota: 0,
    convStatus: 'temp',
  })
  const result = await p
  ok(result.ok === true, 'temp: ok true')
  ok(result.tempQuota === 0, 'temp: tempQuota passed through')
  ok(result.convStatus === 'temp', 'temp: convStatus passed through')
  ok(result.messages.length === 1 && result.messages[0].pending === false, 'temp: row replaced by server row')
}

/* ---------- 9. fully-deduped batch -> no-op success ---------- */
{
  const messages = [
    { id: 1, sender_user_id: 7, kind: 'text', body: 'old', clientKey: 'ck-7', created_at: '2026-08-21T00:00:00Z' },
  ]
  const result = await sendMessages({
    apiFn: () => {
      throw new Error('must not be called')
    },
    convId: 7,
    currentUserId: 7,
    messages,
    conversations: [],
    batch: [{ kind: 'text', body: 'dup', clientKey: 'ck-7' }],
  })
  ok(result.ok === true && result.deduped === true, 'noop: fully-deduped batch -> ok no-op (already sent)')
  ok(result.messages.length === 1, 'noop: no duplicate optimistic row appended')
}

if (errors.length) {
  console.log('CHAT SEND FAIL')
  errors.forEach((e) => console.log(' - ' + e))
  process.exit(1)
}
console.log('CHAT SEND PASS')
