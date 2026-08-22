/**
 * smoke-shell.mjs - M2 shell module smoke test (node --test + Playwright)
 * ----------------------------------------------------------------------
 * - Unit (node:test): auth-store pure state + dual storage + remember-me TTL.
 * - Browser (Playwright, real dist via vite preview): router registry collects
 *   module pages; session restore enters the role default page; login/logout
 *   state; 401 single-point dead-token fallback clears state + storage and
 *   redirects; last-page memory; 375 no horizontal overflow; zero console /
 *   pageerror / CSP violations.
 * - Requires `npm run build` first (serves dist/). Run: node test/smoke-shell.mjs
 *   (BASE env overrides the preview origin, e.g. a running dev server).
 */
import { test } from 'node:test'
import assert from 'node:assert'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright'

import {
  setStorageAdapters,
  persistAuth,
  readStoredAuth,
  clearAuth,
  authStore,
  setAuth,
} from '../src/modules/shell/auth-store.js'
import { SHELL_COPY } from '../src/constants/m-shell.js'
import { RELATIONS_COPY } from '../src/constants/m-relations.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const PORT = Number(process.env.SHELL_TEST_PORT || 5211)
const BASE = process.env.BASE || `http://localhost:${PORT}`

const VALID_TOKEN = 'test-valid-token'
const STUDENT_USER = { id: 1, username: 'qa_student', role: 'student', avatar: '' }

/**
 * I-15 `GET /api/my-relations` fixture for the /relations integration case.
 * Field shape mirrors src/modules/relations/data.js parseRelation: every row
 * needs a positive-integer conversationId, a status in the ALLOWED_CONV_STATUSES
 * set, and an `other` object { id, role, name, avatar? } — the fail-closed
 * parser rejects rows missing those. `last`/`signing` are optional object|null.
 */
/**
 * I-17 conversation-list fixture for the chat page (/chat) cases. Shape mirrors
 * src/modules/chat/state.js normalizeConversationRow's contract branch
 * (conversationId / otherName / avatar / lastMessage / lastAt / status / unread /
 * tempStatus / tempInitiatorId / quotaRemaining / iAmInitiator). The student role
 * defaults to /chat after restore, so every authed scenario mounts ChatPage and
 * fires GET /api/conversations - the mock must answer it or the browser logs 4+
 * "Failed to load resource ... 404" console errors (the PA-1h2-F1 loader gap).
 */
const CONVERSATIONS_FIXTURE = {
  conversations: [
    {
      conversationId: 1,
      otherName: '王老师',
      avatar: '',
      lastMessage: '好的，我们周六见',
      lastAt: null,
      status: 'active',
      unread: 0,
      tempStatus: null,
      tempInitiatorId: null,
      quotaRemaining: null,
      iAmInitiator: false,
    },
  ],
}

const RELATIONS_FIXTURE = {
  relations: [
    {
      conversationId: 1,
      status: 'active',
      tempStatus: null,
      tempInitiatorId: null,
      signing: null,
      last: { id: 10, senderUserId: 2, kind: 'text', body: '好的，我们周六见' },
      other: { id: 2, role: 'teacher', name: '王老师', avatar: '' },
    },
    {
      conversationId: 2,
      status: 'active',
      tempStatus: null,
      tempInitiatorId: null,
      signing: { id: 99 },
      last: null,
      other: { id: 3, role: 'teacher', name: '李老师', avatar: '' },
    },
    {
      conversationId: 3,
      status: 'closed',
      tempStatus: null,
      tempInitiatorId: null,
      signing: null,
      last: null,
      other: { id: 4, role: 'teacher', name: '赵老师', avatar: '' },
    },
  ],
}

/* ------------------------------------------------------------------ *
 * Unit: auth-store
 * ------------------------------------------------------------------ */

function memStore(init = {}) {
  return {
    _s: { ...init },
    getItem(k) {
      return Object.prototype.hasOwnProperty.call(this._s, k) ? this._s[k] : null
    },
    setItem(k, v) {
      this._s[k] = String(v)
    },
    removeItem(k) {
      delete this._s[k]
    },
  }
}

