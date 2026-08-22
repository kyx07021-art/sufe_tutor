import { reactive } from 'vue'
import { AUTH_SCENES } from './authMethod.js'

/**
 * authState - M6-11 identity-auth overlay state (single reactive source)
 * -------------------------------------------------------
 * - Holds the modal open flag, target scene, contactMasks and the onVerified /
 *   onCancel callbacks. AuthHost (mounted at the app root) renders AuthModal from
 *   this state, so openIdentityAuth can be called from anywhere (route guards,
 *   sensitive-op buttons, M2-12 401 fallback).
 * - Three-exit contract (auth/CONTRACT.md §7): onVerified (success) / onCancel
 *   (user dismissed the modal) / forced close. The capToken field carries the
 *   fresh I-06 capToken from a successful verify to the calling flow (e.g. the
 *   chat end-session close write); it is cleared on every exit so a stale token
 *   is never reused.
 * - F3 dedupe: re-opening just mutates the same reactive state — no duplicate
 *   mounts, no listener accumulation.
 */
export const authOverlay = reactive({
  open: false,
  scene: AUTH_SCENES.VERIFY,
  contactMasks: {},
  onVerified: null,
  onCancel: null,
  /** capToken from the last successful I-06 verify, consumed by the calling flow. */
  capToken: '',
})

/** Router-guard / dead-token fallback call `open({ mode: 'login' })`; map mode -> scene. */
const MODE_TO_SCENE = {
  login: AUTH_SCENES.LOGIN,
  register: AUTH_SCENES.REGISTER,
  verify: AUTH_SCENES.VERIFY,
}

/**
 * Open the identity-auth modal.
 * @param {{ scene?: string, mode?: string, contactMasks?: {phone:boolean,email:boolean},
 *           onVerified?: (capToken: string) => void, onCancel?: () => void }} opts
 *   - `mode` wins over `scene` (guard contract: { mode: 'login' | 'register' | 'verify' }).
 *   - `onVerified` receives the I-06 capToken (empty string when the response
 *     omitted it / the scene was not verify).
 *   - `onCancel` fires when the modal is dismissed without a verified success
 *     (backdrop / X / Esc / forced close), so a caller promise can settle.
 */
export function openIdentityAuth({ scene, mode, contactMasks = {}, onVerified = null, onCancel = null } = {}) {
  authOverlay.scene = MODE_TO_SCENE[mode] || scene || AUTH_SCENES.VERIFY
  authOverlay.contactMasks = contactMasks || {}
  authOverlay.onVerified = typeof onVerified === 'function' ? onVerified : null
  authOverlay.onCancel = typeof onCancel === 'function' ? onCancel : null
  authOverlay.capToken = ''
  authOverlay.open = true
}

export function closeIdentityAuth() {
  authOverlay.open = false
  authOverlay.onVerified = null
  authOverlay.onCancel = null
  authOverlay.capToken = ''
}

export function isAuthOpen() {
  return authOverlay.open
}

/** The three exits of the auth overlay lifecycle (AuthHost onVerified / onClose /
 *  onUpdateOpen(false)). Values are the resolveAuthExit `type` discriminant.
 *  FORCE_CLOSE is a defensive duplicate of CANCEL: under the current assembly
 *  AuthModal emits both close and update:open(false) on dismissal, so the CANCEL
 *  exit clears every callback first and FORCE_CLOSE is unreachable in practice.
 *  It is retained for contract completeness and robustness against a future
 *  caller that closes the modal via the open flag alone. */
export const AUTH_EXITS = Object.freeze({
  VERIFIED: 'verified',
  CANCEL: 'cancel',
  FORCE_CLOSE: 'force-close',
})

/**
 * Resolve the auth overlay through one of its three exits (M6-11 three-exit
 * contract, auth/CONTRACT.md §7). AuthHost's onVerified / onClose /
 * onUpdateOpen(false) all funnel through here so the contract is unit-testable
 * in plain Node (the chat end-session capToken flow depends on it).
 * @param {string} type one of AUTH_EXITS.
 *   - 'verified': the caller's onVerified fires with the parked capToken (may be '').
 *   - 'cancel' / 'force-close': the caller's onCancel fires; no token is delivered.
 * On ANY exit every callback and the capToken are cleared and the overlay closes,
 * so a stale token / dead callback is never reused by a later flow.
 * @param {object} [state] overlay to operate on (default authOverlay).
 * @returns {string|undefined} the delivered capToken on 'verified', else undefined.
 */
export function resolveAuthExit(type, state = authOverlay) {
  const capToken = state.capToken
  const cb = type === AUTH_EXITS.VERIFIED ? state.onVerified : state.onCancel
  state.onVerified = null
  state.onCancel = null
  state.capToken = ''
  state.open = false
  if (typeof cb === 'function') {
    if (type === AUTH_EXITS.VERIFIED) cb(capToken)
    else cb()
  }
  return type === AUTH_EXITS.VERIFIED ? capToken : undefined
}
