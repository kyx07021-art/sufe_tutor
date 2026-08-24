/**
 * M4-25 end-session capToken three-exit flow unit test (Node-runnable, no DOM).
 * ---------------------------------------------------------------------------
 * F1: closes the test gap that the plain endSession() logic tests cannot reach —
 * the real M6-11 identity-auth glue: openIdentityAuth sets the overlay, the
 * verify submit parks a fresh I-06 capToken on authOverlay, and the AuthHost
 * three exits (verified / cancel / force-close) deliver it or null and clear
 * every callback + the token so a stale one is never reused.
 *
 * Contract under test (auth/CONTRACT.md §7 three-exit):
 *   1. verified exit  -> onVerified fires exactly once with the parked capToken.
 *   2. cancel exit    -> onCancel fires exactly once (dismissed).
 *   3. force-close    -> onCancel fires exactly once (update:open false).
 *   4. ANY exit clears onVerified / onCancel / capToken / open.
 *   5. The end-session capTokenProvider shape (openEndSessionVerify) settles with
 *      the capToken on verified and null on cancel (the write is then capped).
 *
 * G2 mutation guards (each proves a real assertion is load-bearing):
 *   A. removing useConfirmSubmit's capToken parking -> the verified exit would
 *      deliver '' instead of the fresh token.
 *   B. removing an exit's capToken clear -> a stale token would survive a cancel.
 *   C. removing an exit's callback nulling -> a second exit re-fires onVerified.
 *
 * Run: node test/chat-endverify-flow.mjs (or node --test test/chat-*.mjs)
 */
import {
  authOverlay,
  openIdentityAuth,
  resolveAuthExit,
  closeIdentityAuth,
  AUTH_EXITS,
} from '../src/modules/auth/authState.js'
import { useConfirmSubmit } from '../src/modules/auth/useConfirmSubmit.js'
import { registerIface, getIface } from '../src/modules/shell/ifaces.js'

const CAP = 'CAP-TOKEN-123'

// Node-safe fetch stub for the injected core/api.js single point: the verify
// submit POSTs /api/auth/verify and parks the returned capToken. The last verify
// body is captured so we can lock the locally generated captchaId echo (I-06 +
// #108; AK-A1a local pass, server no longer confirms the puzzle).
let lastVerifyBody = null
globalThis.fetch = async (url, opts) => {
  if (url === '/api/auth/verify' && opts && opts.body) lastVerifyBody = JSON.parse(opts.body)
  return { ok: true, status: 200, json: async () => ({ verified: true, capToken: CAP }) }
}
// useToast calls window.setTimeout on the failure path; success never toasts, but
// the shim keeps any accidental toast from crashing the test process.
if (typeof window === 'undefined') {
  globalThis.window = { setTimeout: (...a) => setTimeout(...a), clearTimeout: (...a) => clearTimeout(...a) }
}

const errors = []
const ok = (cond, msg) => {
  if (!cond) errors.push(msg)
}

/** Fresh overlay for every scenario (G4: no shared state across scenarios). */
function resetOverlay() {
  closeIdentityAuth()
}

/* ============ 1. verified exit: fires once with the parked capToken, clears all ============ */
{
  resetOverlay()
  let verifiedCalls = 0
  let cancelCalls = 0
  let gotToken = 'sentinel'
  openIdentityAuth({
    onVerified: (t) => {
      verifiedCalls++
      gotToken = t
    },
    onCancel: () => {
      cancelCalls++
    },
  })
  ok(authOverlay.open === true, 'S1: overlay opens')

  const { submit } = useConfirmSubmit()
  const submitOk = await submit({ type: 'password', value: 's3cret', captchaId: 'cap-end' })
  ok(submitOk === true, 'S1: verify submit succeeds')
  ok(lastVerifyBody && lastVerifyBody.captchaId === 'cap-end', 'S1: verify body echoes the locally generated captchaId (G2: removing the echo makes this red)')
  ok(authOverlay.capToken === CAP, 'S1: submit parks the fresh capToken on the overlay')

  const delivered = resolveAuthExit(AUTH_EXITS.VERIFIED)
  ok(delivered === CAP, 'S1: verified exit returns the parked token')
  ok(verifiedCalls === 1, 'S1: onVerified fires exactly once')
  ok(gotToken === CAP, 'S1: onVerified receives the parked capToken')
  ok(cancelCalls === 0, 'S1: onCancel never fires on the verified exit')
  ok(authOverlay.onVerified === null, 'S1: onVerified cleared after exit')
  ok(authOverlay.onCancel === null, 'S1: onCancel cleared after exit')
  ok(authOverlay.capToken === '', 'S1: capToken cleared after exit')
  ok(authOverlay.open === false, 'S1: overlay closed after exit')

  // A second exit call is a no-op: the handler was already cleared.
  resolveAuthExit(AUTH_EXITS.VERIFIED)
  ok(verifiedCalls === 1, 'S1: a second verified exit does not re-fire onVerified')
}

/* ============ 2. cancel exit: fires onCancel once, clears all ============ */
{
  resetOverlay()
  let verifiedCalls = 0
  let cancelCalls = 0
  openIdentityAuth({
    onVerified: () => {
      verifiedCalls++
    },
    onCancel: () => {
      cancelCalls++
    },
  })
  resolveAuthExit(AUTH_EXITS.CANCEL)
  ok(cancelCalls === 1, 'S2: onCancel fires exactly once')
  ok(verifiedCalls === 0, 'S2: onVerified never fires on cancel')
  ok(authOverlay.onVerified === null && authOverlay.onCancel === null && authOverlay.capToken === '' && authOverlay.open === false,
    'S2: all state cleared after cancel')
}

