/**
 * verify-ripple-dual-path.mjs - TASK A single-path dynamics mutation guard (dev :5199)
 * -------------------------------------------------------------------------------------
 * Verifies the user's ripple spec (2026-08-24) on the real dev server:
 * 1. Origin convergence: a click at ANY corner converges the circle center to the
 *    button center while the radius grows to hypot/2+2, so the circle covers the
 *    whole button (the old fixed-origin model left the far corner outside and
 *    sprayed an arc beyond the button -> "spread across the whole modal").
 * 2. Click and keyboard-focus share one geometry (both cover the button).
 * 3. Fade-in is compressed to the first half; opacity then STAYS 1 (no fade-out).
 * 4. The ripple IS the mask: after the spread exactly ONE overlay is visible
 *    (::after mask, ::before hover layer hidden) and .is-rippling persists until
 *    pointerleave/blur.
 * 5. Disabled buttons hide both ripple layers.
 * 6. UiFieldInput required/optional markers are asterisk characters, not SVGs.
 *
 * Mutations that must turn assertions red (each independently):
 *   - Revert convergence (origin pinned at the click point, radius = hypot/2) -> corner covers NO.
 *   - Revert opacity fade-out (ui-ripple 100% opacity 0) -> mask opacity drops after spread.
 *   - Revert single overlay (.is-rippling::before hidden) -> two overlays during hover+click.
 *
 * Run: node test/verify-ripple-dual-path.mjs (dev server on 5199)
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE || 'http://localhost:5199'
const errors = []

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))

await page.goto(BASE + '/?page=preview', { waitUntil: 'networkidle' })
await page.waitForTimeout(400)

const btn = page.locator('.ui-btn--a1').first()
const btnBox = await btn.boundingBox()
if (!btnBox) {
  console.log('VERIFY FAIL: enabled A1 button not found')
  await browser.close()
  process.exit(1)
}
console.log(`A1 button: w=${btnBox.width.toFixed(0)} h=${btnBox.height.toFixed(0)}`)

const dur = await btn.evaluate((el) => parseFloat(getComputedStyle(el).getPropertyValue('--btn-dur-click')) || 200)
console.log('ripple duration:', dur + 'ms')

/** Real mouse click at a fractional point; wait for the spread, read terminal state. */
async function clickAndRead(point) {
  const box = await btn.boundingBox()
  const cx = box.x + box.width * point.x
  const cy = box.y + box.height * point.y
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.up()
  await page.waitForTimeout(dur + 160)
  return btn.evaluate((el) => {
    const r = el.getBoundingClientRect()
    return {
      mx: parseFloat(el.style.getPropertyValue('--mx') || '0'),
      my: parseFloat(el.style.getPropertyValue('--my') || '0'),
      r: parseFloat(el.style.getPropertyValue('--r') || '0'),
      btnW: r.width,
      btnH: r.height,
    }
  })
}

// --- 1. corner clicks: circle converges to center and covers the whole button ---
// The pill (capsule) rounds its corners with radius h/2, so fractions like (0.05, 0.05)
// fall OUTSIDE the button's hit area (elementFromPoint = the parent flex row). Use
// points just inside the pill near the four corners (still ~90px from center, so the
// convergence is meaningful).
console.log('\n--- 1. corner clicks cover the button (origin converges to center) ---')
const corners = [
  { label: 'top-left', x: 0.15, y: 0.12 },
  { label: 'top-right', x: 0.85, y: 0.12 },
  { label: 'bottom-left', x: 0.15, y: 0.88 },
  { label: 'bottom-right', x: 0.85, y: 0.88 },
  { label: 'center', x: 0.5, y: 0.5 },
]
for (const p of corners) {
  const s = await clickAndRead(p)
  const far = Math.hypot(s.btnW / 2, s.btnH / 2)
  const converged = Math.abs(s.mx - s.btnW / 2) < 2 && Math.abs(s.my - s.btnH / 2) < 2
  const covers = s.r >= far - 0.5
  console.log(
    `${p.label.padEnd(12)} mx=${s.mx.toFixed(0)} my=${s.my.toFixed(0)} r=${s.r.toFixed(1)} ` +
    `farthest=${far.toFixed(1)} CONVERGED=${converged ? 'YES' : 'NO'} COVERS=${covers ? 'YES' : 'NO'}`,
  )
  if (!converged) errors.push(`click ${p.label}: origin did not converge to center (mx,my=(${s.mx.toFixed(0)},${s.my.toFixed(0)}) vs center (${(s.btnW / 2).toFixed(0)},${(s.btnH / 2).toFixed(0)}))`)
  if (!covers) errors.push(`click ${p.label}: radius ${s.r.toFixed(1)} < farthest corner ${far.toFixed(1)} - corner click escapes the button`)
}

