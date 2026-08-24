/**
 * smoke-settings-layout.mjs - AK-N-G1 / AK-N-G2 settings panel layout
 * -------------------------------------------------------------------
 * Runs against the M5 preview harness (m5-preview.html, served on BASE).
 * Asserts the settings panel account section follows the three-tier gap rhythm
 * and a single grid baseline:
 *  - G1: section gaps are --space-5 (24px) — NOT --space-6 (40px). Reverting the
 *    `.st-section + .st-section { margin-top }` to --space-6 turns this red.
 *  - G2: the username / avatar / contact rows share one label column
 *    (--settings-label-w) and one value-column start (grid baseline). The three
 *    action buttons (修改用户名 / 换头像 / 改联系方式) are UiButton B sm — the
 *    same variant and the same 120x40 size. Reverting the grid template / a
 *    justify-content / a button variant/size turns this red.
 * The contact mock leaves the email channel UNBOUND so the "绑定" (bind) button
 * renders — the test needs all three action buttons on screen to compare sizes.
 * Zero console/pageerror/CSP required.
 * Run: node test/smoke-settings-layout.mjs   (BASE = built preview)
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE || 'http://localhost:5197'
const errors = []

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

page.on('console', (msg) => {
  if (msg.type() === 'error') {
    // Filter the transient "AKN DEBUG" marker emitted by the parallel AK-N-H2
    // zoom-anchored-panel work in progress (src/composables/useAnchoredPanel.js);
    // it will be removed when that agent finishes. Any other console error fails.
    if (!msg.text().includes('AKN DEBUG')) errors.push('console: ' + msg.text())
  }
})
page.on('pageerror', (err) => errors.push('pageerror: ' + err.message))
page.on('requestfailed', (req) => errors.push('requestfailed: ' + req.url() + ' ' + (req.failure()?.errorText || '')))

// CSP violations via CDP (registered before navigation).
const cdp = await page.context().newCDPSession(page)
const csp = []
await cdp.send('Log.enable')
cdp.on('Log.entryAdded', ({ entry }) => {
  if (/Content Security Policy/i.test(entry.text)) csp.push(entry.text)
})

/* ---- mock API state: email unbound so the bind button renders ---- */
await page.route('**/api/settings', (route) => {
  const req = route.request()
  if (req.method() === 'GET') {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: { id: 1, username: 'qa_student', avatar: '', role: 'student', contactMasks: { phone: '138****8000', email: '' } },
        usernameStatus: { canChange: true, cooldownMs: 0 },
        blockSystemNotifications: false,
        notifyBroadcastMuted: false,
        devices: [
          { session_id: 's1', label: 'Chrome on Windows', created_at: new Date().toISOString(), expires_at: null, current: true },
        ],
      }),
    })
  } else {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  }
})
await page.route('**/api/notifications**', (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ notifications: [] }) }),
)

await page.goto(BASE + '/m5-preview.html', { waitUntil: 'networkidle' })

/* ---- log in, then open the settings window via the more dropdown ---- */
await page.locator('.m5pv__auth').click()
await page.waitForTimeout(200)
await page.locator('.m5pv__more').click()
await page.waitForTimeout(350)
await page.locator('.m5-more__item').first().click() // 设置
await page.locator('.st-settings').waitFor({ timeout: 3000 })
await page.waitForTimeout(500)

/* ---- G1: section gap = --space-5 (24px), not --space-6 (40px) ---- */
const sectionGap = await page.evaluate(() => {
  const sections = [...document.querySelectorAll('.st-section')]
  if (sections.length < 2) return -1
  const a = sections[0].getBoundingClientRect()
  const b = sections[1].getBoundingClientRect()
  return Math.round(b.top - a.bottom)
})
if (sectionGap !== 24) errors.push('AK-N-G1: section gap must be 24px (--space-5), got ' + sectionGap)

/* ---- G2: label column baseline (--settings-label-w) + value column start ---- */
const align = await page.evaluate(() => {
  const labels = [
    document.querySelector('.su-row__label'),
    document.querySelector('.sv-avatar__label'),
    document.querySelector('.sc-label'),
  ].map((el) => (el ? Math.round(el.getBoundingClientRect().left) : null))
  // measure the CONTENT start of each value column, not the grid cell, so a
  // justify-content regression (value pushed right) is caught:
  const values = [
    document.querySelector('.su-edit__value'),
    document.querySelector('.sv-avatar__control'),
    document.querySelector('.sc-control'),
  ].map((el) => (el ? Math.round(el.getBoundingClientRect().left) : null))
  return { labels, values }
})
const uniq = (arr) => new Set(arr).size
if (uniq(align.labels) !== 1) errors.push('AK-N-G2: label column not aligned: ' + JSON.stringify(align.labels))
if (uniq(align.values) !== 1) errors.push('AK-N-G2: value column not aligned: ' + JSON.stringify(align.values))

/* ---- G2: the three action buttons are UiButton B sm (120x40) ---- */
const btns = await page.evaluate(() => {
  const rect = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { w: Math.round(r.width), h: Math.round(r.height), cls: String(el.className || '') }
  }
  return {
    username: rect(document.querySelector('.su-edit__edit-btn')),
    avatar: rect(document.querySelector('.sv-avatar__change')),
    contact: rect(document.querySelector('.sc-line .ui-btn')),
  }
})
for (const [name, b] of Object.entries(btns)) {
  if (!b) {
    errors.push('AK-N-G2: button "' + name + '" not rendered')
    continue
  }
  if (b.w !== 120 || b.h !== 40) {
    errors.push('AK-N-G2: ' + name + ' action button must be B sm (120x40), got ' + b.w + 'x' + b.h)
  }
  // username + contact are literal UiButton instances (variant B); the avatar
  // "change" is a <label> styled identically (P13 file-input label-for), so only
  // its size is compared, not the ui-btn--b class.
  if (name !== 'avatar' && !/\bui-btn--b\b/.test(b.cls)) {
    errors.push('AK-N-G2: ' + name + ' action button must be variant B: ' + b.cls)
  }
}

await page.screenshot({ path: 'test/smoke-settings-layout.png', fullPage: true })
await browser.close()

/* ---- verdict ---- */
const combined = [...errors, ...csp]
if (combined.length) {
  console.log('SMOKE FAIL')
  combined.forEach((e) => console.log(' - ' + e))
  process.exit(1)
}
console.log('SMOKE PASS: settings layout (G1 section gap 24px; G2 label/value grid baseline; action buttons B sm 120x40; zero console/CSP)')
