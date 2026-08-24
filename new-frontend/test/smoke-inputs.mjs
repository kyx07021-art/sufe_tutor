/**
 * M0 input component interaction smoke (dev server + Playwright)
 * - Covers: dropdown multi-column panel / check button / input filtering / combo input select-fill / variable input set add-remove / info input area status marks.
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE || 'http://localhost:5199'
const errors = []
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()))
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))

await page.goto(BASE + '/?page=preview', { waitUntil: 'networkidle' })

// -- dropdown multi-column panel (16 subjects -> 2 columns) --
await page.locator('.ui-dropdown').nth(1).click()
await page.waitForTimeout(400)
const cols = await page.evaluate(() => {
  const grid = document.querySelector('.ui-droppanel__grid')
  return grid ? grid.style.gridTemplateColumns : ''
})
if (!cols.includes('repeat(2')) errors.push('subject dropdown should be 2 columns: ' + cols)
await page.locator('.ui-droppanel__item').first().click()
await page.waitForTimeout(300)

// -- check button --
const cb = page.locator('.ui-checkbtn').first()
await cb.click()
await page.waitForTimeout(300)
if (!(await cb.evaluate((el) => el.classList.contains('is-checked')))) errors.push('check A did not select')
const cbWidth = await cb.evaluate((el) => el.offsetWidth)
await cb.click()
await page.waitForTimeout(300)
if (await cb.evaluate((el) => el.classList.contains('is-checked'))) errors.push('check A did not deselect')
const cbWidth2 = await cb.evaluate((el) => el.offsetWidth)
if (cbWidth2 >= cbWidth) errors.push('check A did not shrink after deselect')
// AK-C2-F1 (#2 black-is-black): hover must NOT gray the label/check text —
// focus/hover is a "can click" cue, only the background ripple changes.
const cbInkBefore = await cb.evaluate((el) => getComputedStyle(el.querySelector('.ui-checkbtn__label')).color)
await cb.hover()
await page.waitForTimeout(250)
const cbInkAfter = await cb.evaluate((el) => getComputedStyle(el.querySelector('.ui-checkbtn__label')).color)
if (cbInkAfter !== cbInkBefore) errors.push('AK-C2-F1: checkbtn hover must keep label black (ink), got ' + cbInkAfter)

// -- input filtering (digits only) --
const numInput = page.locator('.ui-input__ta').nth(1)
await numInput.fill('a12b34')
const numVal = await numInput.inputValue()
if (numVal !== '1234') errors.push('digits filter failed: ' + numVal)

// -- combo input: select fills --
await page.locator('.ui-combo__v').click()
await page.waitForTimeout(400)
const comboPanel = page.locator('.ui-droppanel').count()
if (comboPanel < 1) errors.push('combo input dropdown did not open')
await page.locator('.ui-droppanel__item').first().click()
await page.waitForTimeout(300)
const comboInputVal = await page.locator('.ui-combo .ui-input__ta').first().inputValue()
if (!comboInputVal) errors.push('combo input did not fill after select')

// -- AK-A4: inner buttons inside pill containers get the capsule interaction zone --
// The send-code and combo-V buttons live inside pill inputs (--input-radius = --input-h/2
// = 22px), so their focus ring must follow the pill contour instead of a square inset edge.
const capR = await page.evaluate(() => {
  const send = document.querySelector('.ui-captcha__send')
  const v = document.querySelector('.ui-combo__v')
  return { send: send ? getComputedStyle(send).borderRadius : null, v: v ? getComputedStyle(v).borderRadius : null }
})
if (capR.send !== '22px') errors.push('AK-A4: captcha send button should be a capsule (border-radius 22px), got ' + capR.send)
if (capR.v !== '22px') errors.push('AK-A4: combo V button should be a capsule (border-radius 22px), got ' + capR.v)
// focus ring is actually active on real keyboard focus. A plain focus() after mouse
// interaction does not match :focus-visible, so reset to keyboard mode with a body
// click + Tab loop until the send button owns the focus (probed: 26 tabs on 1440px).
await page.locator('body').click({ position: { x: 8, y: 8 } })
let sendHit = false
for (let i = 0; i < 60 && !sendHit; i++) {
  await page.keyboard.press('Tab')
  sendHit = await page.evaluate(() => document.activeElement?.classList?.contains('ui-captcha__send') || false)
}
if (!sendHit) errors.push('AK-A4: Tab focus never reached captcha send (DOM order drift)')
const sendFocused = await page.evaluate(() => {
  const el = document.querySelector('.ui-captcha__send')
  return { fv: el.matches(':focus-visible'), shadow: getComputedStyle(el).boxShadow }
})
if (!sendFocused.fv) errors.push('AK-A4: captcha send should match :focus-visible on keyboard focus')
if (!sendFocused.shadow.includes('inset')) errors.push('AK-A4: focused captcha send should show an inset focus ring, got ' + sendFocused.shadow)

// -- AK-A5: underline sits 2px below the text zone + horizontal wipe motion --
await page.locator('.ui-input__ta').first().focus()
await page.waitForTimeout(300) // wipe transition settles
const ulState = await page.evaluate(() => {
  const root = document.querySelector('.ui-input')
  const ta = root.querySelector('.ui-input__ta')
  const ul = root.querySelector('.ui-input__underline')
  const cs = getComputedStyle(ta)
  const ucs = getComputedStyle(ul)
  const textBottom = ta.getBoundingClientRect().top + parseFloat(cs.paddingTop) + parseFloat(cs.lineHeight)
  return {
    gap: Math.round(ul.getBoundingClientRect().top - textBottom),
    scaleX: ucs.transform, // matrix(1,...) after focus extend
    transition: ucs.transitionProperty,
    origin: ucs.transformOrigin, // 'left center' resolves to '0px <h>' when focused
  }
})
if (ulState.gap !== 2) errors.push('AK-A5: underline should sit 2px below the text baseline, got ' + ulState.gap + 'px')
if (!ulState.scaleX.includes('matrix(1,')) errors.push('AK-A5: focused underline should be fully extended (scaleX 1), got ' + ulState.scaleX)
if (!ulState.transition.includes('transform')) errors.push('AK-A5: underline wipe must be transition-driven, got transition ' + ulState.transition)
// focus extends LEFT->RIGHT: origin pinned at the left edge (computed originX = 0px)
const ulOriginX = parseFloat(ulState.origin.split(' ')[0])
if (Math.round(ulOriginX) !== 0) errors.push('AK-A5: focus must extend from the left edge, got originX=' + ulState.origin)
// blur -> erases right->left (scaleX back to 0, origin flips to the right edge;
// computed transform-origin resolves to pixels = the element's right edge)
await page.locator('.ui-input__ta').first().blur()
await page.waitForTimeout(300)
const ulAfter = await page.evaluate(() => {
  const ul = document.querySelector('.ui-input__underline')
  const ucs = getComputedStyle(ul)
  const originX = parseFloat(ucs.transformOrigin.split(' ')[0])
  return { scaleX: ucs.transform, originX, rightEdge: ul.offsetWidth }
})
if (!ulAfter.scaleX.includes('matrix(0,')) errors.push('AK-A5: blurred underline should be fully erased (scaleX 0), got ' + ulAfter.scaleX)
if (Math.round(ulAfter.originX) !== Math.round(ulAfter.rightEdge)) errors.push('AK-A5: erase should originate from the right edge, got originX=' + ulAfter.originX + ' rightEdge=' + ulAfter.rightEdge)

// -- variable input set: add + remove row --
const varSetSec = page.locator('.pv__sec', { hasText: 'Variable Input' })
const beforeRows = await varSetSec.locator('.ui-varset__row').count()
await varSetSec.locator('.ui-varset__add').click()
await page.waitForTimeout(200)
const afterRows = await varSetSec.locator('.ui-varset__row').count()
if (afterRows !== beforeRows + 1) errors.push('add row failed')
await varSetSec.locator('.ui-varset__remove').nth(1).click()
await page.waitForTimeout(200)
const afterRemove = await varSetSec.locator('.ui-varset__row').count()
if (afterRemove !== beforeRows) errors.push('remove row failed')

// -- info input area status marks --
const fieldSec = page.locator('.pv__sec', { hasText: 'Info Input Area' })
// required unfilled -> red star
const redStar = await fieldSec.locator('.ui-fieldinput--required-empty .ui-fieldinput__mark-icon').count()
if (redStar < 1) errors.push('required empty should show red star')
// optional unfilled -> yellow star
const yellowStar = await fieldSec.locator('.ui-fieldinput--optional-empty .ui-fieldinput__mark-icon').count()
if (yellowStar !== 1) errors.push('optional empty should show yellow star')
// interact with optional (schedule input focus) -> yellow star disappears
const fieldInputs = fieldSec.locator('.ui-input__ta')
await fieldInputs.nth(1).focus()
await page.waitForTimeout(200)
await fieldInputs.nth(1).blur()
await page.waitForTimeout(200)
const yellowAfterTouch = await fieldSec.locator('.ui-fieldinput--optional-empty').count()
if (yellowAfterTouch !== 0) errors.push('yellow star should disappear after interaction (optional -> touched)')
// fill required -> green check
await fieldInputs.nth(0).fill('Higher Math')
await page.waitForTimeout(200)
const greenCheck = await fieldSec.locator('.ui-fieldinput--filled .ui-fieldinput__mark-icon').count()
if (greenCheck !== 1) errors.push('filled should show green check')

// -- PA-2-F5: IME composition guard (Enter mid-composition must NOT send) --
const ime = await browser.newPage({ viewport: { width: 1440, height: 900 } })
ime.on('console', (m) => m.type() === 'error' && errors.push('ime console: ' + m.text()))
ime.on('pageerror', (e) => errors.push('ime pageerror: ' + e.message))
await ime.goto(BASE + '/test/harness-ime-guard.html', { waitUntil: 'networkidle' })
await ime.locator('.ui-input__ta').focus()
await ime.locator('.ui-input__ta').press('a')
const imeSends0 = await ime.evaluate(() => window.__sendCount())
if (imeSends0 !== 0) errors.push('ime guard: baseline send count should be 0, got ' + imeSends0)
// simulate IME: compositionstart -> Enter (candidate confirm) -> compositionend
await ime.evaluate(() => {
  const ta = window.__imeTa()
  ta.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
  ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  ta.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
})
await ime.waitForTimeout(200)
const imeSends1 = await ime.evaluate(() => window.__sendCount())
if (imeSends1 !== 0) errors.push('PA-2-F5: Enter mid-composition MUST NOT send (confirmed pinyin), got ' + imeSends1)
// plain Enter after composition ends -> exactly one send
await ime.locator('.ui-input__ta').press('Enter')
await ime.waitForTimeout(200)
const imeSends2 = await ime.evaluate(() => window.__sendCount())
if (imeSends2 !== 1) errors.push('PA-2-F5: plain Enter after composition should send exactly once, got ' + imeSends2)
await ime.close()

await browser.close()
if (errors.length) {
  console.log('INPUT SMOKE FAIL')
  errors.forEach((e) => console.log(' - ' + e))
  process.exit(1)
} else {
  console.log('INPUT SMOKE PASS')
}
