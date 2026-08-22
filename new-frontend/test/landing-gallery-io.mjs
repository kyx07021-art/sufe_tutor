/**
 * landing-gallery-io.mjs - PA-1h1-F3 useGalleryDrift observer dedupe
 * ------------------------------------------------------------------
 * - The drift composable's post-flush watch and onMounted both bind the same
 *   viewport on first mount. Without an idempotency guard the element gains a
 *   second (leaked) IntersectionObserver; unbind() only disconnects the latest.
 * - The gallery viewport (`.landing-gallery__viewport`) must be observed by
 *   exactly one IO. The reveal composable observes the `[data-reveal]` sections
 *   (keyed "other") — those are separate elements and stay untouched.
 * - Real dev server (BASE, default :5199). /api/** is mocked to keep the page
 *   console clean (default 200 empty body).
 * - Run: node --test test/landing-gallery-io.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert'
import { chromium } from 'playwright'

const BASE = process.env.BASE || 'http://localhost:5199'

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
    if (url.includes('/api/conversations') && method === 'GET') {
      if (url.includes('/messages')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages: [] }) })
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ conversations: [] }) })
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) })
  })
}

function installIoCounter(page) {
  return page.addInitScript(() => {
    window.__ioObserveCounts = {}
    const NativeIO = window.IntersectionObserver
    window.IntersectionObserver = class extends NativeIO {
      observe(el) {
        const key = el && el.classList && el.classList.contains('landing-gallery__viewport')
          ? 'gallery-viewport'
          : 'other'
        window.__ioObserveCounts[key] = (window.__ioObserveCounts[key] || 0) + 1
        return super.observe(el)
      }
    }
  })
}

async function gotoLanding(browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  captureErrors(page, errors)
  await installApiMock(page)
  await installIoCounter(page)
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.waitForSelector('.landing-hero__btn', { timeout: 10000 })
  return { page, errors }
}

test('F3: gallery viewport is observed by exactly one IntersectionObserver', async () => {
  const browser = await chromium.launch()
  try {
    const { page, errors } = await gotoLanding(browser)
    try {
      const counts = await page.evaluate(() => window.__ioObserveCounts)
      assert.equal(
        counts['gallery-viewport'],
        1,
        'gallery viewport must be observed exactly once (F3 dedupe), got ' + JSON.stringify(counts),
      )
      assert.deepEqual(errors, [], 'zero console/pageerror expected, got: ' + errors.join(' | '))
    } finally {
      await page.close()
    }
  } finally {
    await browser.close()
  }
})
