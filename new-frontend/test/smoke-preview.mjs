/**
 * M0 preview page smoke test (dev server + Playwright)
 * - Asserts: preview renders with zero console errors / zero pageerrors; core components present and interactive; geometry assertions.
 * - Run: node test/smoke-preview.mjs (requires dev server on port 5199)
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE || 'http://localhost:5199'
const errors = []

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push('console: ' + msg.text())
})
page.on('pageerror', (err) => errors.push('pageerror: ' + err.message))
page.on('requestfailed', (req) => errors.push('requestfailed: ' + req.url() + ' ' + (req.failure()?.errorText || '')))

await page.goto(BASE + '/', { waitUntil: 'networkidle' })

// core sections render
const title = await page.textContent('.pv__title')
if (!title || !title.includes('M0')) errors.push('preview title missing')

// button count
const btnCount = await page.locator('.ui-btn').count()
if (btnCount < 20) errors.push('unexpected button count: ' + btnCount)

// icons
const iconCount = await page.locator('.ui-icon').count()
if (iconCount < 10) errors.push('unexpected icon count: ' + iconCount)

// no page-level horizontal overflow (geometry assertion)
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
if (overflow) errors.push('page horizontal overflow')

// click card A1 -> toast appears
await page.locator('.pv__card').nth(1).click()
await page.waitForTimeout(400)
const toast = await page.locator('.ui-toast').count()
if (toast < 1) errors.push('card click did not trigger toast')

// dropdown opens
await page.locator('.ui-dropdown').first().click()
await page.waitForTimeout(350)
const panel = await page.locator('.ui-droppanel').count()
if (panel < 1) errors.push('dropdown panel did not open')

// check button
await page.locator('.ui-checkbtn').first().click()
await page.waitForTimeout(350)
const checked = await page.locator('.ui-checkbtn').first().evaluate((el) => el.classList.contains('is-checked'))
if (!checked) errors.push('check button did not select')

// modal A opens
await page.locator('.pv__sec', { hasText: 'Modal' }).locator('.ui-btn').first().click()
await page.waitForTimeout(400)
const modal = await page.locator('.ui-modal').count()
if (modal < 1) errors.push('modal A did not open')
// click backdrop to close
await page.locator('.ui-modal__backdrop').click({ position: { x: 10, y: 10 } })
await page.waitForTimeout(400)
const modalAfter = await page.locator('.ui-modal').count()
if (modalAfter !== 0) errors.push('backdrop click did not close modal')

// ---- mobile 375px geometry assertions (G5 dual-viewport discipline) ----
// FieldInput inner UiInput must not overflow the viewport nor clip its own content.
const mobile = await browser.newPage({ viewport: { width: 375, height: 700 } })
mobile.on('console', (msg) => {
  if (msg.type() === 'error') errors.push('mobile console: ' + msg.text())
})
mobile.on('pageerror', (err) => errors.push('mobile pageerror: ' + err.message))
await mobile.goto(BASE + '/', { waitUntil: 'networkidle' })

const badField = await mobile.evaluate(() => {
  const vw = window.innerWidth
  return [...document.querySelectorAll('.ui-fieldinput .ui-input')]
    .filter((el) => {
      const r = el.getBoundingClientRect()
      return r.right > vw + 1 || r.left < -1
    })
    .map((el) => el.className)
})
if (badField.length) errors.push('mobile FieldInput UiInput out of viewport: ' + badField.join(', '))

const clipped = await mobile.evaluate(() =>
  [...document.querySelectorAll('.ui-fieldinput .ui-input')].some((el) => el.scrollWidth > el.clientWidth + 1),
)
if (clipped) errors.push('mobile FieldInput UiInput internal horizontal overflow')

// the visible textarea inside a FieldInput must fit the viewport too
const badTa = await mobile.evaluate(() => {
  const vw = window.innerWidth
  return [...document.querySelectorAll('.ui-fieldinput .ui-input__ta')]
    .filter((el) => {
      const r = el.getBoundingClientRect()
      return r.right > vw + 1 || r.left < -1
    })
    .length
})
if (badTa) errors.push('mobile FieldInput textarea out of viewport')
await mobile.close()

await page.screenshot({ path: 'test/smoke-preview.png', fullPage: true })

await browser.close()

if (errors.length) {
  console.log('SMOKE FAIL')
  errors.forEach((e) => console.log(' - ' + e))
  process.exit(1)
} else {
  console.log('SMOKE PASS: preview renders clean, zero console/pageerror, interactions pass, mobile 375 geometry ok')
}
