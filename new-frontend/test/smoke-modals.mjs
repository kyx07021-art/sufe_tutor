/**
 * M0 modal interaction smoke (dev server + Playwright)
 * - Covers: modal A1 scroll masks / confirm modal A1 countdown + scroll-to-bottom / confirm modal A / step modal page-change + hidden page.
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE || 'http://localhost:5199'
const errors = []
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()))
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))

await page.goto(BASE + '/', { waitUntil: 'networkidle' })

// -- modal A1: scroll masks --
const modalSec = page.locator('.pv__sec', { hasText: 'Modal' })
await modalSec.locator('.ui-btn').nth(1).click()
await page.waitForTimeout(400)
const a1Modal = page.locator('.ui-modala1')
if (await a1Modal.count() !== 1) errors.push('modal A1 did not open')
const a1Body = page.locator('.ui-modala1__body')
const a1Scrollable = await a1Body.evaluate((el) => el.scrollHeight > el.clientHeight)
if (!a1Scrollable) errors.push('modal A1 body should be scrollable')
const topMaskAtTop = await page.locator('.ui-modala1__mask--top').count()
if (topMaskAtTop !== 0) errors.push('top mask should be hidden at top')
const bottomMaskAtTop = await page.locator('.ui-modala1__mask--bottom').count()
if (bottomMaskAtTop !== 1) errors.push('bottom mask should exist before scrolling to bottom')
await a1Body.evaluate((el) => { el.scrollTop = el.scrollHeight })
await page.waitForTimeout(200)
const bottomMaskAtBottom = await page.locator('.ui-modala1__mask--bottom').count()
if (bottomMaskAtBottom !== 0) errors.push('bottom mask should hide after scrolling to bottom')
const topMaskAtBottom = await page.locator('.ui-modala1__mask--top').count()
if (topMaskAtBottom !== 1) errors.push('top mask should appear after scrolling to bottom')
// close
await page.locator('.ui-modala1__close').click()
await page.waitForTimeout(400)

// -- confirm modal A1: countdown + scroll-to-bottom --
await modalSec.locator('.ui-btn').nth(2).click()
await page.waitForTimeout(400)
const cf = page.locator('.ui-confirm-a1')
if (await cf.count() !== 1) errors.push('confirm modal A1 did not open')
const confirmBtn = cf.locator('.ui-btn').nth(1)
const disabledAtStart = await confirmBtn.isDisabled()
if (!disabledAtStart) errors.push('confirm button should be disabled initially')
const countdownText = await confirmBtn.textContent()
if (!countdownText.includes('秒后可确认')) errors.push('countdown text missing: ' + countdownText)
// scroll to bottom -> wait for countdown to finish
await page.locator('.ui-confirm-a1__body').evaluate((el) => { el.scrollTop = el.scrollHeight })
await page.waitForTimeout(5600)
const disabledAfter = await confirmBtn.isDisabled()
if (disabledAfter) errors.push('confirm button should be enabled after scroll + countdown')
const enabledText = await confirmBtn.textContent()
if (!enabledText.includes('确认')) errors.push('enabled text should be confirm: ' + enabledText)
await page.locator('.ui-confirm-a1__btn').first().click() // exit
await page.waitForTimeout(400)

// -- confirm modal A (danger) --
await modalSec.locator('.ui-btn').nth(4).click()
await page.waitForTimeout(400)
const alertRed = page.locator('.ui-alert .ui-btn--fill-danger')
if (await alertRed.count() !== 1) errors.push('danger confirm modal confirm button should be red')
await page.locator('.ui-alert__btn').first().click()
await page.waitForTimeout(400)

// -- step modal A: page-change + hidden page --
await modalSec.locator('.ui-btn').nth(5).click()
await page.waitForTimeout(500)
const step = page.locator('.ui-step')
if (await step.count() !== 1) errors.push('step modal did not open')
// first page right button grayed (required unfilled)
const nextBtn = step.locator('.ui-step__footer .ui-btn').nth(1)
if (!(await nextBtn.isDisabled())) errors.push('first page required-unfilled right button should be disabled')
// fill the two first-page fields -> enable -> next
const stepInputs = step.locator('.ui-step__page .ui-input__ta')
await stepInputs.nth(0).fill('Higher Math')
await stepInputs.nth(1).fill('Online')
await page.waitForTimeout(200)
if (await nextBtn.isDisabled()) errors.push('right button should be enabled after filling required')
// dot state
const dots = step.locator('.ui-step__dot')
const dot0Current = await dots.nth(0).evaluate((el) => el.classList.contains('is-current'))
if (!dot0Current) errors.push('first page dot should be current')
// next
await nextBtn.click()
await page.waitForTimeout(500)
const dot1Reached = await dots.nth(1).evaluate((el) => !el.classList.contains('is-dim'))
if (!dot1Reached) errors.push('second page dot should be visited (not is-dim)')
const title2 = await step.locator('.ui-step__title').textContent()
if (!title2.includes('Teaching info')) errors.push('second page title wrong: ' + title2)
// enter hidden page (page-2 button)
await step.locator('.ui-step__footer .ui-btn').nth(1).click() // to third page
await page.waitForTimeout(500)
await step.locator('.ui-btn', { hasText: 'Enter hidden page' }).click()
await page.waitForTimeout(500)
const hiddenShown = await step.locator('.ui-step__page').evaluateAll((els) =>
  els.some((e) => e.style.display !== 'none' && e.textContent.includes('hidden page')))
if (!hiddenShown) errors.push('hidden page did not show')
const footerHidden = await step.locator('.ui-step__footer').evaluate((el) => el.style.display === 'none')
if (!footerHidden) errors.push('bottom buttons should be hidden inside hidden page')
// back to page
await step.locator('.ui-btn', { hasText: 'Back to page' }).click()
await page.waitForTimeout(500)
const footerBack = await step.locator('.ui-step__footer').evaluate((el) => el.style.display !== 'none')
if (!footerBack) errors.push('bottom buttons should be restored after returning')
// close step modal
await page.keyboard.press('Escape')
await page.waitForTimeout(400)

await page.screenshot({ path: 'new-frontend/test/smoke-modals.png', fullPage: false })
await browser.close()

if (errors.length) {
  console.log('MODAL SMOKE FAIL')
  errors.forEach((e) => console.log(' - ' + e))
  process.exit(1)
} else {
  console.log('MODAL SMOKE PASS')
}
