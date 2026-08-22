/**
 * api.js - single-point API client (first consumer: M8 my-demands; M2 auth builds on this)
 * -------------------------------------------------------
 * - ALL module network calls go through api() from this file (contract: fetch lives here only).
 * - Auth token source: sessionStorage 'authToken' (session) then localStorage 'authToken'
 *   (remember-me). M2 authStore will route token read/write through this same key so the
 *   401 handling stays single-point.
 * - 401 -> single-point dead-token handling: clears token + dispatches window 'auth:dead'
 *   (M2-12 handleDeadToken hooks this to clear state + route to login).
 * - Non-2xx -> throws ApiError { status, code, message } (server message, else code, else HTTP status).
 * - Strict CSP: zero inline handlers; plain ESM, no DOM access beyond storage/fetch.
 * - Relative imports only: this file is loaded transitively by Node unit tests
 *   (chat-*.mjs), so the Vite `@` alias must not appear here.
 */
import { UI_COPY } from '../constants/ui.js'

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message || code || `HTTP ${status}`)
    this.name = 'ApiError'
    this.status = status
    this.code = code || ''
  }
}

export const AUTH_TOKEN_KEY = 'authToken'

export function readAuthToken() {
  try {
    return sessionStorage.getItem(AUTH_TOKEN_KEY) || localStorage.getItem(AUTH_TOKEN_KEY) || ''
  } catch {
    return ''
  }
}

export function clearAuthToken() {
  try {
    sessionStorage.removeItem(AUTH_TOKEN_KEY)
    localStorage.removeItem(AUTH_TOKEN_KEY)
  } catch {
    /* storage may be unavailable (private mode); nothing else to clear */
  }
}

/**
 * api(path, { method, body, auth })
 * - path: business path WITHOUT the /api prefix (e.g. '/demands/mine').
 * - body: object -> JSON; omit for GET.
 * - auth: false skips token injection + 401 handling (public endpoints).
 */
export async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (auth) {
    const token = readAuthToken()
    if (token) headers['X-Auth-Token'] = token
  }

  let res
  try {
    res = await fetch('/api' + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch (netErr) {
    throw new ApiError(0, 'NETWORK_ERROR', UI_COPY.NETWORK_ERROR)
  }

  if (res.status === 401 && auth) {
    clearAuthToken()
    window.dispatchEvent(new CustomEvent('auth:dead'))
    throw new ApiError(401, 'UNAUTHORIZED', '')
  }

  let data = null
  try {
    data = await res.json()
  } catch {
    data = null
  }

  if (!res.ok) {
    throw new ApiError(res.status, data?.code, data?.message || data?.error || `HTTP ${res.status}`)
  }
  return data
}