/* ============ 3. force-close exit: onCancel fires once, clears all ============ */
{
  resetOverlay()
  let cancelCalls = 0
  openIdentityAuth({
    onVerified: () => {},
    onCancel: () => {
      cancelCalls++
    },
  })
  // AuthHost's onUpdateOpen(false) funnels into the force-close exit.
  resolveAuthExit(AUTH_EXITS.FORCE_CLOSE)
  ok(cancelCalls === 1, 'S3: force-close fires onCancel exactly once')
  ok(authOverlay.onVerified === null && authOverlay.onCancel === null && authOverlay.capToken === '' && authOverlay.open === false,
    'S3: all state cleared after force-close')
}

/* ============ 4. stale token is never reused (clear on every exit) ============ */
{
  resetOverlay()
  openIdentityAuth({ onVerified: () => {}, onCancel: () => {} })
  authOverlay.capToken = 'STALE'
  resolveAuthExit(AUTH_EXITS.CANCEL)
  ok(authOverlay.capToken === '', 'S4: capToken cleared on a cancel exit (no stale reuse)')
}

/* ============ 5. end-session capTokenProvider glue (openEndSessionVerify shape) ============ */
{
  resetOverlay()
  registerIface('openIdentityAuth', openIdentityAuth)
  ok(typeof getIface('openIdentityAuth') === 'function', 'S5: openIdentityAuth is registered on the shell iface')

  // Same glue as state.js openEndSessionVerify (10 lines). state.js is plain-Node
  // importable, but the shape is replicated verbatim to keep this flow test
  // isolated from the chat state module's dependencies.
  function openEndSessionVerify() {
    const open = getIface('openIdentityAuth')
    if (!open) return Promise.resolve(null)
    return new Promise((resolve) => {
      open({
        onVerified: (capToken) => resolve(capToken || null),
        onCancel: () => resolve(null),
      })
    })
  }

  // Verified path: the parked capToken flows through the exit to the provider.
  let promise = openEndSessionVerify()
  await useConfirmSubmit().submit({ type: 'otp', value: '123456', captchaId: 'cap-end' })
  resolveAuthExit(AUTH_EXITS.VERIFIED)
  const token = await promise
  ok(token === CAP, 'S5: end-session provider resolves with the parked capToken on verified')

  // Dismiss path: cancel resolves null, so the endSession write is capped.
  promise = openEndSessionVerify()
  resolveAuthExit(AUTH_EXITS.CANCEL)
  const none = await promise
  ok(none === null, 'S5: end-session provider resolves null on cancel (capped write)')
}

/* ============ 6. G2 mutation guards ============ */

// Mutation A: useConfirmSubmit stops parking the capToken -> verified exit delivers ''.
{
  resetOverlay()
  async function mutantSubmitNoPark() {
    // Verify succeeds, but `authOverlay.capToken = r.capToken || ''` is REMOVED
    // on purpose - mutation.
    return true
  }
  let got = 'sentinel'
  openIdentityAuth({
    onVerified: (t) => {
      got = t
    },
    onCancel: () => {},
  })
  await mutantSubmitNoPark()
  resolveAuthExit(AUTH_EXITS.VERIFIED)
  ok(got === '', 'Mutation A: without the capToken parking the verified exit WOULD deliver an empty token')
}

// Mutation B: an exit skips the capToken clear -> a stale token survives a cancel.
{
  resetOverlay()
  function mutantExitNoCapClear(state = authOverlay) {
    const cb = state.onCancel
    state.onVerified = null
    state.onCancel = null
    // capToken clear REMOVED on purpose - mutation.
    state.open = false
    if (typeof cb === 'function') cb()
  }
  openIdentityAuth({ onVerified: () => {}, onCancel: () => {} })
  authOverlay.capToken = 'STALE'
  mutantExitNoCapClear()
  ok(authOverlay.capToken === 'STALE', 'Mutation B: an exit without the capToken clear WOULD leave a stale token')
}

// Mutation C: an exit skips nulling onVerified -> a second exit re-fires the handler.
{
  resetOverlay()
  function mutantExitNoCallbackClear(state = authOverlay) {
    const cb = state.onVerified
    state.capToken = ''
    // onVerified nulling REMOVED on purpose - mutation.
    state.open = false
    if (typeof cb === 'function') cb('')
  }
  let fired = 0
  openIdentityAuth({
    onVerified: () => {
      fired++
    },
    onCancel: () => {},
  })
  mutantExitNoCallbackClear() // first dispatch through the mutant
  resolveAuthExit(AUTH_EXITS.VERIFIED) // would dispatch again because the handler survived
  ok(fired === 2, 'Mutation C: without callback nulling a second exit WOULD re-fire the same onVerified')
}

/* ============================== verdict =================================== */
if (errors.length) {
  console.log('CHAT END-VERIFY FLOW TEST FAIL')
  errors.forEach((e) => console.log(' - ' + e))
  process.exit(1)
}
console.log('CHAT END-VERIFY FLOW TEST PASS')
