/**
 * M1 landing page smoke test (dev server + Playwright)
 * - Covers M1-01..12: six zones; hero dual-button geometry; corridor loop
 *   (3 copies, initial middle, scrollLeft wrap); drag (M1-07a); idle drift
 *   (M1-07b); edge mask (M1-08); edge shrink (M1-09); mirror sections (M1-10);
 *   scroll reveal + re-register (M1-11); 375px mobile zero horizontal overflow.
 * - Behavior locks (mutation reasoning): each assertion goes red if the
 *   corresponding behavior is removed (e.g. deleting the wrap listener, the
 *   drag handler, the shrink CSSOM write, the drift rAF, or the reveal
 *   re-register on scroll-out).
 * - Run: node test/smoke-landing.mjs (requires dev server on port 5199)
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE || 'http://localhost:5199'
const errors = []
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()))
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('requestfailed', (r) => errors.push('requestfailed: ' + r.url()))

await page.goto(BASE + '/', { waitUntil: 'networkidle' })
await page.waitForTimeout(200)

// ---- 1. Landing renders (hero title + six zones) ----
const title = await page.textContent('.landing-hero__title')
if (!title || !title.includes('经世知途')) errors.push('hero headline missing: ' + title)

const zones = await page.evaluate(() => {
  const main = document.querySelector('.landing')
  return main
    ? [...main.children].filter((el) => el.tagName === 'SECTION' || el.tagName === 'FOOTER').length
    : 0
})
if (zones !== 6) errors.push('landing should render 6 zones, got ' + zones)

// ---- 2. Hero dual-button geometry: total width ~= headline width ----
const titleW = await page.locator('.landing-hero__title').evaluate((el) => el.offsetWidth)
const btnBoxes = await page.locator('.landing-hero__btn').evaluateAll((els) =>
  els.map((el) => {
    const r = el.getBoundingClientRect()
    return { left: r.left, right: r.right }
  }),
)
if (btnBoxes.length !== 2) {
  errors.push('hero buttons should be 2, got ' + btnBoxes.length)
} else {
  const actionsW = Math.max(...btnBoxes.map((b) => b.right)) - Math.min(...btnBoxes.map((b) => b.left))
  if (Math.abs(actionsW - titleW) > 4) {
    errors.push(`hero actions width ${actionsW.toFixed(0)} ~= headline ${titleW.toFixed(0)} (delta > 4px)`)
  }
  if (btnBoxes[0].right - btnBoxes[0].left < 200) errors.push('hero buttons too narrow on desktop')
}
const caps = await page.locator('.landing-hero__btn[data-cap]').count()
if (caps !== 2) errors.push('hero data-cap count should be 2, got ' + caps)

// ---- 3. Corridor loop structure (M1-06) ----
const imgs = await page.locator('.landing-gallery__track img').count()
if (imgs !== 24) errors.push('corridor should render 24 images (3x8), got ' + imgs)

const seqW = await page.evaluate(() => {
  const vp = document.querySelector('.landing-gallery__viewport')
  return vp.scrollWidth / 3
})
if (!(seqW > 0)) errors.push('corridor seqW invalid: ' + seqW)

const firstImgW = await page
  .locator('.landing-gallery__track img')
  .first()
  .evaluate((el) => el.offsetWidth)
if (Math.abs(firstImgW - 800) > 1) errors.push('corridor image width should be 800, got ' + firstImgW)

const initScroll = await page.evaluate(() => document.querySelector('.landing-gallery__viewport').scrollLeft)
// The corridor lands on the middle copy at mount, then idle drift (M1-07b) moves
// it continuously; the invariant is that it stays in the middle segment [seqW,2*seqW).
if (initScroll < seqW || initScroll >= seqW * 2) {
  errors.push(`corridor should start in the middle segment [${seqW.toFixed(0)},${(seqW * 2).toFixed(0)}), got ${initScroll.toFixed(0)}`)
}

// scrollLeft wrap (low)
await page.evaluate(() => {
  const vp = document.querySelector('.landing-gallery__viewport')
  vp.scrollLeft = 100
})
await page.waitForTimeout(120)
const lowScroll = await page.evaluate(() => document.querySelector('.landing-gallery__viewport').scrollLeft)
if (lowScroll < seqW || lowScroll >= seqW * 2) {
  errors.push(`corridor wrap (low) should land in [seqW,2*seqW), got ${lowScroll.toFixed(0)}`)
}

// scrollLeft wrap (high)
await page.evaluate((max) => {
  const vp = document.querySelector('.landing-gallery__viewport')
  vp.scrollLeft = max
}, seqW * 2 + 300)
await page.waitForTimeout(120)
const highScroll = await page.evaluate(() => document.querySelector('.landing-gallery__viewport').scrollLeft)
if (highScroll < seqW || highScroll >= seqW * 2) {
  errors.push(`corridor wrap (high) should land in [seqW,2*seqW), got ${highScroll.toFixed(0)}`)
}

// ---- 4. Edge mask (M1-08): viewport carries a horizontal mask ----
const maskImg = await page.evaluate(() => {
  const vp = document.querySelector('.landing-gallery__viewport')
  return getComputedStyle(vp).maskImage || getComputedStyle(vp).webkitMaskImage
})
if (!maskImg || maskImg === 'none') errors.push('corridor edge mask missing')

// ---- 5. Edge shrink (M1-09): some image shrunk, center image full ----
const shrinkInfo = await page.evaluate(() => {
  const vp = document.querySelector('.landing-gallery__viewport')
  const er = vp.getBoundingClientRect()
  const cx = er.left + er.width / 2
  const imgs = [...vp.querySelectorAll('img')]
  const scales = imgs.map((img) => {
    const r = img.getBoundingClientRect()
    const ix = r.left + r.width / 2
    const s = parseFloat(img.style.getPropertyValue('--g-scale'))
    return { d: Math.abs(ix - cx), s: Number.isFinite(s) ? s : 1 }
  })
  const min = Math.min(...scales.map((o) => o.s))
  const nearest = scales.sort((a, b) => a.d - b.d)[0]
  return { min, nearest: nearest.s }
})
if (!(shrinkInfo.min < 0.99)) errors.push('corridor edge shrink should shrink some image, min=' + shrinkInfo.min)
if (Math.abs(shrinkInfo.nearest - 1) > 0.01) errors.push('corridor center image should be full scale, got ' + shrinkInfo.nearest)

// ---- 6. Mirror sections (M1-10) ----
const mirrorCount = await page.locator('.landing-mirror').count()
if (mirrorCount !== 2) errors.push('mirror sections should be 2, got ' + mirrorCount)
const mirrorA = await page.locator('.landing-mirror--a').count()
const mirrorB = await page.locator('.landing-mirror--b').count()
if (mirrorA !== 1 || mirrorB !== 1) errors.push(`mirror variants a/b expected 1 each, got a=${mirrorA} b=${mirrorB}`)
const mirrorImgCount = await page.locator('.landing-mirror__img').count()
if (mirrorImgCount !== 2) errors.push('mirror images should be 2, got ' + mirrorImgCount)

// ---- 7. Corridor drag (M1-07a): pointer drag changes scrollLeft ----
await page.evaluate(() => {
  const vp = document.querySelector('.landing-gallery__viewport')
  vp.scrollIntoView({ block: 'center' })
})
await page.waitForTimeout(300)
const beforeDrag = await page.evaluate(() => document.querySelector('.landing-gallery__viewport').scrollLeft)
const vpBox = await page.locator('.landing-gallery__viewport').boundingBox()
await page.mouse.move(vpBox.x + vpBox.width / 2, vpBox.y + vpBox.height / 2)
await page.mouse.down()
await page.mouse.move(vpBox.x + vpBox.width / 2 - 160, vpBox.y + vpBox.height / 2, { steps: 8 })
await page.mouse.up()
await page.waitForTimeout(150)
const afterDrag = await page.evaluate(() => document.querySelector('.landing-gallery__viewport').scrollLeft)
if (Math.abs(afterDrag - beforeDrag) < 20) {
  errors.push(`corridor drag should move scrollLeft (before=${beforeDrag.toFixed(0)} after=${afterDrag.toFixed(0)})`)
}
const draggingClassGone = await page.evaluate(
  () => !document.querySelector('.landing-gallery__viewport').classList.contains('is-dragging'),
)
if (!draggingClassGone) errors.push('corridor is-dragging class should be removed after pointerup')

// ---- 8. Idle drift (M1-07b): scrollLeft moves while idle (skip if reduced-motion) ----
const reduced = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
if (!reduced) {
  await page.mouse.move(0, 0) // leave the corridor so drift resumes
  const driftStart = await page.evaluate(() => document.querySelector('.landing-gallery__viewport').scrollLeft)
  await page.waitForTimeout(1600)
  const driftEnd = await page.evaluate(() => document.querySelector('.landing-gallery__viewport').scrollLeft)
  if (Math.abs(driftEnd - driftStart) < 5) {
    errors.push(`corridor idle drift should move scrollLeft (start=${driftStart.toFixed(0)} end=${driftEnd.toFixed(0)})`)
  }
}

// ---- 9. Scroll reveal + re-register (M1-11) ----
// Scroll back to top first: the corridor steps above scrolled the SLOGAN into
// view, so it is now re-registered (pending) after leaving the viewport upward.
await page.evaluate(() => window.scrollTo(0, 0))
await page.waitForTimeout(600)
const sloganInitiallyPending = await page.evaluate(() =>
  document.querySelector('.landing-slogan').classList.contains('reveal-pending'),
)
if (!sloganInitiallyPending) errors.push('SLOGAN should be reveal-pending when out of view')

// scroll it into view -> animation runs, pending removed
await page.evaluate(() => document.querySelector('.landing-slogan').scrollIntoView({ block: 'center' }))
await page.waitForTimeout(900)
const sloganRevealed = await page.evaluate(() => {
  const el = document.querySelector('.landing-slogan')
  return !el.classList.contains('reveal-pending') && parseFloat(getComputedStyle(el).opacity) > 0.9
})
if (!sloganRevealed) errors.push('SLOGAN should reveal (pending removed, visible) after scroll-in')

// scroll far past it (to footer) -> re-registered as pending
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
await page.waitForTimeout(500)
const sloganReRegistered = await page.evaluate(() =>
  document.querySelector('.landing-slogan').classList.contains('reveal-pending'),
)
if (!sloganReRegistered) errors.push('SLOGAN should be re-registered (reveal-pending) after scrolling out')

// scroll back into view -> replays (pending removed again)
await page.evaluate(() => document.querySelector('.landing-slogan').scrollIntoView({ block: 'center' }))
await page.waitForTimeout(900)
const sloganReplay = await page.evaluate(() => {
  const el = document.querySelector('.landing-slogan')
  return !el.classList.contains('reveal-pending') && parseFloat(getComputedStyle(el).opacity) > 0.9
})
if (!sloganReplay) errors.push('SLOGAN should replay reveal after re-entering')

// ---- 10. Footer line (M1-05) ----
const footerLine = await page.evaluate(() => {
  const f = document.querySelector('.landing-footer')
  return f ? getComputedStyle(f).borderTopWidth : '0px'
})
if (footerLine === '0px') errors.push('footer divider line missing')

// ---- 11. Mobile 375px: zero horizontal overflow + hero buttons in viewport ----
const mobile = await browser.newPage({ viewport: { width: 375, height: 700 } })
mobile.on('console', (m) => m.type() === 'error' && errors.push('mobile console: ' + m.text()))
mobile.on('pageerror', (e) => errors.push('mobile pageerror: ' + e.message))
await mobile.goto(BASE + '/', { waitUntil: 'networkidle' })
await mobile.waitForTimeout(200)

const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
if (overflow) errors.push('mobile 375px page horizontal overflow')

const mBtns = await mobile.locator('.landing-hero__btn').evaluateAll((els) =>
  els.map((el) => {
    const r = el.getBoundingClientRect()
    return { left: r.left, right: r.right }
  }),
)
if (mBtns.some((b) => b.left < 0 || b.right > 375 + 1)) errors.push('mobile hero button out of viewport')

const corridorOk = await mobile.evaluate(() => {
  const vp = document.querySelector('.landing-gallery__viewport')
  if (!vp) return true
  const r = vp.getBoundingClientRect()
  return r.left >= 0 && r.right <= window.innerWidth + 1
})
if (!corridorOk) errors.push('mobile corridor viewport out of page')

await mobile.close()

await page.screenshot({ path: 'test/smoke-landing.png', fullPage: true })
await browser.close()

if (errors.length) {
  console.log('SMOKE LANDING FAIL')
  errors.forEach((e) => console.log(' - ' + e))
  process.exit(1)
} else {
  console.log('SMOKE LANDING PASS: six zones, hero geometry, corridor loop+drag+drift+mask+shrink, mirror, reveal+re-register, footer, mobile 375 ok, zero console/pageerror')
}