// --- 2. keyboard activation geometry is consistent with a center click ---
console.log('\n--- 2. keyboard (Enter) ripple geometry == center click geometry ---')
const center = await clickAndRead({ x: 0.5, y: 0.5 })
await page.mouse.move(4, 4) // leave the button -> clear the mask (pointerleave)
await page.waitForTimeout(100)
await btn.focus()
await page.keyboard.press('Enter')
await page.waitForTimeout(dur + 160)
const kb = await btn.evaluate((el) => {
  const r = el.getBoundingClientRect()
  return {
    mx: parseFloat(el.style.getPropertyValue('--mx') || '0'),
    my: parseFloat(el.style.getPropertyValue('--my') || '0'),
    r: parseFloat(el.style.getPropertyValue('--r') || '0'),
    btnW: r.width,
    btnH: r.height,
  }
})
const kbFar = Math.hypot(kb.btnW / 2, kb.btnH / 2)
const kbCovers = kb.r >= kbFar - 0.5
const kbConverged = Math.abs(kb.mx - kb.btnW / 2) < 2 && Math.abs(kb.my - kb.btnH / 2) < 2
const sameAsCenter = Math.abs(kb.r - center.r) < 1
console.log(
  `keyboard mx=${kb.mx.toFixed(0)} my=${kb.my.toFixed(0)} r=${kb.r.toFixed(1)} ` +
  `CONVERGED=${kbConverged ? 'YES' : 'NO'} COVERS=${kbCovers ? 'YES' : 'NO'} sameRAsCenter=${sameAsCenter ? 'YES' : 'NO'}`,
)
if (!kbCovers) errors.push('keyboard ripple does not cover the button')
if (!kbConverged) errors.push('keyboard ripple origin is not the button center')
if (!sameAsCenter) errors.push(`keyboard ripple r=${kb.r.toFixed(1)} != center click r=${center.r.toFixed(1)} (click/focus geometry must match)`)

// --- 3. fade-in compressed to the first half, then opacity stays 1 ---
console.log('\n--- 3. fade-in first half, mask stays visible (no fade-out) ---')
const fade = await page.evaluate(async () => {
  const b = document.querySelector('.ui-btn--a1')
  const d = parseFloat(getComputedStyle(b).getPropertyValue('--btn-dur-click')) || 200
  const r = b.getBoundingClientRect()
  b.classList.remove('is-rippling')
  b.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true, cancelable: true, button: 0, clientX: r.left + 4, clientY: r.top + 4,
  }))
  const out = []
  const t0 = performance.now()
  await new Promise((resolve) => {
    function tick(now) {
      const f = (now - t0) / d
      out.push({ f, opacity: parseFloat(getComputedStyle(b, '::after').opacity) })
      if (f < 1.2) requestAnimationFrame(tick)
      else resolve()
    }
    requestAnimationFrame(tick)
  })
  return out
})
const early = fade.filter((s) => s.f >= 0.03 && s.f < 0.45)
const late = fade.filter((s) => s.f >= 0.6)
const fadesIn = early.length > 0 && early.some((s) => s.opacity < 0.95)
const maintains = late.length > 0 && late.every((s) => s.opacity >= 0.95)
const staysMask = fade.length > 0 && fade[fade.length - 1].opacity >= 0.95
console.log(
  `fade samples=${fade.length} early(<0.45)<0.95=${fadesIn} late(>=0.6)==1=${maintains} final=${staysMask}`,
)
if (!fadesIn) errors.push('ripple opacity should fade in over the first half (early sample < 1)')
if (!maintains) errors.push('ripple opacity must STAY 1 after the first half (no fade-out in second half)')
if (!staysMask) errors.push('ripple opacity must stay 1 at the end (it is the mask, not a fading flash)')

