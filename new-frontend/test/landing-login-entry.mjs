/**
 * landing-login-entry.mjs - AK-B1 hero CTA as THE client entry + modal login switch
 * ---------------------------------------------------------
 * - AK-B1: the two hero CTAs ("我要找家教" / "我要做家教") are the client entry —
 *   an anonymous visitor opens the identity-auth register modal (which carries
 *   the flip-to-login switch), a logged-in visitor is routed to the CTA role's
 *   default page. There is NO standalone "已有账号？登录" link on the hero
 *   (the returning-user login path lives inside the auth modal, PA-2-F1 seam
 *   retained as the register-pane switch).
 * - Asserts: (1) anonymous landing renders no `.landing-hero__login` link (G2:
 *   re-adding it goes red); (2) the hero CTA opens the register modal with the
 *   flip-to-login switch; (3) the switch flips the register pane to the login
 *   scene; (4) a logged-in student CTA routes to a student-gated page.
 * - Real dev server (BASE, default :5173). /api/** is mocked so incidental
 *   fetches stay clean (same pattern as landing-cta.mjs / mobile-register-modal.mjs).
 * - Run: node --test test/landing-login-entry.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert'
import { chromium } from 'playwright'

const BASE = process.env.BASE || 'http://localhost:5173'
const STUDENT_USER = { id: 1, username: 'qa_student', role: 'student', avatar: '' }
const VALID_TOKEN = 'test-valid-token'

function captureErrors(page, bucket) {
  page.on('console', (m) => m.type() === 'error' && bucket.push('console: ' + m.text()))
  page.on('pageerror', (e) => bucket.push('pageerror: ' + e.message))
  page.on('requestfailed', (r) => bucket.push('requestfailed: ' + r.url() + ' ' + (r.failure()?.errorText || '')))
}

function installApiMock(page, { user = null } = {}) {
  return page.route('**/api/**', (route) => {
    const req = route.request()
    const url = req.url()
    const method = req.method()
    if (url.includes('/api/auth/me') && method === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user }) })
    }
    if (url.includes('/api/conversations') && method === 'GET') {
      if (url.includes('/messages')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages: [] }) })
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ conversations: [] }) })
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) })
  })
}

async function gotoLanding(browser, { seedAuth = false } = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  captureErrors(page, errors)
  await installApiMock(page, { user: seedAuth ? STUDENT_USER : null })
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

test('AK-B1: anonymous landing shows no standalone login link - the hero CTAs are the entry', async () => {
  const browser = await chromium.launch()
  try {
    const { page, errors } = await gotoLanding(browser)
    try {
      // G2 negative: the standalone hero login link must not exist (AK-B1 deleted it).
      assert.equal(
        await page.locator('.landing-hero__login[data-cap="enter.login"]').count(),
        0,
        'AK-B1 removed the standalone hero login link; re-adding it violates the client-entry design',
      )
      const ctas = page.locator('.landing-hero__btn')
      assert.equal(await ctas.count(), 2, 'the two hero CTA buttons are the client entry')
      assert.equal(await ctas.first().isVisible(), true, 'student CTA must be visible')
      assert.equal(await ctas.nth(1).isVisible(), true, 'teacher CTA must be visible')
      assert.deepEqual(errors, [], 'zero console/pageerror expected, got: ' + errors.join(' | '))
    } finally {
      await page.close()
    }
  } finally {
    await browser.close()
  }
})

test('AK-B1: anonymous hero CTA opens the register modal with the flip-to-login switch', async () => {
  const browser = await chromium.launch()
  try {
    const { page, errors } = await gotoLanding(browser)
    try {
      assert.equal(await page.locator('.ui-modal').count(), 0, 'no auth modal before the CTA click')
      await page.click('.landing-hero__btn[data-cap="enter.student"]')
      await page.waitForSelector('.ui-modal', { timeout: 5000 })
      assert.equal(await page.locator('.register-pane').count(), 1, 'anonymous CTA must open the register pane')
      const switchLink = page.locator('.register-pane__switch-login')
      assert.equal(await switchLink.count(), 1, 'register pane must expose the flip-to-login switch')
      assert.equal(await switchLink.isVisible(), true, 'flip-to-login switch must be visible')
      assert.deepEqual(errors, [], 'zero console/pageerror expected, got: ' + errors.join(' | '))
    } finally {
      await page.close()
    }
  } finally {
    await browser.close()
  }
})

test('AK-B1: register pane flips to the login scene via the switch link', async () => {
  const browser = await chromium.launch()
  try {
    const { page, errors } = await gotoLanding(browser)
    try {
      // The returning-user login path lives inside the auth modal (PA-2-F1 seam).
      await page.click('.landing-hero__btn[data-cap="enter.student"]')
      await page.waitForSelector('.register-pane', { timeout: 5000 })
      assert.equal(await page.locator('.register-pane__switch-login').count(), 1, 'register pane must expose the flip-to-login link')
      await page.click('.register-pane__switch-login')
      await page.waitForFunction(
        () => !document.querySelector('.register-pane'),
        null,
        { timeout: 5000 },
      )
      assert.equal(await page.locator('.register-pane').count(), 0, 'flip-to-login must leave the register pane')
      const idInputs = await page.locator('.ui-input input, .ui-input textarea').count()
      assert.ok(idInputs >= 1, 'flipped login scene must show an identifier input, got ' + idInputs)
      assert.deepEqual(errors, [], 'zero console/pageerror expected, got: ' + errors.join(' | '))
    } finally {
      await page.close()
    }
  } finally {
    await browser.close()
  }
})

test('AK-B1: logged-in student CTA routes to a student-gated page', async () => {
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
      assert.equal(await page.locator('.ui-modal').count(), 0, 'logged-in CTA must not open the auth modal')
      assert.deepEqual(errors, [], 'zero console/pageerror expected, got: ' + errors.join(' | '))
    } finally {
      await page.close()
    }
  } finally {
    await browser.close()
  }
})
