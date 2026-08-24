/**
 * AK-A6 fixed-length captcha counter smoke (dev server + Playwright)
 * - The OTP code input is fixed-length (6 digits); the remaining-chars counter
 *   (UiInput showCounter, threshold < 60) is redundant noise there, so the
 *   captcha input opts out via :show-counter="false".
 * - Pair assertion: the captcha input (maxLength 6 + show-counter=false) shows
 *   NO counter, while a plain input with the SAME maxLength (default
 *   showCounter=true) still shows it — proving the opt-out is scoped, not a
 *   broken counter.
 * - Isolated from smoke-inputs because a counter appearing (the G2 mutation
 *   state) shifts the preview layout and destabilizes later sections.
 * Run: node test/smoke-captcha-counter.mjs   (dev server on BASE)
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE || 'http://localhost:5199'
const errors = []
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()))
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))

await page.goto(BASE + '/?page=preview', { waitUntil: 'networkidle' })

// AK-A6: focus the captcha (OTP) input — the fixed-length counter must NOT appear
const captchaInput = page.locator('.ui-captcha .ui-input__ta')
await captchaInput.first().focus()
await page.waitForTimeout(300)
const captchaCounter = await page.evaluate(
  () => document.querySelectorAll('.ui-captcha .ui-input__counter').length,
)
if (captchaCounter !== 0) errors.push('AK-A6: captcha input must not show a remaining-chars counter, found ' + captchaCounter)

// default path preserved: plain input with the same maxLength (6) still shows it.
// The placeholder span is v-if'd away on focus, so locate the index BEFORE focusing.
const digitsIndex = await page.evaluate(() => {
  const roots = [...document.querySelectorAll('.ui-input')]
  return roots.findIndex((r) => r.querySelector('.ui-input__placeholder')?.textContent.includes('Digits only'))
})
if (digitsIndex < 0) {
  errors.push('AK-A6: Digits-only input not found in preview')
} else {
  await page.locator('.ui-input').nth(digitsIndex).locator('.ui-input__ta').focus()
  await page.waitForTimeout(300)
  const plainCounter = await page.evaluate((idx) => {
    const root = document.querySelectorAll('.ui-input')[idx]
    return root ? root.querySelectorAll('.ui-input__counter').length : -1
  }, digitsIndex)
  if (plainCounter !== 1) errors.push('AK-A6: default showCounter must still show for a plain maxLength input, got ' + plainCounter)
}

await browser.close()
if (errors.length) {
  console.log('CAPTCHA COUNTER SMOKE FAIL')
  errors.forEach((e) => console.log(' - ' + e))
  process.exit(1)
} else {
  console.log('CAPTCHA COUNTER SMOKE PASS')
}
