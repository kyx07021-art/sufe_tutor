/**
 * AK-N-H2 verify: anchored panels respect --ui-scale zoom (dev server + Playwright)
 * ---------------------------------------------------------------------------------
 * - Root cause (reported: "top-right focus dropdown runs off-screen after scaling"):
 *   base.css `html { zoom: var(--ui-scale, 1) }` scales the whole UI. place()
 *   in useAnchoredPanel reads the trigger via getBoundingClientRect() (visual /
 *   post-zoom space) but assigns fixed left/top (layout / pre-zoom space) where the
 *   root zoom scales it a SECOND time -> panel rectRight > viewport at scale > 1.
 * - Fix: run the anchor math in visual space, then divide the final left/top/width by
 *   the root zoom factor; clamp against the visual viewport; normalize the
 *   matchWidth/minWidth stretch so a panel's right/left edge aligns to its trigger.
 * - After a --ui-scale change the open panel is re-placed: useAnchoredPanel binds a
 *   window resize listener for the whole time a panel is open, and
 *   SettingsAppearance.selectScale dispatches a synthetic resize (AK-N-H2).
 * - Assertions per scale {1, 0.9, 1.1, 1.25}:
 *   1. right-aligned top-right panel: rect.right <= innerWidth, rect.left >= 0,
 *      and the right edge stays aligned to the trigger right edge (alignX=right).
 *   2. matchWidth panel: visual width == trigger visual width and left edge aligned.
 * - End-to-end re-place: with the right panel open, activate the real M5-10 "大"
 *   (large) scale button via keyboard (no pointerdown, so the panel stays open) and
 *   assert the panel re-places within the viewport and stays aligned.
 * - Mutation guard: reverting the / zoom division in place() makes the scale > 1
 *   rect.right assertion red (verified by revert in development).
 * Run: node test/verify-zoom-anchored.mjs   (dev server on BASE)
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE || 'http://localhost:5199'
const errors = []
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()))
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))

await page.goto(BASE + '/test/harness-zoom-anchored.html', { waitUntil: 'networkidle' })

const RIGHT_TRIGGER = '.zh-trigger--right .ui-btn'
const MATCH_TRIGGER = '.zh-trigger--match .ui-btn'

async function setZoom(z) {
  await page.evaluate((v) => {
    document.documentElement.style.setProperty('--ui-scale', String(v))
  }, z)
  // getComputedStyle(zoom) forces a style flush so the factor is applied
  await page.evaluate(() => getComputedStyle(document.documentElement).zoom)
  await page.waitForTimeout(60)
}

async function openPanel(triggerSel) {
  await page.locator(triggerSel).click()
  await page.waitForFunction(
    () => document.querySelectorAll('.ui-droppanel').length === 1,
    null,
    { timeout: 2000 },
  )
}

async function closePanel(triggerSel) {
  await page.locator(triggerSel).click()
  // wait for the leave transition to finish (the old panel stays in the DOM mid-leave)
  await page.waitForFunction(
    () => document.querySelectorAll('.ui-droppanel').length === 0,
    null,
    { timeout: 2000 },
  )
}

function measure(triggerSel) {
  return page.evaluate((sel) => {
    const p = document.querySelector('.ui-droppanel')
    const t = document.querySelector(sel)
    if (!p || !t) return null
    const pr = p.getBoundingClientRect()
    const tr = t.getBoundingClientRect()
    return {
      prl: pr.left, prr: pr.right, prt: pr.top, prb: pr.bottom,
      pwl: pr.width,
      trl: tr.left, trr: tr.right, trt: tr.top, trb: tr.bottom, twl: tr.width,
      vw: window.innerWidth, vh: window.innerHeight,
    }
  }, triggerSel)
}

const SCALES = [1, 0.9, 1.1, 1.25]

// ---- Part 1: right-aligned top-right panel — open at each zoom, within viewport + aligned ----
for (const z of SCALES) {
  await setZoom(z)
  await openPanel(RIGHT_TRIGGER)
  const m = await measure(RIGHT_TRIGGER)
  if (!m) { errors.push(`scale ${z}: right panel or trigger not found`); continue }
  if (m.prr > m.vw + 0.5) errors.push(`scale ${z}: right panel right ${m.prr.toFixed(2)} exceeds viewport ${m.vw}`)
  if (m.prl < -0.5) errors.push(`scale ${z}: right panel left ${m.prl.toFixed(2)} < 0`)
  if (m.prt < -0.5) errors.push(`scale ${z}: right panel top ${m.prt.toFixed(2)} < 0`)
  if (m.prb > m.vh + 0.5) errors.push(`scale ${z}: right panel bottom ${m.prb.toFixed(2)} exceeds viewport height ${m.vh}`)
  const alignErr = Math.abs(m.prr - m.trr)
  if (alignErr > 2) errors.push(`scale ${z}: right panel right ${m.prr.toFixed(2)} not aligned to trigger right ${m.trr.toFixed(2)} (Δ=${alignErr.toFixed(2)})`)
  await closePanel(RIGHT_TRIGGER)
}

// ---- Part 2: matchWidth panel — visual width == trigger visual width, left aligned ----
for (const z of SCALES) {
  await setZoom(z)
  await openPanel(MATCH_TRIGGER)
  const m = await measure(MATCH_TRIGGER)
  if (!m) { errors.push(`scale ${z}: match panel or trigger not found`); continue }
  if (m.prr > m.vw + 0.5) errors.push(`scale ${z}: match panel right ${m.prr.toFixed(2)} exceeds viewport ${m.vw}`)
  const wErr = Math.abs(m.pwl - m.twl)
  if (wErr > 2) errors.push(`scale ${z}: match panel width ${m.pwl.toFixed(2)} != trigger width ${m.twl.toFixed(2)} (Δ=${wErr.toFixed(2)})`)
  const lErr = Math.abs(m.prl - m.trl)
  if (lErr > 2) errors.push(`scale ${z}: match panel left ${m.prl.toFixed(2)} not aligned to trigger left ${m.trl.toFixed(2)} (Δ=${lErr.toFixed(2)})`)
  await closePanel(MATCH_TRIGGER)
}

// ---- Part 3: end-to-end re-place — right panel open at scale 1, then activate the real
//              M5-10 "大" (large, 1.1) scale button via keyboard. Keyboard activation
//              emits click without a pointerdown, so the dropdown's document pointerdown
//              close handler does not fire and the panel stays open while the zoom
//              changes. SettingsAppearance dispatches a synthetic resize; the panel's
//              bound resize listener re-places it against the new zoom. ----
await setZoom(1)
await openPanel(RIGHT_TRIGGER)
const before = await measure(RIGHT_TRIGGER)
if (!before) errors.push('re-place: panel not found before scale change')

// spy: prove the scale control really dispatches a window resize (the re-place signal)
await page.evaluate(() => { window.__resizeProbe = 0 })
await page.evaluate(() => window.addEventListener('resize', () => { window.__resizeProbe++ }))

await page.locator('.sa-appearance .sa-scale-btn').nth(2).focus()
await page.keyboard.press('Enter')
await page.waitForTimeout(150)

const probeFired = await page.evaluate(() => window.__resizeProbe)
if (probeFired < 1) errors.push('re-place: SettingsAppearance scale button did not dispatch a window resize')

const zoomAfter = await page.evaluate(() => getComputedStyle(document.documentElement).zoom)
if (zoomAfter !== '1.1') errors.push('re-place: expected zoom 1.1 after activating large scale, got ' + zoomAfter)

const after = await measure(RIGHT_TRIGGER)
if (!after) {
  errors.push('re-place: panel not found after scale change')
} else {
  if (after.prr > after.vw + 0.5) errors.push(`re-place: panel right ${after.prr.toFixed(2)} exceeds viewport ${after.vw} after scale change`)
  if (after.prl < -0.5) errors.push(`re-place: panel left ${after.prl.toFixed(2)} < 0 after scale change`)
  const alignErr = Math.abs(after.prr - after.trr)
  if (alignErr > 2) errors.push(`re-place: panel right ${after.prr.toFixed(2)} not aligned to trigger right ${after.trr.toFixed(2)} after scale change (Δ=${alignErr.toFixed(2)})`)
}
await closePanel(RIGHT_TRIGGER)

await browser.close()

if (errors.length) {
  console.log('ZOOM ANCHORED FAIL')
  errors.forEach((e) => console.log(' - ' + e))
  process.exit(1)
} else {
  console.log('ZOOM ANCHORED PASS')
}