test('auth-store: remember-me persists token to both stores and reads back', () => {
  const sess = memStore()
  const loc = memStore()
  setStorageAdapters(sess, loc)
  persistAuth({ token: VALID_TOKEN, user: STUDENT_USER, remember: true })
  assert.equal(sess.getItem('authToken'), VALID_TOKEN)
  assert.equal(loc.getItem('authToken'), VALID_TOKEN)
  const read = readStoredAuth()
  assert.equal(read.token, VALID_TOKEN)
  assert.equal(read.remember, true)
  assert.equal(read.user.role, 'student')
})

test('auth-store: session-only persist keeps localStorage clear', () => {
  const sess = memStore()
  const loc = memStore()
  setStorageAdapters(sess, loc)
  persistAuth({ token: VALID_TOKEN, user: STUDENT_USER, remember: false })
  assert.equal(sess.getItem('authToken'), VALID_TOKEN)
  assert.equal(loc.getItem('authToken'), null)
  const read = readStoredAuth()
  assert.equal(read.remember, false)
})

test('auth-store: clearAuth clears state and both stores', () => {
  const sess = memStore()
  const loc = memStore()
  setStorageAdapters(sess, loc)
  setAuth({ token: VALID_TOKEN, user: STUDENT_USER })
  persistAuth({ token: VALID_TOKEN, user: STUDENT_USER, remember: true })
  clearAuth()
  assert.equal(authStore.token, null)
  assert.equal(authStore.user, null)
  assert.equal(readStoredAuth(), null)
  assert.equal(sess.getItem('authToken'), null)
  assert.equal(loc.getItem('authToken'), null)
})

test('auth-store: expired local remember token degrades to session', () => {
  const sess = memStore({
    authToken: 'session-token',
    'sufe.authUser': JSON.stringify({ id: 3, username: 'w', role: 'admin' }),
  })
  const loc = memStore({
    authToken: 'local-expired',
    'sufe.authUser': JSON.stringify({ id: 4, username: 'x', role: 'student' }),
    'sufe.authExpires': String(Date.now() - 1000),
  })
  setStorageAdapters(sess, loc)
  const read = readStoredAuth()
  assert.equal(read.token, 'session-token') // local expired -> dropped, session wins
  assert.equal(read.remember, false)
  assert.equal(loc.getItem('authToken'), null) // expired local keys cleared
})

/* ------------------------------------------------------------------ *
 * Unit: handle-dead-token toast dedup (PA-1g-F2)
 * ------------------------------------------------------------------ */

test('dead-token: concurrent 401s announce one toast; fresh session re-arms (PA-1g-F2)', async () => {
  // Resolve the Vite `@` alias for the REAL handle-dead-token module in Node
  // (same hook pattern as smoke-my-demands.mjs PA-1g-F1).
  const srcUrl = pathToFileURL(path.join(__dirname, '..', 'src') + '/').href
  const hook = 'data:text/javascript,' + encodeURIComponent(`
    let base = ''
    export function initialize(data) { base = data.src }
    export async function resolve(specifier, context, nextResolve) {
      if (specifier.startsWith('@/')) return nextResolve(new URL(specifier.slice(2), base).href, context)
      return nextResolve(specifier, context)
    }
  `)
  const { register } = await import('node:module')
  register(hook, { data: { src: srcUrl } })

  const { handleDeadToken } = await import('../src/modules/shell/handle-dead-token.js')
  const { toastState } = await import('../src/composables/useToast.js')
  const { setAuth, clearAuth } = await import('../src/modules/shell/auth-store.js')

  // showToast schedules auto-dismiss via window.setTimeout; stub it as a no-op so
  // toasts stay mounted for the whole assertion window. window.sessionStorage is
  // absent -> the try/catch-guarded storage helpers degrade silently.
  const prevWindow = globalThis.window
  globalThis.window = { setTimeout: () => {} }
  try {
    // logged-in burst of 3 concurrent 401s -> exactly one announcement
    setAuth({ token: 't1', user: { id: 1 } })
    handleDeadToken()
    handleDeadToken()
    handleDeadToken()
    assert.equal(toastState.items.length, 1, '3 concurrent 401s must announce exactly one toast (PA-1g-F2)')

    // fresh session (re-login) + a later 401 = a distinct expiry -> announced again
    setAuth({ token: 't2', user: { id: 2 } })
    handleDeadToken()
    assert.equal(toastState.items.length, 2, 'a fresh expiry after re-login must announce once more (PA-1g-F2)')

    // no live session + 401 -> never announce "login expired"
    clearAuth()
    handleDeadToken()
    assert.equal(toastState.items.length, 2, 'an anonymous 401 must not announce login-expired (PA-1g-F2)')
  } finally {
    globalThis.window = prevWindow
  }
})

