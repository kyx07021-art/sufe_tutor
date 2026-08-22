/**
 * M6-3 authMethod - pure authentication method state machine (no Vue / DOM deps).
 *
 * Scene-conditional method availability, default selection, and sibling listing.
 * This module is the single source for the AUTH_SCENES / AUTH_METHODS constants
 * (CONTRACT.md §1) and the availability semantics (CONTRACT.md §4). It has zero
 * imports and can be executed in any JS runtime, including plain Node.
 */

export const AUTH_SCENES = Object.freeze({ LOGIN: 'login', REGISTER: 'register', VERIFY: 'verify' })

export const AUTH_METHODS = Object.freeze({
  OTP_PHONE: 'otp_phone',
  OTP_EMAIL: 'otp_email',
  PASSWORD: 'password',
})

/**
 * Whether the given method is an OTP (one-time password) channel.
 * @param {string} m
 * @returns {boolean}
 */
export function isOtp(m) {
  return m === AUTH_METHODS.OTP_PHONE || m === AUTH_METHODS.OTP_EMAIL
}

/**
 * Methods available for a given scene, ordered by preference.
 * - register -> [otp_phone, otp_email] (registration is code-channel only, no password).
 * - login/verify -> [otp_phone? (masks.phone), otp_email? (masks.email), password] (password is always last).
 * A missing / undefined / null contactMasks is treated as an empty object.
 * @param {string} scene one of AUTH_SCENES
 * @param {object} [contactMasks] boolean contact availability, e.g. { phone: true, email: false }
 * @returns {string[]}
 */
export function availableMethods(scene, contactMasks = {}) {
  const masks = contactMasks && typeof contactMasks === 'object' ? contactMasks : {}
  if (scene === AUTH_SCENES.REGISTER) {
    return [AUTH_METHODS.OTP_PHONE, AUTH_METHODS.OTP_EMAIL]
  }
  const list = []
  if (masks.phone) list.push(AUTH_METHODS.OTP_PHONE)
  if (masks.email) list.push(AUTH_METHODS.OTP_EMAIL)
  list.push(AUTH_METHODS.PASSWORD)
  return list
}

/**
 * Default method = first non-password method in the available list, or password
 * when no OTP channel is available. ("Never default to password when an OTP
 * channel exists.")
 * @param {string} scene
 * @param {object} [contactMasks]
 * @returns {string}
 */
export function defaultMethod(scene, contactMasks = {}) {
  const list = availableMethods(scene, contactMasks)
  const first = list.find((m) => m !== AUTH_METHODS.PASSWORD)
  return first || AUTH_METHODS.PASSWORD
}

/**
 * Methods other than the current one within the available set (feeds the
 * pick-any-two S1 switch, which shows exactly two alternatives).
 * @param {string} scene
 * @param {object} [contactMasks]
 * @param {string} current
 * @returns {string[]}
 */
export function otherMethods(scene, contactMasks = {}, current) {
  return availableMethods(scene, contactMasks).filter((m) => m !== current)
}
