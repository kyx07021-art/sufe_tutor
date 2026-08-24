/**
 * mobile-register-modal.mjs - register modal reachability (PA-2-F2 + AK-A12)
 * ---------------------------------------------------------------------
 * - PA-2f HIGH-1 (history): the panel was `overflow:hidden` with no max-height,
 *   so on mobile the confirm button (y≈714+) was permanently unreachable.
 *   Fix = panel max-height + overflow-y:auto (PA-2-F2).
 * - AK-A12 (now): the auth shell is structurally pinned — shell fills the capped
 *   panel budget (max-height, overflow:hidden) and only the BODY scrolls; title +
 *   footer stay on-screen, so the confirm button never requires scrolling to
 *   reach (principle 5 压高不压字: compact rhythm, font sizes untouched).
 * - Asserts (G5): panel does not scroll as a unit (scrollHeight <= clientHeight),
 *   body is the internal scroll container, and the confirm button is visible in
 *   the viewport WITHOUT scrollIntoView — a stronger reachability guarantee than
 *   PA-2-F2. Desktop same (zero panel scroll). Real dev server (BASE, default
 *   :5173), /api/** mocked. Run: node --test test/mobile-register-modal.mjs
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

test('AK-A12: mobile register modal is pinned (panel never scrolls, confirm always visible)', async () => {
  const browser = await chromium.launch()
  try {
    const { page, errors } = await openRegisterModal(browser, { width: 375, height: 667 })
    try {
      const dims = await page.evaluate(() => {
        const p = document.querySelector('.ui-modal__panel')
        const body = document.querySelector('.auth-shell__body')
        const cs = getComputedStyle(p)
        return {
          overflowY: cs.overflowY,
          maxHeight: parseFloat(cs.maxHeight),
          panelClientH: p.clientHeight,
          panelScrollH: p.scrollHeight,
          bodyClientH: body.clientHeight,
          bodyScrollH: body.scrollHeight,
        }
      })
      // AK-A12: panel bounded by viewport AND does not scroll as a unit
      // (shell is capped by max-height + overflow:hidden; the body scrolls internally).
      assert.ok(Number.isFinite(dims.maxHeight) && dims.maxHeight <= 667 - 8, 'panel max-height must be viewport-bounded, got ' + dims.maxHeight)
      assert.ok(dims.panelScrollH <= dims.panelClientH + 1, 'panel must not scroll as a unit, got scroll=' + dims.panelScrollH + ' client=' + dims.panelClientH)
      assert.ok(dims.bodyScrollH >= dims.bodyClientH, 'body should be the internal scroll container, got scroll=' + dims.bodyScrollH + ' client=' + dims.bodyClientH)

      // The confirm button must be visible WITHOUT scrolling (footer pinned).
      const confirmBtn = page.locator('.auth-shell__footer .ui-btn--fill-brand')
      const box = await confirmBtn.boundingBox()
      assert.ok(box, 'confirm button must have a bounding box')
      assert.ok(box.y + box.height <= 667 + 1, 'confirm must be in the viewport without scrolling, got bottom=' + (box.y + box.height))
      assert.ok(box.y >= 0, 'confirm must not be above the viewport, got y=' + box.y)
      assert.deepEqual(errors, [], 'zero console/pageerror expected, got: ' + errors.join(' | '))
    } finally {
      await page.close()
    }
  } finally {
    await browser.close()
  }
})

test('AK-A12: desktop register modal is pinned (no panel scroll, confirm in viewport)', async () => {
  const browser = await chromium.launch()
  try {
    const { page, errors } = await openRegisterModal(browser, { width: 1440, height: 900 })
    try {
      const dims = await page.evaluate(() => {
        const p = document.querySelector('.ui-modal__panel')
        const body = document.querySelector('.auth-shell__body')
        return {
          panelClientH: p.clientHeight,
          panelScrollH: p.scrollHeight,
          bodyClientH: body.clientHeight,
          bodyScrollH: body.scrollHeight,
        }
      })
      // Desktop register (student) must fit without ANY scrolling after the
      // AK-A12 compact rhythm.
      assert.ok(dims.panelScrollH <= dims.panelClientH + 1, 'desktop panel must not scroll, got scroll=' + dims.panelScrollH + ' client=' + dims.panelClientH)
      assert.ok(dims.bodyScrollH <= dims.bodyClientH + 1, 'desktop body should fit (register student), got scroll=' + dims.bodyScrollH + ' client=' + dims.bodyClientH)
      const confirmBtn = page.locator('.auth-shell__footer .ui-btn--fill-brand')
      const box = await confirmBtn.boundingBox()
      assert.ok(box, 'confirm button must have a bounding box')
      assert.ok(box.y + box.height <= 900 + 1, 'desktop confirm must be in viewport without scrolling, got bottom=' + (box.y + box.height))
      assert.ok(box.y >= 0, 'desktop confirm must not be above the viewport, got y=' + box.y)
      assert.deepEqual(errors, [], 'zero console/pageerror expected, got: ' + errors.join(' | '))
    } finally {
      await page.close()
    }
  } finally {
    await browser.close()
  }
})