/* ------------------------------------------------------------------ *
 * Browser smoke (real dist)
 * ------------------------------------------------------------------ */

function startPreview() {
  return new Promise((resolve, reject) => {
    const viteBin = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js')
    const proc = spawn(process.execPath, [viteBin, 'preview', '--port', String(PORT), '--strictPort'], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    const timer = setTimeout(() => {
      proc.kill()
      reject(new Error('vite preview start timeout. Have you run `npm run build`? Output:\n' + output))
    }, 20000)
    proc.stdout.on('data', (d) => {
      output += d
      // Strip ANSI color codes: vite paints "Local:" with escapes between chars.
      if (output.replace(/\[[0-9;]*m/g, '').includes('Local:')) {
        clearTimeout(timer)
        resolve(proc)
      }
    })
    proc.stderr.on('data', (d) => {
      output += d
    })
    proc.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error('vite preview exited ' + code + ':\n' + output))
    })
  })
}

function installApiMock(page) {
  return page.route('**/api/**', (route) => {
    const req = route.request()
    const url = req.url()
    const method = req.method()
    const token = req.headers()['x-auth-token'] || ''
    if (url.includes('/api/auth/login/code') && method === 'POST') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ user: STUDENT_USER, authToken: VALID_TOKEN }),
      })
    }
    if (url.includes('/api/auth/logout') && method === 'POST') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    }
    if (url.includes('/api/my-relations') && method === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(RELATIONS_FIXTURE) })
    }
    // I-17 conversation-list endpoint: ChatPage.onMounted -> loadConversations fires
    // GET /api/conversations on every /chat mount (the student role default page).
    // Without this branch the browser logs "Failed to load resource ... 404" console
    // errors and the final zero-violation assertion fails (PA-1h2-F1 loader gap).
    if (method === 'GET' && url.includes('/api/conversations') && !url.includes('/messages')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CONVERSATIONS_FIXTURE) })
    }
    // The student role-default page is /chat, whose ChatConversationPane mounts
    // during the restore/login flows and fires loadMessages + startActivePolling
    // against /api/conversations/*/messages. An empty window is a valid I-18
    // response and keeps the shell test free of incidental 404 console noise.
    if (method === 'GET' && url.includes('/api/conversations/') && url.includes('/messages')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages: [] }) })
    }
    if (url.includes('/api/auth/me')) {
      if (token === VALID_TOKEN) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: STUDENT_USER }) })
      }
      return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ code: 'UNAUTHORIZED' }) })
    }
    if (url.includes('/api/forced-401')) {
      return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ code: 'UNAUTHORIZED' }) })
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({}) })
  })
}

const EXPECTED_401_LOG = /Failed to load resource: the server responded with a status of 401/

function captureErrors(page, bucket) {
  page.on('console', (m) => {
    if (m.type() === 'error' && !EXPECTED_401_LOG.test(m.text())) bucket.push('console: ' + m.text())
  })
  page.on('pageerror', (e) => bucket.push('pageerror: ' + e.message))
  page.on('requestfailed', (r) => bucket.push('requestfailed: ' + r.url() + ' ' + (r.failure()?.errorText || '')))
}

