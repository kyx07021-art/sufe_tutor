/**
 * M0 strict CSP production smoke (built output + Playwright)
 * - Asserts: the built index.html carries the strict meta CSP; interacting with the page yields zero CSP violations.
 * - Run: node test/csp-prod.mjs (requires the built app served on port 5200)
 */
import { chromium } from 'playwright'
const BASE = process.env.BASE || 'http://localhost:5200'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const csp = []
page.on('console', m => m.type() === 'error' && csp.push(m.text()))
page.on('pageerror', e => csp.push('pageerror: ' + e.message))
// CDP captures CSP violations
const cdp = await page.context().newCDPSession(page)
const violations = []
await cdp.send('Log.enable')
cdp.on('Log.entryAdded', ({ entry }) => {
  if (/Content Security Policy/i.test(entry.text)) violations.push(entry.text)
})
await page.goto(BASE + '/', { waitUntil: 'networkidle' })
await page.waitForTimeout(600)
// interact to confirm zero violations
await page.locator('.pv__sec', { hasText: 'Modal' }).locator('.ui-btn').nth(2).click()
await page.waitForTimeout(500)
const hasMeta = await page.evaluate(() => {
  const m = document.querySelector('meta[http-equiv="Content-Security-Policy"]')
  return m ? m.getAttribute('content') : ''
})
const btnCount = await page.locator('.ui-btn').count()
await page.screenshot({ path: 'new-frontend/test/csp-prod.png' })
await browser.close()
console.log('meta CSP:', hasMeta)
console.log('buttons:', btnCount)
console.log('console errors:', csp.length ? csp : 'none')
console.log('CSP violations:', violations.length ? violations : 'none')
if (csp.length || violations.length || !/script-src 'self'; style-src-elem 'self'; style-src-attr 'none'/.test(hasMeta)) {
  console.log('CSP PROD FAIL')
  process.exit(1)
}
console.log('CSP PROD PASS')
