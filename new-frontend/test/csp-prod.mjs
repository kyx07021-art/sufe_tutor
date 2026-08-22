/**
 * Strict CSP production smoke (built output + Playwright)
 * - Asserts the built index.html carries the strict meta CSP verbatim equal to
 *   the single source src/constants/csp.js META_CSP (exact match, so an
 *   incremental relaxation such as a default-src prefix or an unsafe-inline
 *   source fails the check — the old substring match did not).
 * - Exercises the production entry (the M1 landing page at '/'): scroll to
 *   trigger reveal animations, hover a hero button (ripple), drag the corridor,
 *   then assert zero console / pageerror / CSP violations.
 * - The M0 showcase (PreviewPage) is reachable only through the memory-history
 *   router (M2), not by URL, so its CSP coverage moves to a router-driven test.
 * - Run: node test/csp-prod.mjs (requires the built app served on port 5200)
 */
import { chromium } from 'playwright'
import { META_CSP } from '../src/constants/csp.js'
const BASE = process.env.BASE || 'http://localhost:5200'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const csp = []
page.on('console', (m) => m.type() === 'error' && csp.push(m.text()))
page.on('pageerror', (e) => csp.push('pageerror: ' + e.message))
// CDP captures CSP violations
const cdp = await page.context().newCDPSession(page)
const violations = []
await cdp.send('Log.enable')
cdp.on('Log.entryAdded', ({ entry }) => {
  if (/Content Security Policy/i.test(entry.text)) violations.push(entry.text)
})
await page.goto(BASE + '/', { waitUntil: 'networkidle' })
await page.waitForTimeout(500)

// landing is the production entry
const heroTitle = await page.textContent('.landing-hero__title')
if (!heroTitle || !heroTitle.includes('经世知途')) csp.push('landing hero title missing')

// exercise the landing: reveal on scroll, button hover ripple, corridor drag
await page.evaluate(() => document.querySelector('.landing-slogan').scrollIntoView({ block: 'center' }))
await page.waitForTimeout(500)
const btn = page.locator('.landing-hero__btn').first()
await btn.hover()
await page.waitForTimeout(300)
const vpBox = await page.locator('.landing-gallery__viewport').boundingBox()
if (vpBox) {
  await page.mouse.move(vpBox.x + vpBox.width / 2, vpBox.y + vpBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(vpBox.x + vpBox.width / 2 - 80, vpBox.y + vpBox.height / 2, { steps: 5 })
  await page.mouse.up()
}
await page.waitForTimeout(400)

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
if (csp.length || violations.length || hasMeta !== META_CSP) {
  console.log('CSP PROD FAIL')
  process.exit(1)
}
console.log('CSP PROD PASS')
