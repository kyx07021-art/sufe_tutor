/**
 * landing-login-entry.mjs - PA-2-F1 landing-page login entry
 * ---------------------------------------------------------
 * - The landing hero must expose a visible login entry (returning users are
 *   otherwise trapped on the register-only CTAs) and the register pane must
 *   let a visitor flip to the login scene.
 * - Asserts: (1) anonymous landing shows `.landing-hero__login`; (2) clicking
 *   it opens the identity-auth overlay in login scene (identifier + password
 *   form, no register role picker); (3) the register modal shows
 *   `.register-pane__switch-login` and clicking it flips to the login form.
 * - Real dev server (BASE, default :5173). /api/** is mocked so incidental
 *   fetches stay clean (same pattern as landing-cta.mjs).
 * - Run: node --test test/landing-login-entry.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert'
import { chromium } from 'playwright'

const BASE = process.env.BASE || 'http://localhost:5173'

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
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: null }) })
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

async function gotoLanding(browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  captureErrors(page, errors)
  await installApiMock(page)
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.waitForSelector('.landing-hero__btn', { timeout: 10000 })
  await page.waitForFunction(() => window.__APP__ && window.__APP__.authStore.ready === true, null, { timeout: 8000 })
  return { page, errors }
}

test('PA-2-F1: anonymous landing shows a login entry', async () => {
  const browser = await chromium.launch()
  try {
    const { page, errors } = await gotoLanding(browser)
    try {
      const loginBtn = page.locator('.landing-hero__login[data-cap="enter.login"]')
      assert.equal(await loginBtn.count(), 1, 'anonymous landing must render the login entry')
      assert.equal(await loginBtn.isVisible(), true, 'login entry must be visible')
      assert.deepEqual(errors, [], 'zero console/pageerror expected, got: ' + errors.join(' | '))
    } finally {
      await page.close()
    }
  } finally {
    await browser.close()
  }
})

test('PA-2-F1: login entry opens the overlay in login scene (no register role picker)', async () => {
  const browser = await chromium.launch()
  try {
    const { page, errors } = await gotoLanding(browser)
    try {
      await page.click('.landing-hero__login[data-cap="enter.login"]')
      await page.waitForSelector('.ui-modal', { timeout: 5000 })
      // Login scene: no register role picker / invite gate; login identifier+credential present.
      assert.equal(await page.locator('.register-pane').count(), 0, 'login scene must not render the register pane')
      assert.equal(await page.locator('.register-pane__switch-login').count(), 0, 'login scene must not show the register switch')
      const idInputs = await page.locator('.ui-input input, .ui-input textarea').count()
      assert.ok(idInputs >= 1, 'login scene must show an identifier input, got ' + idInputs)
      assert.deepEqual(errors, [], 'zero console/pageerror expected, got: ' + errors.join(' | '))
    } finally {
      await page.close()
    }
  } finally {
    await browser.close()
  }
})

test('PA-2-F1: register pane flips to the login scene via the switch link', async () => {
  const browser = await chromium.launch()
  try {
    const { page, errors } = await gotoLanding(browser)
    try {
      // Open the register modal (hero CTA, PA-1h1-F1 seam).
      await page.click('.landing-hero__btn[data-cap="enter.student"]')
      await page.waitForSelector('.register-pane', { timeout: 5000 })
      assert.equal(await page.locator('.register-pane__switch-login').count(), 1, 'register pane must expose the flip-to-login link')
      // Click it: register pane goes away, login form appears.
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