// --- 4. ripple == mask: exactly one overlay after the spread, while hovering ---
console.log('\n--- 4. ripple == mask (exactly one overlay, no double overlay) ---')
const box = await btn.boundingBox()
await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3) // hover -> ::before would show
await page.waitForTimeout(350)
await page.mouse.down()
await page.mouse.up()
await page.waitForTimeout(dur + 160)
const mask = await btn.evaluate((el) => {
  const before = parseFloat(getComputedStyle(el, '::before').opacity)
  const after = parseFloat(getComputedStyle(el, '::after').opacity)
  return {
    before,
    after,
    isRippling: el.classList.contains('is-rippling'),
    overlayCount: (before > 0.5 ? 1 : 0) + (after > 0.5 ? 1 : 0),
  }
})
console.log(
  `before=${mask.before.toFixed(2)} after=${mask.after.toFixed(2)} isRippling=${mask.isRippling} overlays=${mask.overlayCount}`,
)
if (!mask.isRippling) errors.push('the ripple/mask should persist after the spread (cleared on pointerleave/blur)')
if (mask.after < 0.95) errors.push('the mask (::after) must be fully visible after the spread')
if (mask.before > 0.05) errors.push('the hover layer (::before) must be hidden while the mask is active')
if (mask.overlayCount !== 1) errors.push(`exactly one overlay expected, got ${mask.overlayCount} (double overlay or missing mask)`)

// --- 5. disabled buttons: ripple layers hidden + arrow does not move (TASK B) ---
console.log('\n--- 5. disabled button: ripple hidden + arrow stays still (TASK B) ---')
const disabledBtn = page.locator('.ui-btn--a1.is-disabled').first()
if ((await disabledBtn.count()) === 0) {
  errors.push('disabled A1 button not found in preview')
} else {
  const disState = await disabledBtn.evaluate((el) => {
    const b = getComputedStyle(el, '::before')
    const a = getComputedStyle(el, '::after')
    return { before: b.display, after: a.display }
  })
  console.log(`disabled ::before=${disState.before} ::after=${disState.after}`)
  if (disState.before !== 'none') errors.push('disabled button ::before should be display:none, got ' + disState.before)
  if (disState.after !== 'none') errors.push('disabled button ::after should be display:none, got ' + disState.after)
  // TASK B #1: the A1 arrow must NOT shift while the button is disabled (hover)
  const arrowBefore = await disabledBtn.evaluate((el) => {
    const a = el.querySelector('.ui-btn__arrow')
    return a ? getComputedStyle(a).transform : 'no-arrow'
  })
  const dbox = await disabledBtn.boundingBox()
  await page.mouse.move(dbox.x + dbox.width / 2, dbox.y + dbox.height / 2)
  await page.waitForTimeout(300)
  const arrowAfter = await disabledBtn.evaluate((el) => {
    const a = el.querySelector('.ui-btn__arrow')
    return a ? getComputedStyle(a).transform : 'no-arrow'
  })
  console.log(`disabled A1 hover: arrow transform before=${arrowBefore} after=${arrowAfter}`)
  if (arrowBefore !== 'none' || arrowAfter !== 'none') {
    errors.push(`disabled button arrow must not move on hover (before=${arrowBefore} after=${arrowAfter})`)
  }
}

