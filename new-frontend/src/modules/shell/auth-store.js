import { reactive } from 'vue'
import { AUTH_TOKEN_KEY } from '../../core/api.js'

/**
 * auth-store - authentication state singleton + dual storage
 * ----------------------------------------------------------
 * - Single reactive auth state (token/user/ready) shared across the shell.
 * - Dual persistence: sessionStorage is the primary per-tab store; when the user
 *   checks "remember me" a copy goes to localStorage with an expiry (TTL) as a
 *   best-effort cleanup guard. Expired local copies are dropped on read.
 * - Storage adapters are injectable via setStorageAdapters for Node tests and SSR;
 *   every storage access is wrapped in try/catch so private-mode/SSR failures
 *   degrade silently.
 * - The token key is the SAME single source as core/api.js (AUTH_TOKEN_KEY), so the
 *   api() single point reads the token this store persists (contract: M2 authStore
 *   owns the key lifecycle, core/api reads it).
 * - Contract: M2-10 auth-store.js (CONTRACT.md §3.3).
 */

export const ROLES = Object.freeze({
  STUDENT: 'student',
  TEACHER: 'teacher',
  ADMIN: 'admin',
})

export const REMEMBER_TTL_MS = 7 * 24 * 60 * 60 * 1000

const TOKEN_KEY = AUTH_TOKEN_KEY
const USER_KEY = 'sufe.authUser'
const REMEMBER_KEY = 'sufe.authRemember'
const EXPIRES_KEY = 'sufe.authExpires'

export const authStore = reactive({ token: null, user: null, ready: false })

let sessionAdapter = null
let localAdapter = null

export function setStorageAdapters(session, local) {
  sessionAdapter = session
  localAdapter = local
}

function sessionStore() {
  if (sessionAdapter) return sessionAdapter
  try {
    return window.sessionStorage
  } catch (e) {
    return null
  }
}

function localStore() {
  if (localAdapter) return localAdapter
  try {
    return window.localStorage
  } catch (e) {
    return null
  }
}

function get(store, key) {
  if (!store) return null
  try {
    return store.getItem(key)
  } catch (e) {
    return null
  }
}

function set(store, key, value) {
  if (!store) return
  try {
    store.setItem(key, value)
  } catch (e) {
    /* silent: private mode / storage disabled */
  }
}

function remove(store, key) {
  if (!store) return
  try {
    store.removeItem(key)
  } catch (e) {
    /* silent */
  }
}

function parseUser(raw) {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch (e) {
    return null
  }
}

export function setAuth({ token, user }) {
  authStore.token = token
  authStore.user = user
  authStore.ready = true
}

export function clearAuth() {
  authStore.token = null
  authStore.user = null
  authStore.ready = false
  const s = sessionStore()
  const l = localStore()
  remove(s, TOKEN_KEY)
  remove(s, USER_KEY)
  remove(s, REMEMBER_KEY)
  remove(s, EXPIRES_KEY)
  remove(l, TOKEN_KEY)
  remove(l, USER_KEY)
  remove(l, REMEMBER_KEY)
  remove(l, EXPIRES_KEY)
}

export function persistAuth({ token, user, remember }) {
  const s = sessionStore()
  const l = localStore()
  set(s, TOKEN_KEY, token)
  set(s, USER_KEY, JSON.stringify(user))
  set(s, REMEMBER_KEY, remember ? '1' : '0')
  if (remember) {
    set(l, TOKEN_KEY, token)
    set(l, USER_KEY, JSON.stringify(user))
    set(l, REMEMBER_KEY, '1')
    set(l, EXPIRES_KEY, String(Date.now() + REMEMBER_TTL_MS))
  } else {
    remove(l, TOKEN_KEY)
    remove(l, USER_KEY)
    remove(l, REMEMBER_KEY)
    remove(l, EXPIRES_KEY)
  }
}

export function readStoredAuth() {
  const s = sessionStore()
  const l = localStore()
  const localToken = get(l, TOKEN_KEY)
  if (localToken) {
    const localExpires = get(l, EXPIRES_KEY)
    if (localExpires && Number(localExpires) > Date.now()) {
      return {
        token: localToken,
        user: parseUser(get(l, USER_KEY)),
        remember: get(l, REMEMBER_KEY) === '1',
      }
    }
    // Expired or missing expiry: drop local keys and degrade to session.
    remove(l, TOKEN_KEY)
    remove(l, USER_KEY)
    remove(l, REMEMBER_KEY)
    remove(l, EXPIRES_KEY)
  }
  const sessionToken = get(s, TOKEN_KEY)
  if (sessionToken) {
    return {
      token: sessionToken,
      user: parseUser(get(s, USER_KEY)),
      remember: get(s, REMEMBER_KEY) === '1',
    }
  }
  return null
}
