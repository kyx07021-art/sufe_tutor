/**
 * AK-A11 platform scrollbar smoke (dev server + Playwright)
 * - The default OS scrollbar is a square corner that overlaps rounded panel
 *   corners (left round / right square). base.css now applies a thin, rounded,
 *   tokenized platform scrollbar globally (scrollbar-width/color + WebKit
 *   ::-webkit-scrollbar thumb with a pill radius).
 * - Asserts the global style actually reaches a scrollable element at runtime
 *   (computed style), and that scrolling still works through the styled bar.
 * Run: node test/smoke-scrollbar.mjs   (dev server on BASE)
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE || 'http://localhost:5199'
const errors = []
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()))
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))

await page.goto(BASE + '/?page=preview', { waitUntil: 'networkidle' })

// the global platform-scrollbar style must reach scrollable elements at runtime
const sb = await page.evaluate(() => {
  const cs = getComputedStyle(document.documentElement)
  return { width: cs.scrollbarWidth, color: cs.scrollbarColor }
})
if (sb.width !== 'thin') errors.push('AK-A11: platform scrollbar width should be thin, got ' + sb.width)
// gray-30 = rgb(179,179,179); transparent track
if (!sb.color.startsWith('rgb(179')) errors.push('AK-A11: scrollbar thumb color should be gray-30, got ' + sb.color)

// scrolling still works through the styled bar (page is the scroll container)
const before = await page.evaluate(() => document.documentElement.scrollTop)
await page.evaluate(() => window.scrollTo(0, 400))
await page.waitForTimeout(150)
const after = await page.evaluate(() => document.documentElement.scrollTop)
if (!(after > before)) errors.push('AK-A11: styled scrollbar must not break scrolling (before=' + before + ' after=' + after + ')')

await browser.close()
if (errors.length) {
  console.log('SCROLLBAR SMOKE FAIL')
  errors.forEach((e) => console.log(' - ' + e))
  process.exit(1)
} else {
  console.log('SCROLLBAR SMOKE PASS')
}
