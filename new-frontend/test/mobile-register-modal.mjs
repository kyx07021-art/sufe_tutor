/**
 * mobile-register-modal.mjs - PA-2-F2 mobile register modal reachability
 * ---------------------------------------------------------------------
 * - PA-2f HIGH-1: the register modal panel was `overflow:hidden` with no
 *   max-height, so on a 375px viewport the 914px-high content clipped and the
 *   confirm button (y≈714+) was permanently unreachable (no scroll possible).
 * - Asserts (G5 geometry + the fix): the panel is a scroll container with a
 *   viewport-bounded max-height, and the confirm button can be scrolled into
 *   the viewport on mobile; desktop stays reachable without scrolling.
 * - Real dev server (BASE, default :5173), /api/** mocked (same as
 *   landing-login-entry.mjs). Run: node --test test/mobile-register-modal.mjs
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
    const url = route.request().url()
    const method = route.request().method()
    if (url.includes('/api/auth/me') && method === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: null }) })
    }
    if (url.includes('/api/captcha')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, captchaId: 'test-captcha' }) })
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) })
  })
}

async function openRegisterModal(browser, viewport) {
  const page = await browser.newPage({ viewport })
  const errors = []
  captureErrors(page, errors)
  await installApiMock(page)
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.waitForSelector('.landing-hero__btn[data-cap="enter.student"]', { timeout: 10000 })
  await page.click('.landing-hero__btn[data-cap="enter.student"]')
  await page.waitForSelector('.register-pane', { timeout: 5000 })
  await page.waitForSelector('.ui-modal__panel', { timeout: 5000 })
  return { page, errors }
}

test('PA-2-F2: mobile register modal is a scrollable viewport-bounded panel (confirm reachable)', async () => {
  const browser = await chromium.launch()
  try {
    const { page, errors } = await openRegisterModal(browser, { width: 375, height: 667 })
    try {
      const panel = await page.evaluate(() => {
        const p = document.querySelector('.ui-modal__panel')
        const cs = getComputedStyle(p)
        return {
          overflowY: cs.overflowY,
          maxHeight: parseFloat(cs.maxHeight),
          clientHeight: p.clientHeight,
          scrollHeight: p.scrollHeight,
        }
      })
      // The fix: panel is a scroll container bounded by the viewport.
      assert.ok(panel.overflowY === 'auto', 'panel must scroll, got overflowY=' + panel.overflowY)
      assert.ok(Number.isFinite(panel.maxHeight) && panel.maxHeight <= 667 - 8, 'panel max-height must be viewport-bounded, got ' + panel.maxHeight)
      assert.ok(panel.scrollHeight >= panel.clientHeight, 'register content is taller than the bounded panel (scrollable)')

      // The confirm button must be reachable by scrolling.
      const confirmBtn = page.locator('.auth-shell__footer .ui-btn--fill-brand')
      await confirmBtn.scrollIntoViewIfNeeded()
      const box = await confirmBtn.boundingBox()
      assert.ok(box, 'confirm button must have a bounding box')
      assert.ok(box.y + box.height <= 667 + 1, 'confirm button must be within the viewport after scroll, got bottom=' + (box.y + box.height))
      assert.ok(box.y >= 0, 'confirm button must not be above the viewport, got y=' + box.y)
      assert.deepEqual(errors, [], 'zero console/pageerror expected, got: ' + errors.join(' | '))
    } finally {
      await page.close()
    }
  } finally {
    await browser.close()
  }
})

test('PA-2-F2: desktop register modal stays reachable by scrolling (no regression)', async () => {
  const browser = await chromium.launch()
  try {
    const { page, errors } = await openRegisterModal(browser, { width: 1440, height: 900 })
    try {
      // Content is tall (register form + PA-2-F1 switch link); the bounded panel
      // must let the confirm button scroll into view on desktop too.
      const confirmBtn = page.locator('.auth-shell__footer .ui-btn--fill-brand')
      await confirmBtn.scrollIntoViewIfNeeded()
      const box = await confirmBtn.boundingBox()
      assert.ok(box, 'confirm button must have a bounding box')
      assert.ok(box.y + box.height <= 900 + 1, 'desktop confirm must be in viewport after scroll, got bottom=' + (box.y + box.height))
      assert.ok(box.y >= 0, 'desktop confirm must not be above the viewport, got y=' + box.y)
      assert.deepEqual(errors, [], 'zero console/pageerror expected, got: ' + errors.join(' | '))
    } finally {
      await page.close()
    }
  } finally {
    await browser.close()
  }
})
