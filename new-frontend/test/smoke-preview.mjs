/**
 * M0 preview page smoke test (dev server + Playwright)
 * - Asserts: preview renders with zero console errors / zero pageerrors; core components present and interactive; geometry assertions.
 * - The M0 showcase lives behind `/?page=preview` (pages.js registry; M1 made the landing page the `/` default).
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

await page.goto(BASE + '/?page=preview', { waitUntil: 'networkidle' })

// core sections render
const title = await page.textContent('.pv__title')
if (!title || !title.includes('M0')) errors.push('preview title missing')

// button count
const btnCount = await page.locator('.ui-btn').count()
if (btnCount < 20) errors.push('unexpected button count: ' + btnCount)

// -- AK-B3: A/A1/B/B1 keep black text & SVG on hover/focus; only text variant S grays --
// black text stays black: the grayed hover ink was removed from the A-family.
const btnInk = 'rgb(26, 26, 26)' // --ink / --gray-90
const btnGray = 'rgb(102, 102, 102)' // --gray-60 (S keeps graying)
// variant A label stays ink on hover
await page.locator('.ui-btn--a').first().hover()
await page.waitForTimeout(350) // --btn-dur-color (200ms) settles
const aHoverColor = await page.evaluate(() => getComputedStyle(document.querySelector('.ui-btn--a .ui-btn__label')).color)
if (aHoverColor !== btnInk) errors.push('AK-B3: variant A label must stay ink on hover, got ' + aHoverColor)
// variant A1 arrow stays ink AND still shifts right (focus displacement preserved)
await page.locator('.ui-btn--a1').first().hover()
await page.waitForTimeout(350)
const a1Hover = await page.evaluate(() => {
  const b = document.querySelector('.ui-btn--a1')
  const ar = b.querySelector('.ui-btn__arrow')
  const m = getComputedStyle(ar).transform.match(/matrix\(([^)]+)\)/)
  return { color: getComputedStyle(ar).color, tx: m ? parseFloat(m[1].split(',')[4]) : null }
})
if (a1Hover.color !== btnInk) errors.push('AK-B3: variant A1 arrow must stay ink on hover, got ' + a1Hover.color)
if (a1Hover.tx !== 4) errors.push('AK-B3: A1 arrow must still shift right 4px on hover, got tx=' + a1Hover.tx)
// variant S keeps its gray text on hover (special variant, unchanged)
await page.locator('.ui-btn--s').first().hover()
await page.waitForTimeout(350)
const sHoverColor = await page.evaluate(() => getComputedStyle(document.querySelector('.ui-btn--s .ui-btn__label')).color)
if (sHoverColor !== btnGray) errors.push('AK-B3: variant S must keep gray text on hover, got ' + sHoverColor)
// keyboard focus (same rule surface as hover) keeps the A label ink
await page.locator('body').click({ position: { x: 8, y: 8 } })
await page.waitForTimeout(200)
await page.keyboard.press('Tab')
await page.waitForTimeout(350)
const aFocus = await page.evaluate(() => {
  const el = document.activeElement
  if (!el || !el.classList.contains('ui-btn')) return { focused: false }
  return { focused: true, fv: el.matches(':focus-visible'), color: getComputedStyle(el.querySelector('.ui-btn__label')).color }
})
if (!aFocus.focused) errors.push('AK-B3: Tab should focus a ui-btn for the focus assertion, got ' + JSON.stringify(aFocus))
if (!aFocus.fv) errors.push('AK-B3: focused button should match :focus-visible')
if (aFocus.color !== btnInk) errors.push('AK-B3: variant A label must stay ink on keyboard focus, got ' + aFocus.color)

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
await mobile.goto(BASE + '/?page=preview', { waitUntil: 'networkidle' })

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
