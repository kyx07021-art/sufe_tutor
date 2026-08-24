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
import { readFileSync } from 'node:fs'
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
const TEACHER_USER = { id: 2, username: 'qa_teacher', role: 'teacher', avatar: '' }

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
// I-26 notifications fixture (mutable): [] keeps the badge hidden; a row with
// is_read:false drives the red dot visible (PA-2-F13 positive path).
let notificationsFixture = []

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

test('contract: logo.svg is the four-square mark (AK-N-B3)', () => {
  const src = readFileSync(path.join(ROOT, 'src', 'assets', 'svg', 'logo.svg'), 'utf8')
  const rects = (src.match(/<rect\b/g) || []).length
  assert.equal(rects, 4, 'AK-N-B3: logo must be a 2x2 four-square grid (was a single square with a hole)')
  assert.ok(src.includes('fill="var(--brand)"'), 'AK-N-B3: the bottom-right square must be brand purple')
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

function installApiMock(page, authedUser = STUDENT_USER) {
  return page.route('**/api/**', (route) => {
    const req = route.request()
    const url = req.url()
    const method = req.method()
    const token = req.headers()['x-auth-token'] || ''
    if (url.includes('/api/auth/login/code') && method === 'POST') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ user: authedUser, authToken: VALID_TOKEN }),
      })
    }
    if (url.includes('/api/auth/logout') && method === 'POST') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    }
    if (url.includes('/api/my-relations') && method === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(RELATIONS_FIXTURE) })
    }
    // I-29 teacher list: the student role default page is /teacher-square (AK-N-B1),
    // so every authed student restore mounts TeacherSquarePage and fires
    // GET /api/teachers - answer an empty list to keep the shell test free of
    // incidental 404 console noise.
    if (url.includes('/api/teachers') && method === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], total: 0 }) })
    }
    // I-33/34 demand list: the teacher role default page is /teacher/demands
    // (AK-N-B1), so an authed teacher restore mounts the B1 demand plaza and
    // fires GET /api/demands - answer an empty list.
    if (url.includes('/api/demands') && method === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], total: 0 }) })
    }
    // I-17 conversation-list endpoint: ChatPage.onMounted -> loadConversations fires
    // GET /api/conversations on every /chat mount (reached via the ChatButton below
    // and by manual navigation). Without this branch the browser logs "Failed to load
    // resource ... 404" console errors and the final zero-violation assertion fails.
    if (method === 'GET' && url.includes('/api/conversations') && !url.includes('/messages')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CONVERSATIONS_FIXTURE) })
    }
    // The C2 chat page's ChatConversationPane fires loadMessages + startActivePolling
    // against /api/conversations/*/messages. An empty window is a valid I-18
    // response and keeps the shell test free of incidental 404 console noise.
    if (method === 'GET' && url.includes('/api/conversations/') && url.includes('/messages')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages: [] }) })
    }
    if (url.includes('/api/auth/me')) {
      if (token === VALID_TOKEN) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: authedUser }) })
      }
      return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ code: 'UNAUTHORIZED' }) })
    }
    // I-26 notifications: NotifyButton mounts with the logged-in shell and starts
    // the badge poll (GET /api/notifications). Without this branch the 404 fallback
    // below logs a console error and the zero-violation assertion fails. The
    // fixture is mutable so the test can flip between empty (dot hidden) and one
    // unread (dot shown) without re-installing the mock.
    if (url.includes('/api/notifications') && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ notifications: notificationsFixture }),
      })
    }
    // I-27 mark-read (per-id + read-all): the C3 modal fires POST
    // /api/notifications/:id/read on exit-read for each unread revealed card, and
    // the card detail marks single reads the same way. Without this branch the
    // POST falls through to the 404 stub and the zero-violation assertion fails.
    // Flip the matching fixture item read so the persisted store matches.
    if (url.includes('/api/notifications') && method === 'POST') {
      const m = url.match(/\/api\/notifications\/(\d+)\/read$/)
      if (m) {
        const id = m[1]
        notificationsFixture = notificationsFixture.map((n) =>
          String(n.id) === id ? { ...n, is_read: true } : n,
        )
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
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
    // AK-N-B1: the role default page is the plaza (meta.home), NOT the first
    // alphabetically-registered tab. A student must land on /teacher-square
    // (广场 -> 自己的东西 -> 会话 -> 关系 progression), not /chat.
    try {
      await authed.waitForFunction(
        () => window.__APP__.router.currentRoute.value.path === '/teacher-square',
        null,
        { timeout: 8000 },
      )
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
      throw new Error('student restore did not enter /teacher-square. diag=' + JSON.stringify(diag) + ' capturedErrors=' + errors.join(' | '))
    }
    const restored = await authed.evaluate(() => ({
      role: window.__APP__.authStore.user.role,
      path: window.__APP__.router.currentRoute.value.path,
      token: window.__APP__.authStore.token,
    }))
    assert.equal(restored.role, 'student')
    assert.equal(restored.path, '/teacher-square', 'AK-N-B1: student default page must be the teacher-square plaza')
    assert.equal(restored.token, VALID_TOKEN)
    const topbarCount = await authed.locator('.topbar').count()
    assert.ok(topbarCount >= 1, 'top bar should render inside the shell')

    /* --- AK-N-B1: tab order = 广场 -> 自己的东西 -> 会话 -> 关系 --- */
    const studentTabs = await authed.locator('.tabbar__tab').allTextContents()
    assert.deepEqual(
      studentTabs,
      ['教师广场', '我的需求', '会话', '关系管理'],
      'AK-N-B1: student tab order must be plaza -> own (my-demands) -> chat -> relations, got: ' + studentTabs.join(','),
    )

    /* --- AK-N-B2: the three top-bar icons share one spec (20px glyph, 40px carrier) --- */
    // Chat bubble (ChatButton), envelope (NotifyButton) and the placeholder person
    // (UserArea) must be identical glyph size + carrier size. Reverting the person
    // icon to 32px / gray-50 makes the glyph assertion red (G2 mutation guard).
    const iconSpecs = await authed.evaluate(() => {
      const pick = (sel) => {
        const el = document.querySelector(sel)
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { w: Math.round(r.width), h: Math.round(r.height) }
      }
      return {
        chat: pick('.chat-btn__svg'),
        notify: pick('.notify-btn__svg'),
        person: pick('.user-area__avatar-placeholder'),
        chatCarrier: pick('.chat-btn'),
        notifyCarrier: pick('.notify-btn'),
        personCarrier: pick('.user-area__avatar-btn'),
      }
    })
    for (const k of ['chat', 'notify', 'person']) {
      assert.deepEqual(iconSpecs[k], { w: 20, h: 20 }, `AK-N-B2: top-bar icon "${k}" must be 20x20, got ${JSON.stringify(iconSpecs[k])}`)
    }
    for (const k of ['chatCarrier', 'notifyCarrier', 'personCarrier']) {
      assert.deepEqual(iconSpecs[k], { w: 40, h: 40 }, `AK-N-B2: top-bar icon carrier "${k}" must be 40x40, got ${JSON.stringify(iconSpecs[k])}`)
    }
    const personColor = await authed.evaluate(() => {
      const el = document.querySelector('.user-area__avatar-placeholder')
      return el ? getComputedStyle(el).color : null
    })
    assert.equal(personColor, 'rgb(26, 26, 26)', 'AK-N-B2: placeholder person icon must be ink (was gray-50)')

    /* --- AK-N-B4: top-left brand = LOGO + platform name in a B button --- */
    // The top bar brand must be the LOGO glyph + the full platform name (single
    // source SHELL_COPY.LOGO_NAME), not a bare logo. Reverting the name (or the
    // full-name copy) makes the DOM-presence assertion red (G2 mutation guard).
    const logoNameCount = await authed.locator('.topbar-logo__name').count()
    assert.ok(logoNameCount >= 1, 'AK-N-B4: top bar must render the platform name next to the LOGO')
    const logoNameText = await authed.textContent('.topbar-logo__name')
    assert.equal(logoNameText, SHELL_COPY.LOGO_NAME, 'AK-N-B4: platform name must be the SHELL_COPY.LOGO_NAME single source')
    const logoGlyphCount = await authed.locator('.topbar-logo__svg').count()
    assert.ok(logoGlyphCount >= 1, 'AK-N-B4: top bar must render the LOGO glyph')
    // Layout geometry (G5): the name must sit a full --space-4 (16px) to the right
    // of the LOGO, on the same horizontal baseline (±2px), and the whole brand row
    // must stay inside the 40px button. Reverting the flex row on the button label
    // (the vertical-stacking FAIL: name lands under the LOGO) makes the gap and
    // baseline assertions red; removing the name nulls the geometry object (G2).
    const brandGeo = await authed.evaluate(() => {
      const btn = document.querySelector('.topbar-logo')
      const svg = document.querySelector('.topbar-logo__svg')
      const name = document.querySelector('.topbar-logo__name')
      if (!btn || !svg || !name) return null
      const b = btn.getBoundingClientRect()
      const s = svg.getBoundingClientRect()
      const n = name.getBoundingClientRect()
      return {
        btn: { left: b.left, right: b.right, top: b.top, bottom: b.bottom },
        svg: { left: s.left, right: s.right, top: s.top, bottom: s.bottom },
        name: { left: n.left, right: n.right, top: n.top, bottom: n.bottom },
      }
    })
    assert.ok(brandGeo, 'AK-N-B4: brand geometry must resolve (button/svg/name all in DOM)')
    const brandGap = brandGeo.name.left - brandGeo.svg.right
    assert.ok(brandGap >= 16, `AK-N-B4: name must sit >= --space-4(16px) right of the LOGO, gap was ${brandGap}px`)
    const brandBaseline = Math.abs(brandGeo.name.top - brandGeo.svg.top)
    assert.ok(brandBaseline <= 2, `AK-N-B4: LOGO and name must share one horizontal baseline (tol ±2), diff ${brandBaseline}px`)
    assert.ok(
      brandGeo.name.right <= brandGeo.btn.right + 0.5,
      `AK-N-B4: the button must contain the whole brand name (name.right ${brandGeo.name.right} > btn.right ${brandGeo.btn.right})`,
    )
    assert.ok(
      brandGeo.name.top >= brandGeo.btn.top - 0.5 && brandGeo.name.bottom <= brandGeo.btn.bottom + 0.5,
      'AK-N-B4: the brand name must fit vertically inside the button',
    )

    /* --- AK-N-B1: teacher default page = /teacher/demands (B1 demand plaza) --- */
    const teacherCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const teacherPage = await teacherCtx.newPage()
    const teacherErrors = []
    captureErrors(teacherPage, teacherErrors)
    await installApiMock(teacherPage, TEACHER_USER)
    await seedAuth(teacherPage, VALID_TOKEN, TEACHER_USER)
    await teacherPage.goto(BASE + '/', { waitUntil: 'networkidle' })
    await teacherPage.waitForFunction(() => window.__APP__ && window.__APP__.authStore.ready === true)
    await teacherPage.waitForFunction(
      () => window.__APP__.router.currentRoute.value.path === '/teacher/demands',
      null,
      { timeout: 8000 },
    )
    const teacherDefaultPath = await teacherPage.evaluate(() => window.__APP__.router.currentRoute.value.path)
    assert.equal(teacherDefaultPath, '/teacher/demands', 'AK-N-B1: teacher default page must be the B1 demand plaza')
    const teacherTabs = await teacherPage.locator('.tabbar__tab').allTextContents()
    assert.deepEqual(
      teacherTabs,
      ['需求广场', '我的信息', '资料广场', '会话', '关系管理'],
      'AK-N-B1: teacher tab order must be plaza -> own -> chat -> relations, got: ' + teacherTabs.join(','),
    )
    errors.push(...teacherErrors)
    await teacherPage.close()
    await teacherCtx.close()

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

    /* --- NotifyButton: unread red dot reflects the I-26 list (PA-2-F13) --- */
    // The envelope button renders in the authed top bar and mounts a badge poll.
    // With the empty-notifications mock the dot must be hidden; after a
    // mark-as-read-free reload the count derives from the mocked list (unread=0).
    const notifyBtn = authed.locator('.notify-btn')
    assert.ok((await notifyBtn.count()) >= 1, 'top bar must render the NotifyButton')
    await authed.waitForSelector('.notify-btn__icon', { timeout: 8000 })
    const dotCount = await authed.locator('.notify-btn__dot').count()
    assert.equal(dotCount, 0, 'unread dot must be hidden when the notification list is empty')
    // Positive path (PA-2-F13): an unread notification must turn the dot on.
    // Flip the mutable fixture to one unread, then open C3 — openC3 calls the
    // app's loadNotifications, which writes notifyState -> unreadCountRef bumps
    // and the dot appears while the modal is still open.
    notificationsFixture = [{ id: 9, title: '测试通知', content: 'unread', created_at: '2026-08-23T10:00:00', is_read: false }]
    await notifyBtn.click()
    await authed.waitForSelector('.ui-modal', { timeout: 8000 })
    await authed.waitForSelector('.notify-btn__dot', { timeout: 8000 })
    const dotVisible = await authed.locator('.notify-btn__dot').count()
    assert.equal(dotVisible, 1, 'unread dot must show when an unread notification exists')
    notificationsFixture = []
    await authed.mouse.click(20, 20)
    await authed.waitForSelector('.ui-modal', { state: 'detached', timeout: 8000 })

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
    // AK-N-B4 at 375px: the brand name renders with the single-source copy and the
    // top bar does not push the page wider (asserted above). On a 375px shell the
    // name ellipsizes — shrinking to nothing when the right cluster + tabs take
    // priority — without spilling off-screen (G5 "不溢出" contract; the desktop
    // geometry block above owns the gap/baseline/containment assertions).
    const brandNameMobile = await shellMobile.locator('.topbar-logo__name').count()
    assert.ok(brandNameMobile >= 1, 'AK-N-B4: brand name must render at 375px')
    const brandNameMobileText = await shellMobile.textContent('.topbar-logo__name')
    assert.equal(brandNameMobileText, SHELL_COPY.LOGO_NAME, 'AK-N-B4: brand name single source must hold at 375px')
    errors.push(...shellErrors)
    await shellMobile.close()

    // No console/pageerror/CSP violations across every scenario.
    assert.deepEqual(errors, [], 'zero console/pageerror/CSP violations expected, got: ' + errors.join(' | '))
  } finally {
    await browser.close()
    preview.kill()
  }
})
