/**
 * verify-step-topbar.mjs - AK-N-P1 step modal top bar rhythm (dev server :5199)
 * -----------------------------------------------------------------------------
 * User ㉜: step modal title and dots were "shoved to the top and spread to the
 * two ends, no rhythm and no whitespace". The top bar was a hard 30/70 grid:
 * title hugged a tiny 5%-of-cell inset, dots were justify-content: space-between
 * across the whole right 70% cell (spacing depended on dot count, not rhythm).
 *
 * The rebuild (UiStepModal.vue):
 *   - bar = flex (not grid), align-items: center, padding 0 --space-5 (24px),
 *     gap --space-4 between the title group and the dot group;
 *   - title-zone = first flex item, stretches full bar height, centered;
 *   - dot group = tight cluster: fixed uniform gap --space-2 (8px),
 *     margin-left:auto pushes it to the right but the bar padding keeps it
 *     inset from the edge (echoing the left inset).
 *
 * This test locks the geometry so that restoring the old layout (grid 30/70 +
 * justify-content: space-between on the dots) turns assertions RED:
 *   - bar computed display must be 'flex' (old grid -> red);
 *   - dot group computed justify-content must NOT be 'space-between' (old -> red);
 *   - dot group computed gap must be 8px (old had no gap -> red);
 *   - dot-to-dot measured gaps must be uniform (space-between spreads with count);
 *   - dots right edge must sit --space-5 (24px) inset from the bar right edge;
 *   - title and dots must share the bar vertical centerline;
 *   - dot state colors unchanged (current=brand-bright scale1.18, dim=gray-15).
 *
 * Run: node test/verify-step-topbar.mjs (dev server on 5199)
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE || 'http://localhost:5199'
const errors = []

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()))
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))

await page.goto(BASE + '/preview', { waitUntil: 'networkidle' }).catch(async () => {
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
})
await page.waitForTimeout(400)

const stepBtn = page.locator('.ui-btn', { hasText: 'Step Modal A' })
if ((await stepBtn.count()) === 0) {
  console.log('VERIFY FAIL: Step Modal A button not found')
  await browser.close()
  process.exit(1)
}
await stepBtn.click()
await page.waitForSelector('.ui-step', { timeout: 8000 })
await page.waitForTimeout(500)

const SPACE_2 = 8 // --space-2
const SPACE_5 = 24 // --space-5

const geo = await page.evaluate(([space2, space5]) => {
  const bar = document.querySelector('.ui-step__bar')
  const titleZone = document.querySelector('.ui-step__title-zone')
  const title = document.querySelector('.ui-step__title')
  const dots = document.querySelector('.ui-step__dots')
  if (!bar || !titleZone || !title || !dots) return { missing: true }
  const barRect = bar.getBoundingClientRect()
  const titleRect = title.getBoundingClientRect()
  const titleZoneRect = titleZone.getBoundingClientRect()
  const dotsRect = dots.getBoundingClientRect()
  const dotsEls = [...dots.querySelectorAll('.ui-step__dot')]
  // layout gaps: offsetLeft/offsetWidth ignore the current dot's scale(1.18)
  // transform (getBoundingClientRect would shrink the visible gap by ~0.9px)
  const gaps = []
  for (let i = 1; i < dotsEls.length; i++) {
    gaps.push(Math.round(dotsEls[i].offsetLeft - (dotsEls[i - 1].offsetLeft + dotsEls[i - 1].offsetWidth)))
  }
  const barStyle = getComputedStyle(bar)
  const dotsStyle = getComputedStyle(dots)
  const dotColors = dotsEls.map((d) => getComputedStyle(d).backgroundColor)
  const dotTransforms = dotsEls.map((d) => getComputedStyle(d).transform)
  return {
    barDisplay: barStyle.display,
    barJustify: barStyle.justifyContent,
    dotsJustify: dotsStyle.justifyContent,
    dotsGap: Math.round(parseFloat(dotsStyle.gap) || 0),
    dotsCount: dotsEls.length,
    gaps,
    barLeft: barRect.left,
    barRight: barRect.right,
    barCenterY: barRect.top + barRect.height / 2,
    titleZoneLeft: titleZoneRect.left,
    titleCenterY: titleRect.top + titleRect.height / 2,
    dotsRight: dotsRect.right,
    dotsCenterY: dotsRect.top + dotsRect.height / 2,
    dotColors,
    dotTransforms,
  }
}, [SPACE_2, SPACE_5])

if (geo.missing) {
  errors.push('step top bar elements missing')
} else {
  // bar is flex, not the old 30/70 grid
  if (geo.barDisplay !== 'flex') errors.push('bar display should be flex (old grid 30/70), got ' + geo.barDisplay)
  // dots group must not use space-between (old spread) as the layout means
  if (geo.dotsJustify === 'space-between') errors.push('dot group must not use justify-content: space-between')
  // dot group fixed rhythm gap = --space-2 (8px)
  if (geo.dotsGap !== SPACE_2) errors.push(`dot group gap should be ${SPACE_2}px (--space-2), got ${geo.dotsGap}`)
  // 3 pages -> 3 dots
  if (geo.dotsCount !== 3) errors.push('expected 3 dots (page-count 3), got ' + geo.dotsCount)
  // dot-to-dot measured gaps uniform and equal to the rhythm gap
  if (geo.gaps.length !== geo.dotsCount - 1) errors.push('gap measurement length mismatch')
  for (const g of geo.gaps) {
    if (g !== SPACE_2) errors.push(`dot-to-dot gap should be ${SPACE_2}px, got ${g}`)
  }
  // left inset: title-zone starts at the bar content-box left edge (padding --space-5)
  if (Math.abs(geo.titleZoneLeft - (geo.barLeft + SPACE_5)) > 3) {
    errors.push(`title-zone left inset should be ${SPACE_5}px from bar left, got ${Math.round(geo.titleZoneLeft - geo.barLeft)}`)
  }
  // right inset: dots group right edge sits --space-5 from the bar right edge (echoes left inset)
  if (Math.abs(geo.dotsRight - (geo.barRight - SPACE_5)) > 3) {
    errors.push(`dots right edge should be ${SPACE_5}px inset from bar right, got ${Math.round(geo.barRight - geo.dotsRight)}`)
  }
  // vertical centerline shared by title and dots (both aligned to bar center)
  if (Math.abs(geo.titleCenterY - geo.barCenterY) > 2) errors.push('title not vertically centered in the bar')
  if (Math.abs(geo.dotsCenterY - geo.barCenterY) > 2) errors.push('dot group not vertically centered in the bar')
  // dot state colors unchanged: first dot is-current -> brand-bright; the rest is-dim -> gray-15
  if (geo.dotColors[0] !== 'rgb(127, 109, 243)') errors.push('current dot should be brand-bright, got ' + geo.dotColors[0])
  for (let i = 1; i < geo.dotColors.length; i++) {
    if (geo.dotColors[i] !== 'rgb(217, 217, 217)') errors.push(`dot ${i} should be dim gray-15, got ${geo.dotColors[i]}`)
  }
  if (!/1\.18/.test(geo.dotTransforms[0] || '')) errors.push('current dot should keep scale(1.18), got ' + geo.dotTransforms[0])
}

await browser.close()

if (errors.length) {
  console.log('VERIFY STEP TOPBAR FAIL')
  errors.forEach((e) => console.log(' - ' + e))
  process.exit(1)
} else {
  console.log('VERIFY STEP TOPBAR PASS')
}