function seedAuth(page, token, user) {
  return page.addInitScript(
    ({ t, u }) => {
      sessionStorage.setItem('authToken', t)
      sessionStorage.setItem('sufe.authUser', JSON.stringify(u))
    },
    { t: token, u: user },
  )
}

test('browser: shell routing + auth flows (real dist)', async () => {
  const preview = await startPreview()
  const browser = await chromium.launch()
  const errors = []
  try {
    /* --- landing (public) renders clean --- */
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    captureErrors(page, errors)
    await installApiMock(page)
    await page.goto(BASE + '/', { waitUntil: 'networkidle' })
    try {
      await page.waitForFunction(() => window.__APP__ && window.__APP__.authStore.ready === true, null, {
        timeout: 8000,
      })
    } catch (e) {
      const diag = await page
        .evaluate(() => ({
          hasApp: typeof window.__APP__ !== 'undefined',
          ready: window.__APP__ ? window.__APP__.authStore.ready : null,
          path: window.__APP__ ? window.__APP__.router.currentRoute.value.path : null,
          html: document.body ? document.body.innerHTML.slice(0, 300) : '(no body)',
        }))
        .catch((de) => ({ evalErr: de.message }))
      throw new Error('landing not ready. diag=' + JSON.stringify(diag) + ' capturedErrors=' + errors.join(' | '))
    }
    const landingVisible = await page.locator('.landing').count()
    assert.ok(landingVisible >= 1, 'landing should render at /')
    const publicRoute = await page.evaluate(() => window.__APP__.router.currentRoute.value.path)
    assert.equal(publicRoute, '/')
    const noAuthToken = await page.evaluate(() => window.__APP__.authStore.token)
    assert.equal(noAuthToken, null)
    await page.close()

    /* --- session restore: valid stored token enters role default page --- */
    const authed = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    captureErrors(authed, errors)
    await installApiMock(authed)
    await seedAuth(authed, VALID_TOKEN, STUDENT_USER)
    await authed.goto(BASE + '/', { waitUntil: 'networkidle' })
    await authed.waitForFunction(() => window.__APP__ && window.__APP__.authStore.ready === true)
    // Role default page is the first role-gated tab for the restored role (other
    // modules register student tabs, e.g. /chat), NOT necessarily /home. Assert the
    // app left the landing and entered a gated shell page.
    try {
      await authed.waitForFunction(() => window.__APP__.router.currentRoute.value.path !== '/', null, { timeout: 8000 })
    } catch (e) {
      const diag = await authed
        .evaluate(() => ({
          path: window.__APP__.router.currentRoute.value.path,
          token: window.__APP__.authStore.token,
          user: window.__APP__.authStore.user,
          sessToken: sessionStorage.getItem('authToken'),
          lastPage: sessionStorage.getItem('sufe.lastPage'),
          routes: window.__APP__.router.getRoutes().map((r) => r.path),
          body: document.body ? document.body.innerHTML.slice(0, 200) : '(no body)',
        }))
        .catch((de) => ({ evalErr: de.message }))
      throw new Error('restore did not leave landing. diag=' + JSON.stringify(diag) + ' capturedErrors=' + errors.join(' | '))
    }
    const restored = await authed.evaluate(() => ({
      role: window.__APP__.authStore.user.role,
      path: window.__APP__.router.currentRoute.value.path,
      token: window.__APP__.authStore.token,
    }))
    assert.equal(restored.role, 'student')
    assert.notEqual(restored.path, '/', 'restore must enter a gated shell page')
    assert.equal(restored.token, VALID_TOKEN)
    const topbarCount = await authed.locator('.topbar').count()
    assert.ok(topbarCount >= 1, 'top bar should render inside the shell')

    /* --- role gate: a student must not reach a teacher-only page (redirect) --- */
    const teacherRouteRegistered = await authed.evaluate(() =>
      window.__APP__.router.getRoutes().some((r) => r.path === '/teacher/demands'))
    assert.ok(teacherRouteRegistered, 'teacher route must be registered for a meaningful role-gate test')
    await authed.evaluate(() => window.__APP__.router.push('/teacher/demands'))
    await authed.waitForTimeout(300)
    const afterRoleGate = await authed.evaluate(() => window.__APP__.router.currentRoute.value.path)
    assert.notEqual(afterRoleGate, '/teacher/demands', 'role mismatch must redirect away from the teacher page')
    assert.notEqual(afterRoleGate, '/', 'role-mismatch redirect must land on a gated shell page, not the landing')

    /* --- role gate: unknown role accessing a protected page fails closed to landing --- */
    await authed.evaluate(() => {
      window.__APP__.authStore.user.role = 'ghost-role'
    })
    await authed.evaluate(() => window.__APP__.router.push('/home'))
    await authed.waitForTimeout(300)
    const afterUnknownRole = await authed.evaluate(() => window.__APP__.router.currentRoute.value.path)
    assert.equal(afterUnknownRole, '/', 'unknown role must fail closed to the landing')

    /* --- last-page memory: reload stays on the remembered page --- */
    await authed.reload({ waitUntil: 'networkidle' })
    await authed.waitForFunction(() => window.__APP__ && window.__APP__.authStore.ready === true)
    await authed.waitForFunction(() => window.__APP__.router.currentRoute.value.path !== '/', null, { timeout: 8000 })
    const afterReload = await authed.evaluate(() => window.__APP__.router.currentRoute.value.path)
    assert.equal(afterReload, restored.path, 'reload should restore the remembered last page')

    /* --- login action: clears prior state then sets token+user (F7) --- */
    await authed.evaluate(() => {
      sessionStorage.clear()
      localStorage.clear()
    })
    await authed.evaluate(() => window.__APP__.clearAuth())
    const loginResult = await authed.evaluate(async () => {
      const user = await window.__APP__.login({ identifier: 'qa_student', code: '123456', remember: true })
      return { user, token: window.__APP__.authStore.token, sess: sessionStorage.getItem('authToken') }
    })
    assert.equal(loginResult.user.role, 'student')
    assert.equal(loginResult.token, VALID_TOKEN)
    assert.equal(loginResult.sess, VALID_TOKEN)

    /* --- /relations integration: role-gated route enters + board renders (I-15) --- */
    // The relations page registers `/relations` for student+teacher. This case
    // proves registration == actually reachable inside the shell: a logged-in
    // student must pass the role gate, the shell top bar must mount, and the
    // I-15 payload must drive the board + avatars to render (no 404 / dead UI).
    await authed.evaluate(() => window.__APP__.router.push('/relations'))
    await authed.waitForFunction(() => window.__APP__.router.currentRoute.value.path === '/relations', null, {
      timeout: 8000,
    })
    const relPath = await authed.evaluate(() => window.__APP__.router.currentRoute.value.path)
    assert.equal(relPath, '/relations', 'student must be allowed into /relations (role gate)')
    const relTopbar = await authed.locator('.topbar').count()
    assert.ok(relTopbar >= 1, 'shell top bar must mount on /relations')
    // I-15 fetch completes -> ready branch renders board + avatars. Board presence
    // proves the non-empty ready branch; >=2 avatars proves data (self + >=1 other)
    // flowed through the mock, not just an empty shell.
    await authed.waitForSelector('.relations-board', { timeout: 8000 })
    await authed.waitForSelector('.rel-avatar', { timeout: 8000 })
    const relAvatarCount = await authed.locator('.rel-avatar').count()
    assert.ok(relAvatarCount >= 2, `relations board must render self + >=1 other avatar, got ${relAvatarCount}`)
    // TabBar carries the relations tab labelled by RELATIONS_COPY.PAGE_TITLE (D4
    // copy single source: the tab label and the page heading read the same key).
    const relTab = authed.locator('.tabbar__tab', { hasText: RELATIONS_COPY.PAGE_TITLE })
    assert.ok((await relTab.count()) >= 1, 'tab bar must include the relations tab with PAGE_TITLE copy')
    // Geometry (G5): board + shell must not overflow the 1440x900 viewport.
    const relOverflowDesktop = await authed.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    )
    assert.equal(relOverflowDesktop, false, 'relations board must not overflow at 1440px')

    /* --- ChatButton: top-bar C2 entry navigates to the chat page (PA-1h2-M2) --- */
    // From /relations, clicking the top-bar chat-bubble button must enter the M4
    // chat page. The button resolves the C2 page by its interface-cap marker meta.c2
    // (data-cap="M4.c2" on the button); a dead hardcoded path lookup or a name
    // mismatch leaves the route inert, so this is a G2 mutation guard for the
    // chat/pages.js meta.c2 alignment.
    const chatBtn = authed.locator('.chat-btn')
    assert.ok((await chatBtn.count()) >= 1, 'top bar must render the ChatButton')
    await chatBtn.click()
    await authed.waitForFunction(() => window.__APP__.router.currentRoute.value.path === '/chat', null, {
      timeout: 8000,
    })
    const chatPath = await authed.evaluate(() => window.__APP__.router.currentRoute.value.path)
    assert.equal(chatPath, '/chat', 'ChatButton must navigate to the C2 chat page (/chat)')
    // The /api/conversations mock feeds one I-17 row -> the chat list renders a card
    // (functional: the conversation page is reachable and populated, not a blank shell).
    await authed.waitForSelector('.chat-card', { timeout: 8000 })
    const chatCardCount = await authed.locator('.chat-card').count()
    assert.ok(chatCardCount >= 1, 'chat list must render the mocked conversation row')

    /* --- /relations compact: 375px no horizontal overflow (G5) --- */
    // Fresh context: browser.newPage() shares the default context's storage with
    // `authed`, which is logged in (token + lastPage in sessionStorage). An
    // isolated context keeps this case deterministic regardless of test order.
    const relMobileCtx = await browser.newContext({ viewport: { width: 375, height: 700 } })
    const relMobile = await relMobileCtx.newPage()
    const relMobileErrors = []
    captureErrors(relMobile, relMobileErrors)
    await installApiMock(relMobile)
    await seedAuth(relMobile, VALID_TOKEN, STUDENT_USER)
    await relMobile.goto(BASE + '/', { waitUntil: 'networkidle' })
    await relMobile.waitForFunction(() => window.__APP__ && window.__APP__.authStore.ready === true)
    await relMobile.evaluate(() => window.__APP__.router.push('/relations'))
    await relMobile.waitForFunction(() => window.__APP__.router.currentRoute.value.path === '/relations', null, {
      timeout: 8000,
    })
    await relMobile.waitForSelector('.relations-board', { timeout: 8000 })
    const relOverflowMobile = await relMobile.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    )
    assert.equal(relOverflowMobile, false, 'relations board must not overflow at 375px')
    errors.push(...relMobileErrors)
    await relMobile.close()
    await relMobileCtx.close()

    /* --- W43 negative: unauthenticated /relations is gated back to landing --- */
    // Fresh context (no shared token) so the guard's auth gate actually fires.
    const anonCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const anon = await anonCtx.newPage()
    const anonErrors = []
    captureErrors(anon, anonErrors)
    await installApiMock(anon)
    await anon.goto(BASE + '/', { waitUntil: 'networkidle' })
    await anon.waitForFunction(() => window.__APP__ && window.__APP__.authStore.ready === true)
    await anon.evaluate(() => window.__APP__.router.push('/relations'))
    await anon.waitForTimeout(300)
    const anonPath = await anon.evaluate(() => window.__APP__.router.currentRoute.value.path)
    assert.equal(anonPath, '/', 'unauthenticated /relations must redirect to the landing (role gate)')
    const anonBoard = await anon.locator('.relations-board').count()
    assert.equal(anonBoard, 0, 'relations board must not render for an unauthenticated user')
    errors.push(...anonErrors)
    await anon.close()
    await anonCtx.close()

    /* --- 401 single-point dead-token fallback (PA-1g-F2: concurrent burst -> one toast) --- */
    // Three parallel authenticated requests all 401 together — the exact reported
    // failure (first-screen burst stacking 3 "login expired" toasts). The dead-token
    // fallback must still clear state exactly once and announce exactly one toast.
    await authed.evaluate(() =>
      Promise.all([
        window.__APP__.api('/forced-401').catch(() => {}),
        window.__APP__.api('/forced-401').catch(() => {}),
        window.__APP__.api('/forced-401').catch(() => {}),
      ]),
    )
    await authed.waitForFunction(() => window.__APP__.router.currentRoute.value.path === '/', null, { timeout: 8000 })
    await authed.waitForTimeout(300)
    const dead = await authed.evaluate(() => ({
      token: window.__APP__.authStore.token,
      user: window.__APP__.authStore.user,
      sess: sessionStorage.getItem('authToken'),
    }))
    assert.equal(dead.token, null, '401 must clear authStore.token')
    assert.equal(dead.user, null, '401 must clear authStore.user')
    assert.equal(dead.sess, null, '401 must clear the session storage token')
    const toastCount = await authed.locator('.ui-toast').count()
    assert.equal(toastCount, 1, '3 concurrent 401s must show exactly one login-expired toast (PA-1g-F2)')
    const toastText = await authed.locator('.ui-toast').first().textContent()
    assert.ok(
      toastText.includes(SHELL_COPY.LOGIN_EXPIRED),
      'dead-token toast should carry the LOGIN_EXPIRED copy (D3), got: ' + toastText,
    )

    /* --- logout action clears state --- */
    const logoutResult = await authed.evaluate(async () => {
      // Re-establish a token so logout has something to clear.
      await window.__APP__.login({ identifier: 'qa_student', code: '123456' })
      await window.__APP__.logout()
      return {
        token: window.__APP__.authStore.token,
        user: window.__APP__.authStore.user,
        sess: sessionStorage.getItem('authToken'),
      }
    })
    assert.equal(logoutResult.token, null)
    assert.equal(logoutResult.user, null)
    assert.equal(logoutResult.sess, null)
    await authed.close()

    /* --- 375 no horizontal overflow: landing (public) --- */
    const mobile = await browser.newPage({ viewport: { width: 375, height: 700 } })
    const mobileErrors = []
    captureErrors(mobile, mobileErrors)
    await installApiMock(mobile)
    await mobile.goto(BASE + '/', { waitUntil: 'networkidle' })
    const landingOverflow = await mobile.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    )
    assert.equal(landingOverflow, false, 'landing must not overflow at 375px')
    await mobile.close()

    /* --- 375 no overflow: shell top bar (authed) --- */
    const shellMobile = await browser.newPage({ viewport: { width: 375, height: 700 } })
    const shellErrors = []
    captureErrors(shellMobile, shellErrors)
    await installApiMock(shellMobile)
    await seedAuth(shellMobile, VALID_TOKEN, STUDENT_USER)
    await shellMobile.goto(BASE + '/', { waitUntil: 'networkidle' })
    await shellMobile.waitForFunction(() => window.__APP__ && window.__APP__.authStore.ready === true)
    await shellMobile.waitForFunction(() => window.__APP__.router.currentRoute.value.path !== '/', null, { timeout: 8000 })
    const shellOverflow = await shellMobile.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    )
    assert.equal(shellOverflow, false, 'shell top bar must not overflow at 375px')
    errors.push(...shellErrors)
    await shellMobile.close()

    // No console/pageerror/CSP violations across every scenario.
    assert.deepEqual(errors, [], 'zero console/pageerror/CSP violations expected, got: ' + errors.join(' | '))
  } finally {
    await browser.close()
    preview.kill()
  }
})
