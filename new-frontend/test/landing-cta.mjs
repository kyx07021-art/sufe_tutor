/**
 * landing-cta.mjs - PA-1h1-F1 landing hero CTA wiring
 * ---------------------------------------------------------
 * - The hero `data-cap="enter.student"/"enter.teacher"` seam must be consumed.
 *   An anonymous visitor clicking a CTA opens the identity-auth overlay; a
 *   logged-in visitor with the matching role is routed to that role's default
 *   (role-gated) page.
 * - Real dev server (BASE, default :5199). /api/** is mocked so the routed
 *   chat page and any incidental fetches stay clean (no 404 console noise);
 *   chat endpoints return their real empty shapes, everything else 200 empty.
 * - Run: node --test test/landing-cta.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert'
import { chromium } from 'playwright'

const BASE = process.env.BASE || 'http://localhost:5199'
const STUDENT_USER = { id: 1, username: 'qa_student', role: 'student', avatar: '' }
const VALID_TOKEN = 'test-valid-token'

function captureErrors(page, bucket) {
  page.on('console', (m) => m.type() === 'error' && bucket.push('console: ' + m.text()))
  page.on('pageerror', (e) => bucket.push('pageerror: ' + e.message))
  page.on('requestfailed', (r) => bucket.push('requestfailed: ' + r.url() + ' ' + (r.failure()?.errorText || '')))
}

function installApiMock(page) {
  return page.route('**/api/**', (route) => {
    const req = route.request()
    const url = req.url()
    const method = req.method()
    if (url.includes('/api/auth/me') && method === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: STUDENT_USER }) })
    }
    // AK-L-F1: password login returns a real session so finishSuccess() fires
    // and the hero's onVerified routes into the client.
    if (url.includes('/api/auth/login') && method === 'POST' && !url.includes('/code')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: STUDENT_USER, authToken: VALID_TOKEN }) })
    }
    if (url.includes('/api/conversations') && method === 'GET') {
      if (url.includes('/messages')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages: [] }) })
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ conversations: [] }) })
    }
    // Default 200 empty body: no 404 browser console noise; consumers degrade silently.
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) })
  })
}

async function gotoLanding(browser, { seedAuth = false } = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  captureErrors(page, errors)
  await installApiMock(page)
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.waitForSelector('.landing-hero__btn', { timeout: 10000 })
  await page.waitForFunction(() => window.__APP__ && window.__APP__.authStore.ready === true, null, { timeout: 8000 })
  if (seedAuth) {
    await page.evaluate(
      ({ t, u }) => {
        window.__APP__.authStore.token = t
        window.__APP__.authStore.user = u
      },
      { t: VALID_TOKEN, u: STUDENT_USER },
    )
  }
  return { page, errors }
}

test('F1: anonymous CTA click opens the identity-auth overlay', async () => {
  const browser = await chromium.launch()
  try {
    const { page, errors } = await gotoLanding(browser)
    try {
      const before = await page.locator('.ui-modal').count()
      assert.equal(before, 0, 'no auth modal before the CTA click')
      await page.click('.landing-hero__btn[data-cap="enter.student"]')
      await page.waitForSelector('.ui-modal', { timeout: 5000 })
      const after = await page.locator('.ui-modal').count()
      assert.equal(after, 1, 'CTA click must open the identity-auth modal')
      assert.deepEqual(errors, [], 'zero console/pageerror expected, got: ' + errors.join(' | '))
    } finally {
      await page.close()
    }
  } finally {
    await browser.close()
  }
})

test('F1: logged-in student CTA routes to a student-gated page', async () => {
  const browser = await chromium.launch()
  try {
    const { page, errors } = await gotoLanding(browser, { seedAuth: true })
    try {
      await page.click('.landing-hero__btn[data-cap="enter.student"]')
      await page.waitForFunction(() => window.__APP__.router.currentRoute.value.path !== '/', null, { timeout: 8000 })
      const state = await page.evaluate(() => ({
        path: window.__APP__.router.currentRoute.value.path,
        roles: window.__APP__.router.currentRoute.value.meta.roles || [],
      }))
      assert.ok(
        state.roles.includes('student'),
        'logged-in student CTA must land on a student-gated route, got ' + JSON.stringify(state),
      )
      const modal = await page.locator('.ui-modal').count()
      assert.equal(modal, 0, 'logged-in CTA must not open the auth modal')
      assert.deepEqual(errors, [], 'zero console/pageerror expected, got: ' + errors.join(' | '))
    } finally {
      await page.close()
    }
  } finally {
    await browser.close()
  }
})

/** Drag the puzzle knob to a normalized offset (0..1); CaptchaPuzzle exposes
    its current offset via window.__authPuzzleDebug (local pass, AK-A1a). */
async function dragPuzzleTo(page, offset) {
  const knob = page.locator('.captcha-puzzle__knob')
  await knob.waitFor({ state: 'visible', timeout: 5000 })
  const box = await knob.boundingBox()
  if (!box) throw new Error('puzzle knob missing')
  const dbg = await page.evaluate(() => window.__authPuzzleDebug || { offset: 0 })
  const scale = await page.evaluate(() => {
    const cv = document.querySelector('.captcha-puzzle__canvas')
    return cv ? cv.clientWidth / 280 : 1
  })
  const current = (dbg.offset || 0) * 240 * scale
  const desired = Math.max(0, Math.min(1, offset)) * 240 * scale
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + (desired - current), box.y + box.height / 2, { steps: 8 })
  await page.mouse.up()
}

test('AK-L-F1: a fresh login from the hero routes into the client (no stranded landing)', async () => {
  const browser = await chromium.launch()
  try {
    const { page, errors } = await gotoLanding(browser)
    try {
      // CTA -> register modal -> flip to the login scene (switch keeps onVerified).
      await page.click('.landing-hero__btn[data-cap="enter.student"]')
      await page.waitForSelector('.ui-modal', { timeout: 5000 })
      await page.click('.auth-shell__switch-login')
      // password method: identifier + password + puzzle + confirm
      await page.locator('.method-switch .ui-btn', { hasText: '密码验证' }).click()
      await page.locator('.password-row__identifier .ui-input__ta').fill('alice')
      await page.locator('.password-row__password .ui-input__native').fill('secret123')
      await dragPuzzleTo(page, await page.evaluate(() => (window.__authPuzzleDebug || {}).target))
      await page.waitForTimeout(300)
      const confirmBtn = page.locator('.auth-shell__footer .ui-btn--fill-brand')
      await confirmBtn.waitFor({ state: 'visible' })
      if (await confirmBtn.isDisabled()) throw new Error('confirm should enable after credential + puzzle')
      await confirmBtn.click()
      // onVerified routes into the client automatically.
      await page.waitForFunction(() => window.__APP__.router.currentRoute.value.path !== '/', null, { timeout: 8000 })
      const state = await page.evaluate(() => ({
        path: window.__APP__.router.currentRoute.value.path,
        roles: window.__APP__.router.currentRoute.value.meta.roles || [],
      }))
      assert.ok(
        state.roles.includes('student'),
        'post-login must land on a student-gated route (AK-L-F1), got ' + JSON.stringify(state),
      )
      // the modal close runs its transition — wait for it to finish, then assert gone
      await page.waitForFunction(() => document.querySelectorAll('.ui-modal').length === 0, null, { timeout: 5000 })
      const modal = await page.locator('.ui-modal').count()
      assert.equal(modal, 0, 'auth modal must close after login')
      assert.deepEqual(errors, [], 'zero console/pageerror expected, got: ' + errors.join(' | '))
    } finally {
      await page.close()
    }
  } finally {
    await browser.close()
  }
})
