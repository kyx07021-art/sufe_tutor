/**
 * smoke-settings-gap.mjs - AK-N-G1 settings section gap rhythm
 * -------------------------------------------------------------------
 * Runs against the M5 preview harness (m5-preview.html, served on BASE).
 * Asserts the settings panel sections (账号资料 / 外观 / 设备管理 / 注销账户)
 * are separated by --space-5 (24px) — the "large block" tier of the three-tier
 * gap rhythm (inline --space-2 / group --space-4 / block --space-5). Before the
 * fix the gap was --space-6 (40px), which made the right column read as separate
 * pasted blocks. Reverting `.st-section + .st-section` margin-top to --space-6
 * turns this assertion red.
 * Zero console/pageerror/CSP required.
 * Run: node test/smoke-settings-gap.mjs   (BASE = built preview)
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE || 'http://localhost:5197'
const errors = []

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

page.on('console', (msg) => {
  if (msg.type() === 'error') {
    // Filter the transient "AKN DEBUG" marker from the parallel AK-N-H2 zoom-panel
    // work in progress (useAnchoredPanel.js); any other console error fails.
    if (!msg.text().includes('AKN DEBUG')) errors.push('console: ' + msg.text())
  }
})
page.on('pageerror', (err) => errors.push('pageerror: ' + err.message))

// CSP violations via CDP (registered before navigation).
const cdp = await page.context().newCDPSession(page)
const csp = []
await cdp.send('Log.enable')
cdp.on('Log.entryAdded', ({ entry }) => {
  if (/Content Security Policy/i.test(entry.text)) csp.push(entry.text)
})

/* ---- mock the settings GET so the window renders ---- */
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
        devices: [{ session_id: 's1', label: 'Chrome on Windows', created_at: new Date().toISOString(), expires_at: null, current: true }],
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

/* ---- log in, open settings via the more dropdown ---- */
await page.locator('.m5pv__auth').click()
await page.waitForTimeout(200)
await page.locator('.m5pv__more').click()
await page.waitForTimeout(350)
await page.locator('.m5-more__item').first().click() // 设置
await page.locator('.st-settings').waitFor({ timeout: 3000 })
await page.waitForTimeout(500)

/* ---- G1: section gap = --space-5 (24px) ---- */
const sectionGap = await page.evaluate(() => {
  const sections = [...document.querySelectorAll('.st-section')]
  if (sections.length < 2) return -1
  const a = sections[0].getBoundingClientRect()
  const b = sections[1].getBoundingClientRect()
  return Math.round(b.top - a.bottom)
})
if (sectionGap !== 24) errors.push('AK-N-G1: section gap must be 24px (--space-5), got ' + sectionGap)

await browser.close()

/* ---- verdict ---- */
const combined = [...errors, ...csp]
if (combined.length) {
  console.log('SMOKE FAIL')
  combined.forEach((e) => console.log(' - ' + e))
  process.exit(1)
}
console.log('SMOKE PASS: settings section gap = 24px (--space-5, not --space-6); zero console/CSP')