// --- 5b. disabled+checked checkbox: brand fill degrades to gray (TASK B #5) ---
const cbDisabled = await page.evaluate(() => {
  const box = document.querySelector('.ui-checkbox.is-disabled .ui-checkbox__box')
  if (!box) return null
  return { bg: getComputedStyle(box).backgroundColor }
})
console.log('disabled+checked checkbox box bg:', cbDisabled ? cbDisabled.bg : '(not found)')
if (!cbDisabled) {
  errors.push('disabled+checked checkbox not found in preview')
} else if (cbDisabled.bg === 'rgb(108, 92, 231)') {
  errors.push('disabled+checked checkbox must NOT keep the saturated brand fill, got ' + cbDisabled.bg)
} else if (cbDisabled.bg === 'rgb(255, 255, 255)' || cbDisabled.bg === 'rgba(0, 0, 0, 0)') {
  errors.push('disabled+checked checkbox should show a gray fill, got transparent/white ' + cbDisabled.bg)
}

// --- 6. UiFieldInput required/optional markers are asterisk characters (TASK C) ---
console.log('\n--- 6. required/optional marker = asterisk char, not star SVG ---')
const mark = await page.evaluate(() => {
  const required = document.querySelector('.ui-fieldinput--required-empty .ui-fieldinput__mark')
  const optional = document.querySelector('.ui-fieldinput--optional-empty .ui-fieldinput__mark')
  return {
    requiredText: required ? required.textContent.trim() : null,
    requiredSvg: required ? required.querySelector('svg') !== null : null,
    optionalText: optional ? optional.textContent.trim() : null,
    optionalSvg: optional ? optional.querySelector('svg') !== null : null,
  }
})
console.log('required mark:', JSON.stringify(mark))
if (mark.requiredText !== '*') errors.push(`required mark text is '${mark.requiredText}', expected '*'`)
if (mark.requiredSvg) errors.push('required mark must NOT be an SVG (star glyph reserved for ratings)')
if (mark.optionalText !== '*') errors.push(`optional mark text is '${mark.optionalText}', expected '*'`)
if (mark.optionalSvg) errors.push('optional mark must NOT be an SVG')

// --- 7. reduced-motion: component animations are fully stopped (TASK E) ---
console.log('\n--- 7. reduced-motion: dropdown V + check-svg animations stopped ---')
const rm = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await rm.emulateMedia({ reducedMotion: 'reduce' })
await rm.goto(BASE + '/?page=preview', { waitUntil: 'networkidle' })
await rm.waitForTimeout(400)
const rmState = await rm.evaluate(() => {
  const v = document.querySelector('.ui-dropdown__v')
  const check = document.querySelector('.ui-checkbtn')
  return {
    vTransition: v ? getComputedStyle(v).transitionProperty : null,
    // check-svg animation under reduced motion must be none (base ui-check-in suppressed)
    checkAnim: check ? getComputedStyle(check.querySelector('.ui-checkbtn__check-svg')).animationName : null,
    checkAnimDur: check ? getComputedStyle(check.querySelector('.ui-checkbtn__check-svg')).animationDuration : null,
  }
})
console.log('reduced-motion:', JSON.stringify(rmState))
if (rmState.vTransition !== 'none') {
  errors.push('reduced-motion: .ui-dropdown__v transition must be none, got ' + rmState.vTransition)
}
if (rmState.checkAnim !== 'none') {
  errors.push('reduced-motion: .ui-checkbtn__check-svg animation must be none, got ' + rmState.checkAnim)
}
await rm.close()

await browser.close()

if (errors.length) {
  console.log('\nVERIFY RIPPLE FAIL')
  errors.forEach((e) => console.log(' - ' + e))
  process.exit(1)
}
console.log('\nVERIFY RIPPLE PASS')
